-- Phase D — Banking & tax: bank accounts, statement import stub, reconciliation MVP, tax codes.

-- ---------------------------------------------------------------------------
-- Tax codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 100),
  liability_account_id UUID REFERENCES accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_tax_codes_org ON tax_codes(organization_id);

ALTER TABLE customer_invoice_lines
  ADD COLUMN IF NOT EXISTS tax_code_id UUID REFERENCES tax_codes(id),
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE customer_credit_note_lines
  ADD COLUMN IF NOT EXISTS tax_code_id UUID REFERENCES tax_codes(id),
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE tax_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_codes_select ON tax_codes;
CREATE POLICY tax_codes_select ON tax_codes FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS tax_codes_write ON tax_codes;
CREATE POLICY tax_codes_write ON tax_codes FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Bank accounts & statements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gl_account_id UUID NOT NULL REFERENCES accounts(id),
  account_number TEXT,
  bank_name TEXT,
  currency TEXT NOT NULL DEFAULT 'ETB',
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_org ON bank_accounts(organization_id);

CREATE TABLE IF NOT EXISTS public.bank_statements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  statement_date DATE NOT NULL,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_bank_statements_acct ON bank_statements(bank_account_id, statement_date DESC);

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  statement_id UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  line_date DATE NOT NULL,
  description TEXT,
  reference TEXT,
  amount NUMERIC(14,2) NOT NULL,
  reconciled BOOLEAN NOT NULL DEFAULT false,
  matched_entry_id UUID REFERENCES journal_entries(id),
  matched_at TIMESTAMPTZ,
  matched_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_lines_stmt ON bank_statement_lines(statement_id, line_date);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_lines_unrec
  ON bank_statement_lines(organization_id, reconciled) WHERE reconciled = false;

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_accounts_select ON bank_accounts;
CREATE POLICY bank_accounts_select ON bank_accounts FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS bank_accounts_write ON bank_accounts;
CREATE POLICY bank_accounts_write ON bank_accounts FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS bank_statements_select ON bank_statements;
CREATE POLICY bank_statements_select ON bank_statements FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS bank_statements_write ON bank_statements;
CREATE POLICY bank_statements_write ON bank_statements FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS bank_stmt_lines_select ON bank_statement_lines;
CREATE POLICY bank_stmt_lines_select ON bank_statement_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS bank_stmt_lines_write ON bank_statement_lines;
CREATE POLICY bank_stmt_lines_write ON bank_statement_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Tax code helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_tax_codes(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate NUMERIC;
  v_tax_acct UUID;
BEGIN
  PERFORM public.ensure_default_accounts(p_org_id);
  SELECT tax_rate INTO v_rate FROM organizations WHERE id = p_org_id;
  v_tax_acct := public.account_id_by_code(p_org_id, '2100');

  INSERT INTO tax_codes (organization_id, code, name, rate, liability_account_id)
  VALUES
    (p_org_id, 'STANDARD', 'Standard rate', COALESCE(v_rate, 0), v_tax_acct),
    (p_org_id, 'ZERO', 'Zero rated', 0, v_tax_acct),
    (p_org_id, 'EXEMPT', 'Tax exempt', 0, v_tax_acct)
  ON CONFLICT (organization_id, code) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_tax_codes(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_tax_codes(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', tc.id,
        'code', tc.code,
        'name', tc.name,
        'rate', tc.rate,
        'is_active', tc.is_active,
        'liability_account_id', tc.liability_account_id
      ) ORDER BY tc.code
    )
    FROM tax_codes tc
    WHERE tc.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_tax_codes(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_tax_code(
  p_org_id UUID,
  p_tax_code_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_rate NUMERIC,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_tax_acct UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_rate < 0 OR p_rate > 100 THEN
    RAISE EXCEPTION 'Tax rate must be between 0 and 100';
  END IF;

  PERFORM public.ensure_default_accounts(p_org_id);
  v_tax_acct := public.account_id_by_code(p_org_id, '2100');

  IF p_tax_code_id IS NOT NULL THEN
    UPDATE tax_codes
    SET code = trim(p_code), name = trim(p_name), rate = p_rate, is_active = COALESCE(p_is_active, true)
    WHERE id = p_tax_code_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Tax code not found';
    END IF;
  ELSE
    INSERT INTO tax_codes (organization_id, code, name, rate, liability_account_id, is_active)
    VALUES (p_org_id, trim(p_code), trim(p_name), p_rate, v_tax_acct, COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_tax_code(UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public._resolve_line_tax(
  p_org_id UUID,
  p_line_subtotal NUMERIC,
  p_tax_code_id UUID,
  p_fallback_rate NUMERIC
)
RETURNS TABLE(tax_code_id UUID, tax_rate NUMERIC, tax_amount NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate NUMERIC;
  v_code_id UUID;
BEGIN
  v_code_id := p_tax_code_id;
  IF v_code_id IS NOT NULL THEN
    SELECT tc.rate INTO v_rate
    FROM tax_codes tc
    WHERE tc.id = v_code_id AND tc.organization_id = p_org_id AND tc.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Tax code not found or inactive';
    END IF;
  ELSE
    v_rate := COALESCE(p_fallback_rate, 0);
    v_code_id := NULL;
  END IF;

  RETURN QUERY SELECT
    v_code_id,
    v_rate,
    round(p_line_subtotal * v_rate / 100, 2);
END;
$$;

-- ---------------------------------------------------------------------------
-- Tax summary report (posted invoices + credit notes in range)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tax_summary_report(
  p_org_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'lines', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'code'))
      FROM (
        SELECT jsonb_build_object(
          'code', COALESCE(tc.code, 'UNSPECIFIED'),
          'name', COALESCE(tc.name, 'Unspecified'),
          'rate', COALESCE(tc.rate, cil.tax_rate, 0),
          'taxable_base', SUM(cil.line_total),
          'tax_collected', SUM(cil.tax_amount)
        ) AS row_data
        FROM customer_invoice_lines cil
        JOIN customer_invoices ci ON ci.id = cil.invoice_id
        LEFT JOIN tax_codes tc ON tc.id = cil.tax_code_id
        WHERE cil.organization_id = p_org_id
          AND ci.status IN ('posted', 'paid')
          AND ci.invoice_date BETWEEN p_from AND p_to
        GROUP BY tc.code, tc.name, tc.rate, cil.tax_rate

        UNION ALL

        SELECT jsonb_build_object(
          'code', COALESCE(tc.code, 'UNSPECIFIED'),
          'name', COALESCE(tc.name, 'Unspecified'),
          'rate', COALESCE(tc.rate, cnl.tax_rate, 0),
          'taxable_base', -SUM(cnl.line_total),
          'tax_collected', -SUM(cnl.tax_amount)
        )
        FROM customer_credit_note_lines cnl
        JOIN customer_credit_notes cn ON cn.id = cnl.credit_note_id
        LEFT JOIN tax_codes tc ON tc.id = cnl.tax_code_id
        WHERE cnl.organization_id = p_org_id
          AND cn.status = 'posted'
          AND cn.credit_date BETWEEN p_from AND p_to
        GROUP BY tc.code, tc.name, tc.rate, cnl.tax_rate
      ) t
    ), '[]'::jsonb),
    'total_tax', COALESCE((
      SELECT SUM(cil.tax_amount)
      FROM customer_invoice_lines cil
      JOIN customer_invoices ci ON ci.id = cil.invoice_id
      WHERE cil.organization_id = p_org_id
        AND ci.status IN ('posted', 'paid')
        AND ci.invoice_date BETWEEN p_from AND p_to
    ), 0) - COALESCE((
      SELECT SUM(cnl.tax_amount)
      FROM customer_credit_note_lines cnl
      JOIN customer_credit_notes cn ON cn.id = cnl.credit_note_id
      WHERE cnl.organization_id = p_org_id
        AND cn.status = 'posted'
        AND cn.credit_date BETWEEN p_from AND p_to
    ), 0)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.tax_summary_report(UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Bank account RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_bank_accounts(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', ba.id,
        'name', ba.name,
        'account_number', ba.account_number,
        'bank_name', ba.bank_name,
        'currency', ba.currency,
        'is_active', ba.is_active,
        'gl_account_id', ba.gl_account_id,
        'gl_account_code', a.code,
        'gl_account_name', a.name,
        'gl_balance', COALESCE((
          SELECT SUM(jel.debit - jel.credit)
          FROM journal_entry_lines jel
          JOIN journal_entries je ON je.id = jel.entry_id
          WHERE jel.account_id = ba.gl_account_id
            AND public._je_is_posted(je.entry_status)
        ), 0),
        'unreconciled_lines', COALESCE((
          SELECT COUNT(*)::INT
          FROM bank_statement_lines bsl
          WHERE bsl.organization_id = p_org_id
            AND bsl.reconciled = false
            AND bsl.statement_id IN (
              SELECT id FROM bank_statements WHERE bank_account_id = ba.id
            )
        ), 0)
      ) ORDER BY ba.name
    )
    FROM bank_accounts ba
    JOIN accounts a ON a.id = ba.gl_account_id
    WHERE ba.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_bank_accounts(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_bank_account(
  p_org_id UUID,
  p_bank_account_id UUID,
  p_name TEXT,
  p_gl_account_id UUID,
  p_account_number TEXT DEFAULT NULL,
  p_bank_name TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_currency TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM accounts
    WHERE id = p_gl_account_id AND organization_id = p_org_id AND type = 'asset'
  ) THEN
    RAISE EXCEPTION 'GL account must be an asset account in this organization';
  END IF;

  SELECT COALESCE(NULLIF(trim(p_currency), ''), currency) INTO v_currency
  FROM organizations WHERE id = p_org_id;

  IF p_bank_account_id IS NOT NULL THEN
    UPDATE bank_accounts
    SET
      name = trim(p_name),
      gl_account_id = p_gl_account_id,
      account_number = NULLIF(trim(p_account_number), ''),
      bank_name = NULLIF(trim(p_bank_name), ''),
      currency = v_currency,
      is_active = COALESCE(p_is_active, true)
    WHERE id = p_bank_account_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Bank account not found';
    END IF;
  ELSE
    INSERT INTO bank_accounts (
      organization_id, name, gl_account_id, account_number, bank_name, currency, is_active
    ) VALUES (
      p_org_id, trim(p_name), p_gl_account_id,
      NULLIF(trim(p_account_number), ''), NULLIF(trim(p_bank_name), ''),
      v_currency, COALESCE(p_is_active, true)
    ) RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_bank_account(UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- p_lines: [{date, description, reference, amount}]
CREATE OR REPLACE FUNCTION public.import_bank_statement(
  p_bank_account_id UUID,
  p_statement_date DATE,
  p_opening_balance NUMERIC,
  p_closing_balance NUMERIC,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct bank_accounts%ROWTYPE;
  v_stmt_id UUID;
  v_line JSONB;
BEGIN
  SELECT * INTO v_acct FROM bank_accounts WHERE id = p_bank_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account not found';
  END IF;
  IF NOT public.user_can_manage(v_acct.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one statement line is required';
  END IF;

  INSERT INTO bank_statements (
    organization_id, bank_account_id, statement_date,
    opening_balance, closing_balance, source, imported_by
  ) VALUES (
    v_acct.organization_id, p_bank_account_id, COALESCE(p_statement_date, current_date),
    COALESCE(p_opening_balance, 0), COALESCE(p_closing_balance, 0), 'manual', auth.uid()
  ) RETURNING id INTO v_stmt_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO bank_statement_lines (
      organization_id, statement_id, line_date, description, reference, amount
    ) VALUES (
      v_acct.organization_id, v_stmt_id,
      COALESCE((v_line->>'date')::DATE, COALESCE(p_statement_date, current_date)),
      NULLIF(v_line->>'description', ''),
      NULLIF(v_line->>'reference', ''),
      COALESCE((v_line->>'amount')::NUMERIC, 0)
    );
  END LOOP;

  RETURN v_stmt_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.import_bank_statement(UUID, DATE, NUMERIC, NUMERIC, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_bank_reconciliation(
  p_bank_account_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct bank_accounts%ROWTYPE;
  v_from DATE := COALESCE(p_from, date_trunc('month', current_date)::date);
  v_to DATE := COALESCE(p_to, current_date);
BEGIN
  SELECT * INTO v_acct FROM bank_accounts WHERE id = p_bank_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account not found';
  END IF;
  IF NOT public.user_has_org_access(v_acct.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'bank_account', jsonb_build_object(
      'id', v_acct.id,
      'name', v_acct.name,
      'gl_account_id', v_acct.gl_account_id,
      'currency', v_acct.currency
    ),
    'from', v_from,
    'to', v_to,
    'statement_lines', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', bsl.id,
          'line_date', bsl.line_date,
          'description', bsl.description,
          'reference', bsl.reference,
          'amount', bsl.amount,
          'reconciled', bsl.reconciled,
          'matched_entry_id', bsl.matched_entry_id,
          'statement_date', bs.statement_date
        ) ORDER BY bsl.line_date DESC, bsl.id
      )
      FROM bank_statement_lines bsl
      JOIN bank_statements bs ON bs.id = bsl.statement_id
      WHERE bs.bank_account_id = p_bank_account_id
        AND bsl.line_date BETWEEN v_from AND v_to
    ), '[]'::jsonb),
    'unmatched_entries', COALESCE((
      SELECT jsonb_agg(entry_data ORDER BY (entry_data->>'entry_date') DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', je.id,
          'entry_date', je.entry_date,
          'memo', je.memo,
          'source_type', je.source_type,
          'net_amount', SUM(jel.debit - jel.credit)
        ) AS entry_data
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.entry_id = je.id
        WHERE jel.account_id = v_acct.gl_account_id
          AND je.organization_id = v_acct.organization_id
          AND public._je_is_posted(je.entry_status)
          AND je.entry_date BETWEEN v_from AND v_to
          AND NOT EXISTS (
            SELECT 1 FROM bank_statement_lines bsl2
            WHERE bsl2.matched_entry_id = je.id
          )
        GROUP BY je.id
        HAVING abs(SUM(jel.debit - jel.credit)) > 0.001
      ) t
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_bank_reconciliation(UUID, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.match_bank_statement_line(
  p_line_id UUID,
  p_entry_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line bank_statement_lines%ROWTYPE;
  v_acct bank_accounts%ROWTYPE;
  v_net NUMERIC;
BEGIN
  SELECT * INTO v_line FROM bank_statement_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Statement line not found';
  END IF;
  IF NOT public.user_can_manage(v_line.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT ba.* INTO v_acct
  FROM bank_statements bs
  JOIN bank_accounts ba ON ba.id = bs.bank_account_id
  WHERE bs.id = v_line.statement_id;

  SELECT SUM(jel.debit - jel.credit) INTO v_net
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  WHERE je.id = p_entry_id
    AND jel.account_id = v_acct.gl_account_id
    AND je.organization_id = v_line.organization_id;

  IF v_net IS NULL OR abs(v_net - v_line.amount) > 0.02 THEN
    RAISE EXCEPTION 'GL entry net (%) does not match statement amount (%)', COALESCE(v_net, 0), v_line.amount;
  END IF;

  IF EXISTS (
    SELECT 1 FROM bank_statement_lines
    WHERE matched_entry_id = p_entry_id AND id <> p_line_id
  ) THEN
    RAISE EXCEPTION 'Journal entry is already matched to another statement line';
  END IF;

  UPDATE bank_statement_lines
  SET reconciled = true, matched_entry_id = p_entry_id, matched_at = now(), matched_by = auth.uid()
  WHERE id = p_line_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.match_bank_statement_line(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.unmatch_bank_statement_line(p_line_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line bank_statement_lines%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM bank_statement_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Statement line not found';
  END IF;
  IF NOT public.user_can_manage(v_line.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE bank_statement_lines
  SET reconciled = false, matched_entry_id = NULL, matched_at = NULL, matched_by = NULL
  WHERE id = p_line_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.unmatch_bank_statement_line(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.auto_match_bank_statement(p_bank_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct bank_accounts%ROWTYPE;
  v_matched INT := 0;
  v_line RECORD;
  v_entry_id UUID;
BEGIN
  SELECT * INTO v_acct FROM bank_accounts WHERE id = p_bank_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account not found';
  END IF;
  IF NOT public.user_can_manage(v_acct.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_line IN
    SELECT bsl.id, bsl.amount, bsl.line_date
    FROM bank_statement_lines bsl
    JOIN bank_statements bs ON bs.id = bsl.statement_id
    WHERE bs.bank_account_id = p_bank_account_id
      AND bsl.reconciled = false
    ORDER BY bsl.line_date
  LOOP
    SELECT je.id INTO v_entry_id
    FROM journal_entries je
    JOIN journal_entry_lines jel ON jel.entry_id = je.id
    WHERE jel.account_id = v_acct.gl_account_id
      AND je.organization_id = v_acct.organization_id
      AND public._je_is_posted(je.entry_status)
      AND je.entry_date = v_line.line_date
      AND NOT EXISTS (SELECT 1 FROM bank_statement_lines bsl2 WHERE bsl2.matched_entry_id = je.id)
    GROUP BY je.id
    HAVING abs(SUM(jel.debit - jel.credit) - v_line.amount) < 0.02
    LIMIT 1;

    IF v_entry_id IS NOT NULL THEN
      UPDATE bank_statement_lines
      SET reconciled = true, matched_entry_id = v_entry_id, matched_at = now(), matched_by = auth.uid()
      WHERE id = v_line.id;
      v_matched := v_matched + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('matched', v_matched);
END;
$$;
GRANT EXECUTE ON FUNCTION public.auto_match_bank_statement(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Invoice / credit note — per-line tax codes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_customer_invoice(
  p_org_id UUID,
  p_customer_id UUID,
  p_invoice_date DATE,
  p_due_date DATE,
  p_tax_rate NUMERIC,
  p_notes TEXT,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id UUID;
  v_line JSONB;
  v_subtotal NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_total NUMERIC;
  v_inv_no TEXT;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_line_total NUMERIC;
  v_line_tax NUMERIC;
  v_line_rate NUMERIC;
  v_tax_code_id UUID;
  v_org_rate NUMERIC;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_tax_codes(p_org_id);
  SELECT tax_rate INTO v_org_rate FROM organizations WHERE id = p_org_id;
  v_inv_no := public.next_invoice_no(p_org_id);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := COALESCE((v_line->>'quantity')::NUMERIC, 1);
    v_price := COALESCE((v_line->>'unitPrice')::NUMERIC, 0);
    v_line_total := round(v_qty * v_price, 2);

    SELECT t.tax_code_id, t.tax_rate, t.tax_amount
    INTO v_tax_code_id, v_line_rate, v_line_tax
    FROM public._resolve_line_tax(
      p_org_id,
      v_line_total,
      NULLIF(v_line->>'taxCodeId', '')::UUID,
      COALESCE(p_tax_rate, v_org_rate)
    ) t;

    v_subtotal := v_subtotal + v_line_total;
    v_tax := v_tax + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax;

  INSERT INTO customer_invoices (
    organization_id, customer_id, invoice_no, invoice_date, due_date,
    status, subtotal, tax_amount, total, notes, created_by
  ) VALUES (
    p_org_id, p_customer_id, v_inv_no, COALESCE(p_invoice_date, current_date), p_due_date,
    'draft', v_subtotal, v_tax, v_total, p_notes, auth.uid()
  ) RETURNING id INTO v_invoice_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := COALESCE((v_line->>'quantity')::NUMERIC, 1);
    v_price := COALESCE((v_line->>'unitPrice')::NUMERIC, 0);
    v_line_total := round(v_qty * v_price, 2);

    SELECT t.tax_code_id, t.tax_rate, t.tax_amount
    INTO v_tax_code_id, v_line_rate, v_line_tax
    FROM public._resolve_line_tax(
      p_org_id,
      v_line_total,
      NULLIF(v_line->>'taxCodeId', '')::UUID,
      COALESCE(p_tax_rate, v_org_rate)
    ) t;

    INSERT INTO customer_invoice_lines (
      invoice_id, organization_id, description, quantity, unit_price, line_total,
      tax_code_id, tax_rate, tax_amount
    ) VALUES (
      v_invoice_id, p_org_id, v_line->>'description', v_qty, v_price, v_line_total,
      v_tax_code_id, v_line_rate, v_line_tax
    );
  END LOOP;

  RETURN v_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_customer_credit_note(
  p_org_id UUID,
  p_customer_id UUID,
  p_lines JSONB,
  p_settlement_method TEXT DEFAULT 'store_credit',
  p_tax_rate NUMERIC DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_invoice_id UUID DEFAULT NULL,
  p_credit_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cn_id UUID;
  v_line JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_line_total NUMERIC;
  v_line_tax NUMERIC;
  v_line_rate NUMERIC;
  v_tax_code_id UUID;
  v_subtotal NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_total NUMERIC := 0;
  v_rate NUMERIC;
  v_seq INT;
  v_cn_no TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_settlement_method NOT IN ('ar', 'store_credit', 'cash') THEN
    RAISE EXCEPTION 'Invalid settlement method';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line is required';
  END IF;

  PERFORM public.ensure_default_tax_codes(p_org_id);
  SELECT tax_rate INTO v_rate FROM organizations WHERE id = p_org_id;
  v_rate := COALESCE(p_tax_rate, v_rate);

  SELECT COUNT(*) + 1 INTO v_seq FROM customer_credit_notes WHERE organization_id = p_org_id;
  v_cn_no := 'CN-' || lpad(v_seq::text, 5, '0');

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := COALESCE((v_line->>'quantity')::NUMERIC, 1);
    v_price := COALESCE((v_line->>'unitPrice')::NUMERIC, 0);
    v_line_total := round(v_qty * v_price, 2);

    SELECT t.tax_code_id, t.tax_rate, t.tax_amount
    INTO v_tax_code_id, v_line_rate, v_line_tax
    FROM public._resolve_line_tax(
      p_org_id,
      v_line_total,
      NULLIF(v_line->>'taxCodeId', '')::UUID,
      v_rate
    ) t;

    v_subtotal := v_subtotal + v_line_total;
    v_tax := v_tax + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax;

  INSERT INTO customer_credit_notes (
    organization_id, customer_id, credit_note_no, credit_date, invoice_id,
    settlement_method, status, subtotal, tax_amount, total, reason, created_by
  ) VALUES (
    p_org_id, p_customer_id, v_cn_no, COALESCE(p_credit_date, current_date), p_invoice_id,
    p_settlement_method, 'draft', v_subtotal, v_tax, v_total, p_reason, auth.uid()
  ) RETURNING id INTO v_cn_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := COALESCE((v_line->>'quantity')::NUMERIC, 1);
    v_price := COALESCE((v_line->>'unitPrice')::NUMERIC, 0);
    v_line_total := round(v_qty * v_price, 2);

    SELECT t.tax_code_id, t.tax_rate, t.tax_amount
    INTO v_tax_code_id, v_line_rate, v_line_tax
    FROM public._resolve_line_tax(
      p_org_id,
      v_line_total,
      NULLIF(v_line->>'taxCodeId', '')::UUID,
      v_rate
    ) t;

    INSERT INTO customer_credit_note_lines (
      credit_note_id, organization_id, description, quantity, unit_price, line_total,
      tax_code_id, tax_rate, tax_amount
    ) VALUES (
      v_cn_id, p_org_id, v_line->>'description', v_qty, v_price, v_line_total,
      v_tax_code_id, v_line_rate, v_line_tax
    );
  END LOOP;

  RETURN v_cn_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap default tax codes + primary bank account per org
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org RECORD;
  v_bank_acct UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_tax_codes(v_org.id);

    SELECT a.id INTO v_bank_acct
    FROM accounts a
    WHERE a.organization_id = v_org.id AND a.code = '1010'
    LIMIT 1;

    IF v_bank_acct IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bank_accounts WHERE organization_id = v_org.id
    ) THEN
      INSERT INTO bank_accounts (organization_id, name, gl_account_id, bank_name)
      VALUES (v_org.id, 'Primary bank', v_bank_acct, 'Bank');
    END IF;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.create_customer_invoice(UUID, UUID, DATE, DATE, NUMERIC, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_credit_note(UUID, UUID, JSONB, TEXT, NUMERIC, TEXT, UUID, DATE) TO authenticated;

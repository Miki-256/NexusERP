-- Phase B — Accountant essentials: COA CRUD, ledger pagination, AR/AP aging, credit notes.

-- ---------------------------------------------------------------------------
-- Credit notes (linked to GL on post)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_note_status') THEN
    CREATE TYPE credit_note_status AS ENUM ('draft', 'posted');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.customer_credit_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  credit_note_no TEXT NOT NULL,
  credit_date DATE NOT NULL DEFAULT current_date,
  invoice_id UUID REFERENCES customer_invoices(id) ON DELETE SET NULL,
  settlement_method TEXT NOT NULL DEFAULT 'store_credit'
    CHECK (settlement_method IN ('ar', 'store_credit', 'cash')),
  status credit_note_status NOT NULL DEFAULT 'draft',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_org_no
  ON customer_credit_notes(organization_id, credit_note_no);
CREATE INDEX IF NOT EXISTS idx_credit_notes_org_date
  ON customer_credit_notes(organization_id, credit_date DESC);

CREATE TABLE IF NOT EXISTS public.customer_credit_note_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  credit_note_id UUID NOT NULL REFERENCES customer_credit_notes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cn_lines_note ON customer_credit_note_lines(credit_note_id);

ALTER TABLE customer_credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credit_note_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY cn_select ON customer_credit_notes FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY cn_write ON customer_credit_notes FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY cnl_select ON customer_credit_note_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY cnl_write ON customer_credit_note_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Chart of accounts — list & upsert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_accounts(p_org_id UUID)
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
        'id', a.id,
        'code', a.code,
        'name', a.name,
        'type', a.type,
        'is_active', a.is_active,
        'created_at', a.created_at
      ) ORDER BY a.code
    )
    FROM accounts a
    WHERE a.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_accounts(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_account(
  p_org_id UUID,
  p_account_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_type account_type,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_code TEXT := trim(p_code);
  v_name TEXT := trim(p_name);
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_code = '' OR v_name = '' THEN
    RAISE EXCEPTION 'Code and name are required';
  END IF;

  IF p_account_id IS NULL THEN
    INSERT INTO accounts (organization_id, code, name, type, is_active)
    VALUES (p_org_id, v_code, v_name, p_type, COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = p_account_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM accounts
    WHERE organization_id = p_org_id AND code = v_code AND id <> p_account_id
  ) THEN
    RAISE EXCEPTION 'Account code already exists';
  END IF;

  UPDATE accounts
  SET code = v_code, name = v_name, type = p_type, is_active = COALESCE(p_is_active, true)
  WHERE id = p_account_id AND organization_id = p_org_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_account(UUID, UUID, TEXT, TEXT, account_type, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- Paginated journal entries
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_journal_entries_page(
  p_org_id UUID,
  p_from DATE,
  p_to DATE,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_source_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_total INT;
  v_entries JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM journal_entries je
  WHERE je.organization_id = p_org_id
    AND je.entry_date BETWEEN p_from AND p_to
    AND (p_source_type IS NULL OR je.source_type = p_source_type);

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'entry_date' DESC, row->>'created_at' DESC), '[]'::jsonb)
    INTO v_entries
  FROM (
    SELECT jsonb_build_object(
      'id', je.id,
      'entry_date', je.entry_date,
      'memo', je.memo,
      'reference', je.reference,
      'source_type', je.source_type,
      'source_id', je.source_id,
      'created_at', je.created_at,
      'journal_code', j.code,
      'journal_name', j.name,
      'lines', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', jel.id,
            'debit', jel.debit,
            'credit', jel.credit,
            'description', jel.description,
            'account_code', a.code,
            'account_name', a.name,
            'account_type', a.type
          ) ORDER BY a.code
        )
        FROM journal_entry_lines jel
        JOIN accounts a ON a.id = jel.account_id
        WHERE jel.entry_id = je.id
      ), '[]'::jsonb)
    ) AS row
    FROM journal_entries je
    JOIN journals j ON j.id = je.journal_id
    WHERE je.organization_id = p_org_id
      AND je.entry_date BETWEEN p_from AND p_to
      AND (p_source_type IS NULL OR je.source_type = p_source_type)
    ORDER BY je.entry_date DESC, je.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('total', v_total, 'entries', v_entries);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_journal_entries_page(UUID, DATE, DATE, INT, INT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- AR aging — posted invoices + POS on-account balances
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accounts_receivable_aging(
  p_org_id UUID,
  p_as_of DATE DEFAULT current_date
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB := '[]'::jsonb;
  v_current NUMERIC := 0;
  v_1_30 NUMERIC := 0;
  v_31_60 NUMERIC := 0;
  v_61_90 NUMERIC := 0;
  v_over_90 NUMERIC := 0;
  v_total NUMERIC := 0;
  v_days INT;
  v_bucket TEXT;
  v_amt NUMERIC;
  r RECORD;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR r IN
    SELECT
      'invoice'::text AS kind,
      ci.id,
      ci.invoice_no AS reference,
      c.name AS customer_name,
      ci.total AS amount,
      COALESCE(ci.due_date, ci.invoice_date) AS due_date
    FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = p_org_id AND ci.status = 'posted'

    UNION ALL

    SELECT
      'on_account'::text,
      cr.customer_id,
      'On-account balance'::text,
      c.name,
      cr.balance,
      p_as_of
    FROM customer_receivables cr
    JOIN customers c ON c.id = cr.customer_id
    WHERE cr.organization_id = p_org_id AND cr.balance > 0
  LOOP
    v_amt := COALESCE(r.amount, 0);
    IF v_amt <= 0 THEN
      CONTINUE;
    END IF;

    v_days := p_as_of - r.due_date;
    IF r.kind = 'on_account' OR v_days <= 0 THEN
      v_bucket := 'current';
      v_current := v_current + v_amt;
    ELSIF v_days <= 30 THEN
      v_bucket := 'days_1_30';
      v_1_30 := v_1_30 + v_amt;
    ELSIF v_days <= 60 THEN
      v_bucket := 'days_31_60';
      v_31_60 := v_31_60 + v_amt;
    ELSIF v_days <= 90 THEN
      v_bucket := 'days_61_90';
      v_61_90 := v_61_90 + v_amt;
    ELSE
      v_bucket := 'over_90';
      v_over_90 := v_over_90 + v_amt;
    END IF;

    v_total := v_total + v_amt;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'kind', r.kind,
      'id', r.id,
      'reference', r.reference,
      'customer_name', r.customer_name,
      'amount', v_amt,
      'due_date', r.due_date,
      'days_overdue', GREATEST(v_days, 0),
      'bucket', v_bucket
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'as_of', p_as_of,
    'buckets', jsonb_build_object(
      'current', v_current,
      'days_1_30', v_1_30,
      'days_31_60', v_31_60,
      'days_61_90', v_61_90,
      'over_90', v_over_90
    ),
    'total', v_total,
    'rows', v_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accounts_receivable_aging(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- AP aging — open vendor bills
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accounts_payable_aging(
  p_org_id UUID,
  p_as_of DATE DEFAULT current_date
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB := '[]'::jsonb;
  v_current NUMERIC := 0;
  v_1_30 NUMERIC := 0;
  v_31_60 NUMERIC := 0;
  v_61_90 NUMERIC := 0;
  v_over_90 NUMERIC := 0;
  v_total NUMERIC := 0;
  v_days INT;
  v_bucket TEXT;
  v_amt NUMERIC;
  r RECORD;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR r IN
    SELECT
      vb.id,
      COALESCE(vb.bill_no, vb.id::text) AS reference,
      v.name AS vendor_name,
      vb.amount,
      COALESCE(vb.due_date, vb.bill_date) AS due_date
    FROM vendor_bills vb
    JOIN vendors v ON v.id = vb.vendor_id
    WHERE vb.organization_id = p_org_id AND vb.status = 'open'
  LOOP
    v_amt := COALESCE(r.amount, 0);
    IF v_amt <= 0 THEN
      CONTINUE;
    END IF;

    v_days := p_as_of - r.due_date;
    IF v_days <= 0 THEN
      v_bucket := 'current';
      v_current := v_current + v_amt;
    ELSIF v_days <= 30 THEN
      v_bucket := 'days_1_30';
      v_1_30 := v_1_30 + v_amt;
    ELSIF v_days <= 60 THEN
      v_bucket := 'days_31_60';
      v_31_60 := v_31_60 + v_amt;
    ELSIF v_days <= 90 THEN
      v_bucket := 'days_61_90';
      v_61_90 := v_61_90 + v_amt;
    ELSE
      v_bucket := 'over_90';
      v_over_90 := v_over_90 + v_amt;
    END IF;

    v_total := v_total + v_amt;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', r.id,
      'reference', r.reference,
      'vendor_name', r.vendor_name,
      'amount', v_amt,
      'due_date', r.due_date,
      'days_overdue', GREATEST(v_days, 0),
      'bucket', v_bucket
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'as_of', p_as_of,
    'buckets', jsonb_build_object(
      'current', v_current,
      'days_1_30', v_1_30,
      'days_31_60', v_31_60,
      'days_61_90', v_61_90,
      'over_90', v_over_90
    ),
    'total', v_total,
    'rows', v_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accounts_payable_aging(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Credit notes — create & post to GL
-- ---------------------------------------------------------------------------
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

  SELECT COALESCE(tax_rate, 0) INTO v_rate FROM organizations WHERE id = p_org_id;
  v_rate := COALESCE(p_tax_rate, v_rate);

  SELECT COUNT(*) + 1 INTO v_seq FROM customer_credit_notes WHERE organization_id = p_org_id;
  v_cn_no := 'CN-' || lpad(v_seq::text, 5, '0');

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := COALESCE((v_line->>'quantity')::NUMERIC, 1);
    v_price := COALESCE((v_line->>'unitPrice')::NUMERIC, 0);
    v_line_total := round(v_qty * v_price, 2);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_tax := round(v_subtotal * v_rate / 100, 2);
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
    INSERT INTO customer_credit_note_lines (
      credit_note_id, organization_id, description, quantity, unit_price, line_total
    ) VALUES (
      v_cn_id, p_org_id, v_line->>'description', v_qty, v_price, v_line_total
    );
  END LOOP;

  RETURN v_cn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_customer_credit_note(
  UUID, UUID, JSONB, TEXT, NUMERIC, TEXT, UUID, DATE
) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_customer_credit_note(p_credit_note_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cn customer_credit_notes%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_entry_id UUID;
  v_pay_acct UUID;
BEGIN
  SELECT * INTO v_cn FROM customer_credit_notes WHERE id = p_credit_note_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit note not found';
  END IF;
  IF NOT public.user_can_manage(v_cn.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_cn.status <> 'draft' THEN
    RAISE EXCEPTION 'Credit note is not draft';
  END IF;

  PERFORM public.ensure_default_accounts(v_cn.organization_id);

  IF v_cn.subtotal > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_cn.organization_id, '4000'),
      'debit', v_cn.subtotal, 'credit', 0, 'description', 'Credit note revenue reversal'));
  END IF;

  IF v_cn.tax_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_cn.organization_id, '2100'),
      'debit', v_cn.tax_amount, 'credit', 0, 'description', 'Credit note tax reversal'));
  END IF;

  v_pay_acct := CASE v_cn.settlement_method
    WHEN 'ar' THEN public.account_id_by_code(v_cn.organization_id, '1100')
    WHEN 'store_credit' THEN public.account_id_by_code(v_cn.organization_id, '2300')
    WHEN 'cash' THEN public.account_id_by_code(v_cn.organization_id, '1000')
    ELSE public.account_id_by_code(v_cn.organization_id, '2300')
  END;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'accountId', v_pay_acct,
    'debit', 0, 'credit', v_cn.total, 'description', 'Credit note ' || v_cn.settlement_method));

  v_entry_id := public._post_journal_entry_balanced(
    v_cn.organization_id, 'INV', v_cn.credit_date,
    'Credit note ' || v_cn.credit_note_no, 'credit_note', p_credit_note_id, v_lines, auth.uid()
  );

  IF v_cn.settlement_method = 'store_credit' AND v_cn.total > 0 THEN
    INSERT INTO customer_credits (organization_id, customer_id, balance)
    VALUES (v_cn.organization_id, v_cn.customer_id, v_cn.total)
    ON CONFLICT (organization_id, customer_id)
    DO UPDATE SET balance = customer_credits.balance + v_cn.total, updated_at = now();

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, created_by)
    VALUES (
      v_cn.organization_id, v_cn.customer_id, v_cn.total,
      'Credit note ' || v_cn.credit_note_no, auth.uid()
    );
  END IF;

  IF v_cn.settlement_method = 'ar' AND v_cn.total > 0 THEN
    INSERT INTO customer_receivables (organization_id, customer_id, balance)
    VALUES (v_cn.organization_id, v_cn.customer_id, 0)
    ON CONFLICT (organization_id, customer_id) DO NOTHING;

    UPDATE customer_receivables
    SET balance = GREATEST(balance - v_cn.total, 0), updated_at = now()
    WHERE organization_id = v_cn.organization_id AND customer_id = v_cn.customer_id;

    INSERT INTO receivable_transactions (organization_id, customer_id, amount, reason, created_by)
    VALUES (
      v_cn.organization_id, v_cn.customer_id, -v_cn.total,
      'Credit note ' || v_cn.credit_note_no, auth.uid()
    );
  END IF;

  UPDATE customer_credit_notes
  SET status = 'posted', journal_entry_id = v_entry_id
  WHERE id = p_credit_note_id;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_customer_credit_note(UUID) TO authenticated;

-- Manual store-credit issuance → GL (Dr expense, Cr store credit liability)
CREATE OR REPLACE FUNCTION public.issue_customer_credit(
  p_org_id UUID,
  p_customer_id UUID,
  p_amount NUMERIC,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, created_by)
  VALUES (p_org_id, p_customer_id, p_amount, p_reason, auth.uid())
  RETURNING id INTO v_tx_id;

  INSERT INTO customer_credits (organization_id, customer_id, balance)
  VALUES (p_org_id, p_customer_id, p_amount)
  ON CONFLICT (organization_id, customer_id)
  DO UPDATE SET balance = customer_credits.balance + p_amount, updated_at = now();

  PERFORM public.ensure_default_accounts(p_org_id);

  PERFORM public._post_journal_entry_balanced(
    p_org_id, 'GEN', current_date,
    COALESCE(NULLIF(trim(p_reason), ''), 'Store credit issued'),
    'credit_issue', v_tx_id,
    jsonb_build_array(
      jsonb_build_object(
        'accountId', public.account_id_by_code(p_org_id, '6000'),
        'debit', p_amount, 'credit', 0, 'description', 'Store credit issued'),
      jsonb_build_object(
        'accountId', public.account_id_by_code(p_org_id, '2300'),
        'debit', 0, 'credit', p_amount, 'description', 'Store credit liability')
    ),
    auth.uid()
  );

  RETURN v_tx_id;
END;
$$;

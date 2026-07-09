-- Phase C — Control & compliance: fiscal periods, period close, lock dates, JE draft approval.

-- ---------------------------------------------------------------------------
-- Org accounting controls
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS accounting_lock_date DATE,
  ADD COLUMN IF NOT EXISTS je_requires_approval BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Fiscal calendar
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_period_status') THEN
    CREATE TYPE fiscal_period_status AS ENUM ('open', 'closed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.fiscal_years (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year INT NOT NULL,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, year)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_org ON fiscal_years(organization_id);

CREATE TABLE IF NOT EXISTS public.fiscal_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  period_no INT NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status fiscal_period_status NOT NULL DEFAULT 'open',
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id),
  closing_entry_id UUID REFERENCES journal_entries(id),
  UNIQUE (fiscal_year_id, period_no)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_org ON fiscal_periods(organization_id, start_date);

ALTER TABLE fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_years_select ON fiscal_years;
CREATE POLICY fiscal_years_select ON fiscal_years FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS fiscal_years_write ON fiscal_years;
CREATE POLICY fiscal_years_write ON fiscal_years FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS fiscal_periods_select ON fiscal_periods;
CREATE POLICY fiscal_periods_select ON fiscal_periods FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS fiscal_periods_write ON fiscal_periods;
CREATE POLICY fiscal_periods_write ON fiscal_periods FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Journal entry status (draft → posted approval workflow)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_entry_status') THEN
    CREATE TYPE journal_entry_status AS ENUM ('draft', 'posted');
  END IF;
END $$;

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS entry_status journal_entry_status NOT NULL DEFAULT 'posted';

CREATE INDEX IF NOT EXISTS idx_je_org_status ON journal_entries(organization_id, entry_status);

-- ---------------------------------------------------------------------------
-- Period lock guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._refresh_accounting_lock_date(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock DATE;
BEGIN
  SELECT MAX(end_date) INTO v_lock
  FROM fiscal_periods
  WHERE organization_id = p_org_id AND status = 'closed'::fiscal_period_status;

  UPDATE organizations
  SET accounting_lock_date = v_lock
  WHERE id = p_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._assert_accounting_date_open(p_org_id UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock DATE;
BEGIN
  SELECT accounting_lock_date INTO v_lock FROM organizations WHERE id = p_org_id;

  IF v_lock IS NOT NULL AND p_date <= v_lock THEN
    RAISE EXCEPTION 'Accounting period is locked through %. Choose a later date or reopen the period.', v_lock;
  END IF;

  IF EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.organization_id = p_org_id
      AND fp.status = 'closed'::fiscal_period_status
      AND p_date BETWEEN fp.start_date AND fp.end_date
  ) THEN
    RAISE EXCEPTION 'Fiscal period containing % is closed', p_date;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._je_is_posted(p_status journal_entry_status)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, 'posted'::journal_entry_status) = 'posted'::journal_entry_status;
$$;

-- ---------------------------------------------------------------------------
-- Balanced JE writer — enforces lock for posted entries
-- Drop the Phase A 8-arg overload first. Leaving both signatures makes
-- 8-arg call sites fail with "function is not unique".
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._post_journal_entry_balanced(
  UUID, TEXT, DATE, TEXT, TEXT, UUID, JSONB, UUID
);

CREATE OR REPLACE FUNCTION public._post_journal_entry_balanced(
  p_org_id UUID,
  p_journal_code TEXT,
  p_date DATE,
  p_memo TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_lines JSONB,
  p_created_by UUID DEFAULT NULL,
  p_status journal_entry_status DEFAULT 'posted'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journal_id UUID;
  v_entry_id UUID;
  v_line JSONB;
  v_debits NUMERIC := 0;
  v_credits NUMERIC := 0;
  v_status journal_entry_status := COALESCE(p_status, 'posted'::journal_entry_status);
BEGIN
  IF v_status = 'posted'::journal_entry_status THEN
    PERFORM public._assert_accounting_date_open(p_org_id, COALESCE(p_date, current_date));
  END IF;

  SELECT id INTO v_journal_id FROM journals WHERE organization_id = p_org_id AND code = p_journal_code;
  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'Journal % not found', p_journal_code;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_debits  := v_debits  + COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_credits := v_credits + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF abs(v_debits - v_credits) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry not balanced: debits % vs credits %', v_debits, v_credits;
  END IF;

  INSERT INTO journal_entries (
    organization_id, journal_id, entry_date, memo, source_type, source_id, created_by, entry_status
  )
  VALUES (
    p_org_id, v_journal_id, COALESCE(p_date, current_date), p_memo,
    p_source_type, p_source_id, p_created_by, v_status
  )
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO journal_entry_lines (entry_id, organization_id, account_id, debit, credit, description)
    VALUES (
      v_entry_id, p_org_id,
      (v_line->>'accountId')::UUID,
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description'
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_org_id UUID,
  p_journal_code TEXT,
  p_date DATE,
  p_memo TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requires_approval BOOLEAN;
  v_status journal_entry_status;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(je_requires_approval, false) INTO v_requires_approval
  FROM organizations WHERE id = p_org_id;

  v_status := CASE WHEN v_requires_approval THEN 'draft'::journal_entry_status ELSE 'posted'::journal_entry_status END;

  RETURN public._post_journal_entry_balanced(
    p_org_id, p_journal_code, p_date, p_memo, p_source_type, p_source_id, p_lines, auth.uid(), v_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_journal_entry(p_entry_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry journal_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_entry FROM journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;
  IF NOT public.user_can_manage(v_entry.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_entry.entry_status <> 'draft'::journal_entry_status THEN
    RAISE EXCEPTION 'Only draft entries can be approved';
  END IF;

  PERFORM public._assert_accounting_date_open(v_entry.organization_id, v_entry.entry_date);

  UPDATE journal_entries
  SET entry_status = 'posted'::journal_entry_status
  WHERE id = p_entry_id;

  RETURN p_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_journal_entry(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_journal_entry_draft(p_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry journal_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_entry FROM journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;
  IF NOT public.user_can_manage(v_entry.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_entry.entry_status <> 'draft'::journal_entry_status THEN
    RAISE EXCEPTION 'Only draft entries can be rejected';
  END IF;

  DELETE FROM journal_entry_lines WHERE entry_id = p_entry_id;
  DELETE FROM journal_entries WHERE id = p_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_journal_entry_draft(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_journal_entry_drafts(p_org_id UUID)
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
        'id', je.id,
        'entry_date', je.entry_date,
        'memo', je.memo,
        'source_type', je.source_type,
        'created_at', je.created_at,
        'journal_code', j.code,
        'total_debit', COALESCE((
          SELECT SUM(jel.debit) FROM journal_entry_lines jel WHERE jel.entry_id = je.id
        ), 0),
        'lines', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', jel.id,
              'debit', jel.debit,
              'credit', jel.credit,
              'description', jel.description,
              'account_code', a.code,
              'account_name', a.name
            ) ORDER BY a.code
          )
          FROM journal_entry_lines jel
          JOIN accounts a ON a.id = jel.account_id
          WHERE jel.entry_id = je.id
        ), '[]'::jsonb)
      ) ORDER BY je.created_at DESC
    )
    FROM journal_entries je
    JOIN journals j ON j.id = je.journal_id
    WHERE je.organization_id = p_org_id
      AND je.entry_status = 'draft'::journal_entry_status
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_journal_entry_drafts(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Fiscal year bootstrap (calendar year, 12 monthly periods)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_fiscal_year(p_org_id UUID, p_year INT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM current_date)::INT);
  v_year_id UUID;
  v_month INT;
  v_start DATE;
  v_end DATE;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT id INTO v_year_id
  FROM fiscal_years
  WHERE organization_id = p_org_id AND year = v_year;

  IF v_year_id IS NOT NULL THEN
    RETURN v_year_id;
  END IF;

  INSERT INTO fiscal_years (organization_id, year, name, start_date, end_date)
  VALUES (
    p_org_id, v_year, v_year::text,
    make_date(v_year, 1, 1),
    make_date(v_year, 12, 31)
  )
  RETURNING id INTO v_year_id;

  FOR v_month IN 1..12 LOOP
    v_start := make_date(v_year, v_month, 1);
    v_end := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
    INSERT INTO fiscal_periods (
      organization_id, fiscal_year_id, period_no, name, start_date, end_date, status
    ) VALUES (
      p_org_id, v_year_id, v_month,
      trim(to_char(v_start, 'Month')) || ' ' || v_year::text,
      v_start, v_end, 'open'::fiscal_period_status
    );
  END LOOP;

  RETURN v_year_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_fiscal_year(UUID, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_fiscal_periods(p_org_id UUID, p_year INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM current_date)::INT);
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'year', v_year,
    'lock_date', (SELECT accounting_lock_date FROM organizations WHERE id = p_org_id),
    'periods', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', fp.id,
          'period_no', fp.period_no,
          'name', fp.name,
          'start_date', fp.start_date,
          'end_date', fp.end_date,
          'status', fp.status,
          'closed_at', fp.closed_at,
          'closing_entry_id', fp.closing_entry_id
        ) ORDER BY fp.period_no
      )
      FROM fiscal_periods fp
      JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
      WHERE fp.organization_id = p_org_id AND fy.year = v_year
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_fiscal_periods(UUID, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Period close — transfer P&L to retained earnings (3900)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_fiscal_period(p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period fiscal_periods%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_re_acct UUID;
  v_row RECORD;
  v_income_total NUMERIC := 0;
  v_expense_total NUMERIC := 0;
  v_entry_id UUID;
  v_net NUMERIC;
BEGIN
  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period not found';
  END IF;
  IF NOT public.user_can_manage(v_period.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_period.status = 'closed'::fiscal_period_status THEN
    RETURN jsonb_build_object('already_closed', true, 'period_id', p_period_id);
  END IF;

  PERFORM public.ensure_default_accounts(v_period.organization_id);
  v_re_acct := public.account_id_by_code(v_period.organization_id, '3900');

  FOR v_row IN
    SELECT a.id AS account_id, a.code,
      COALESCE(SUM(jel.credit - jel.debit), 0) AS net_income
    FROM accounts a
    JOIN journal_entry_lines jel ON jel.account_id = a.id
    JOIN journal_entries je ON je.id = jel.entry_id
    WHERE a.organization_id = v_period.organization_id
      AND a.type = 'income'::account_type
      AND je.entry_date BETWEEN v_period.start_date AND v_period.end_date
      AND public._je_is_posted(je.entry_status)
    GROUP BY a.id, a.code
    HAVING COALESCE(SUM(jel.credit - jel.debit), 0) <> 0
  LOOP
    IF v_row.net_income > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_row.account_id,
        'debit', v_row.net_income, 'credit', 0,
        'description', 'Close revenue — ' || v_period.name));
      v_income_total := v_income_total + v_row.net_income;
    ELSIF v_row.net_income < 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_row.account_id,
        'debit', 0, 'credit', abs(v_row.net_income),
        'description', 'Close revenue — ' || v_period.name));
      v_income_total := v_income_total + v_row.net_income;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT a.id AS account_id, a.code,
      COALESCE(SUM(jel.debit - jel.credit), 0) AS net_expense
    FROM accounts a
    JOIN journal_entry_lines jel ON jel.account_id = a.id
    JOIN journal_entries je ON je.id = jel.entry_id
    WHERE a.organization_id = v_period.organization_id
      AND a.type = 'expense'::account_type
      AND je.entry_date BETWEEN v_period.start_date AND v_period.end_date
      AND public._je_is_posted(je.entry_status)
    GROUP BY a.id, a.code
    HAVING COALESCE(SUM(jel.debit - jel.credit), 0) <> 0
  LOOP
    IF v_row.net_expense > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_row.account_id,
        'debit', 0, 'credit', v_row.net_expense,
        'description', 'Close expense — ' || v_period.name));
      v_expense_total := v_expense_total + v_row.net_expense;
    ELSIF v_row.net_expense < 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_row.account_id,
        'debit', abs(v_row.net_expense), 'credit', 0,
        'description', 'Close expense — ' || v_period.name));
      v_expense_total := v_expense_total + v_row.net_expense;
    END IF;
  END LOOP;

  v_net := v_income_total - v_expense_total;

  IF abs(v_net) > 0.01 THEN
    IF v_net > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_re_acct,
        'debit', 0, 'credit', v_net,
        'description', 'Net income to retained earnings'));
    ELSE
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_re_acct,
        'debit', abs(v_net), 'credit', 0,
        'description', 'Net loss to retained earnings'));
    END IF;
  END IF;

  IF jsonb_array_length(v_lines) > 0 THEN
    v_entry_id := public._post_journal_entry_balanced(
      v_period.organization_id, 'GEN', v_period.end_date,
      'Period close — ' || v_period.name,
      'period_close', p_period_id, v_lines, auth.uid(), 'posted'::journal_entry_status
    );
  END IF;

  UPDATE fiscal_periods
  SET status = 'closed'::fiscal_period_status,
      closed_at = now(),
      closed_by = auth.uid(),
      closing_entry_id = v_entry_id
  WHERE id = p_period_id;

  PERFORM public._refresh_accounting_lock_date(v_period.organization_id);

  RETURN jsonb_build_object(
    'period_id', p_period_id,
    'closing_entry_id', v_entry_id,
    'net_transferred', v_net,
    'lock_date', (SELECT accounting_lock_date FROM organizations WHERE id = v_period.organization_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_fiscal_period(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reopen_fiscal_period(p_period_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period fiscal_periods%ROWTYPE;
  v_latest_closed UUID;
BEGIN
  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period not found';
  END IF;
  IF NOT public.user_can_manage(v_period.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_period.status <> 'closed'::fiscal_period_status THEN
    RAISE EXCEPTION 'Period is not closed';
  END IF;

  SELECT fp.id INTO v_latest_closed
  FROM fiscal_periods fp
  WHERE fp.organization_id = v_period.organization_id
    AND fp.status = 'closed'::fiscal_period_status
  ORDER BY fp.end_date DESC
  LIMIT 1;

  IF v_latest_closed IS DISTINCT FROM p_period_id THEN
    RAISE EXCEPTION 'Only the most recently closed period can be reopened';
  END IF;

  UPDATE fiscal_periods
  SET status = 'open'::fiscal_period_status,
      closed_at = NULL,
      closed_by = NULL
  WHERE id = p_period_id;

  PERFORM public._refresh_accounting_lock_date(v_period.organization_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_fiscal_period(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Statements & ledger — posted entries only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trial_balance(
  p_org_id UUID,
  p_to DATE DEFAULT current_date
)
RETURNS TABLE (
  account_code TEXT,
  account_name TEXT,
  account_type account_type,
  debit NUMERIC,
  credit NUMERIC,
  balance NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.code, a.name, a.type,
    COALESCE(SUM(jel.debit), 0) AS debit,
    COALESCE(SUM(jel.credit), 0) AS credit,
    COALESCE(SUM(jel.debit - jel.credit), 0) AS balance
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.entry_id
    AND je.entry_date <= p_to
    AND public._je_is_posted(je.entry_status)
  WHERE a.organization_id = p_org_id
    AND public.user_has_org_access(p_org_id)
  GROUP BY a.code, a.name, a.type
  ORDER BY a.code;
$$;

CREATE OR REPLACE FUNCTION public.balance_sheet(
  p_org_id UUID,
  p_to DATE DEFAULT current_date
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assets JSONB;
  v_liabilities JSONB;
  v_equity JSONB;
  v_total_assets NUMERIC := 0;
  v_total_liab NUMERIC := 0;
  v_total_equity NUMERIC := 0;
  v_net_income NUMERIC := 0;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  WITH bal AS (
    SELECT a.code, a.name, a.type,
      COALESCE(SUM(jel.debit - jel.credit), 0) AS net
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jel.entry_id
      AND je.entry_date <= p_to
      AND public._je_is_posted(je.entry_status)
    WHERE a.organization_id = p_org_id
    GROUP BY a.code, a.name, a.type
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', net)
             ORDER BY code) FILTER (WHERE type = 'asset' AND net <> 0), '[]'::jsonb),
    COALESCE(SUM(net) FILTER (WHERE type = 'asset'), 0),
    COALESCE(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', -net)
             ORDER BY code) FILTER (WHERE type = 'liability' AND net <> 0), '[]'::jsonb),
    COALESCE(SUM(-net) FILTER (WHERE type = 'liability'), 0),
    COALESCE(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', -net)
             ORDER BY code) FILTER (WHERE type = 'equity' AND net <> 0), '[]'::jsonb),
    COALESCE(SUM(-net) FILTER (WHERE type = 'equity'), 0),
    COALESCE(SUM(-net) FILTER (WHERE type IN ('income', 'expense')), 0)
  INTO v_assets, v_total_assets, v_liabilities, v_total_liab, v_equity, v_total_equity, v_net_income
  FROM bal;

  RETURN jsonb_build_object(
    'as_of', p_to,
    'assets', v_assets,
    'total_assets', v_total_assets,
    'liabilities', v_liabilities,
    'total_liabilities', v_total_liab,
    'equity', v_equity,
    'current_earnings', v_net_income,
    'total_equity', v_total_equity + v_net_income,
    'total_liabilities_and_equity', v_total_liab + v_total_equity + v_net_income,
    'balanced', abs(v_total_assets - (v_total_liab + v_total_equity + v_net_income)) < 0.01
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_flow(
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
DECLARE
  v_opening NUMERIC := 0;
  v_inflow NUMERIC := 0;
  v_outflow NUMERIC := 0;
  v_breakdown JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO v_opening
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE a.organization_id = p_org_id
    AND a.code IN ('1000', '1010', '1020')
    AND je.entry_date < p_from
    AND public._je_is_posted(je.entry_status);

  SELECT
    COALESCE(SUM(jel.debit), 0),
    COALESCE(SUM(jel.credit), 0)
  INTO v_inflow, v_outflow
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE a.organization_id = p_org_id
    AND a.code IN ('1000', '1010', '1020')
    AND je.entry_date BETWEEN p_from AND p_to
    AND public._je_is_posted(je.entry_status);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('source', src, 'net', net) ORDER BY net DESC), '[]'::jsonb)
  INTO v_breakdown
  FROM (
    SELECT COALESCE(je.source_type, 'manual') AS src,
           SUM(jel.debit - jel.credit) AS net
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE a.organization_id = p_org_id
      AND a.code IN ('1000', '1010', '1020')
      AND je.entry_date BETWEEN p_from AND p_to
      AND public._je_is_posted(je.entry_status)
    GROUP BY COALESCE(je.source_type, 'manual')
  ) t;

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'opening_cash', v_opening,
    'inflows', v_inflow,
    'outflows', v_outflow,
    'net_change', v_inflow - v_outflow,
    'closing_cash', v_opening + v_inflow - v_outflow,
    'by_source', v_breakdown
  );
END;
$$;

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
    AND public._je_is_posted(je.entry_status)
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
      'entry_status', je.entry_status,
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
      AND public._je_is_posted(je.entry_status)
      AND (p_source_type IS NULL OR je.source_type = p_source_type)
    ORDER BY je.entry_date DESC, je.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('total', v_total, 'entries', v_entries);
END;
$$;

-- Patch GL mode in profit_and_loss (4-arg version from Phase A)
CREATE OR REPLACE FUNCTION public.profit_and_loss(
  p_org_id UUID,
  p_from DATE,
  p_to DATE,
  p_mode TEXT DEFAULT 'operational'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revenue NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_cogs NUMERIC := 0;
  v_opex NUMERIC := 0;
  v_gross NUMERIC := 0;
  v_net NUMERIC := 0;
  v_tz TEXT;
  v_today DATE;
  v_mode TEXT := lower(COALESCE(p_mode, 'operational'));
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_mode = 'gl' THEN
    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
      INTO v_revenue
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.organization_id = p_org_id
      AND je.entry_date BETWEEN p_from AND p_to
      AND public._je_is_posted(je.entry_status)
      AND a.type = 'income';

    SELECT COALESCE(SUM(jel.debit - jel.credit), 0)
      INTO v_cogs
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.organization_id = p_org_id
      AND je.entry_date BETWEEN p_from AND p_to
      AND public._je_is_posted(je.entry_status)
      AND a.code = '5000';

    SELECT COALESCE(SUM(jel.debit - jel.credit), 0)
      INTO v_opex
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.organization_id = p_org_id
      AND je.entry_date BETWEEN p_from AND p_to
      AND public._je_is_posted(je.entry_status)
      AND a.type = 'expense'
      AND a.code <> '5000';

    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
      INTO v_tax
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.organization_id = p_org_id
      AND je.entry_date BETWEEN p_from AND p_to
      AND public._je_is_posted(je.entry_status)
      AND a.code = '2100';

    v_gross := v_revenue - v_cogs;
    v_net := v_gross - v_opex;

    RETURN jsonb_build_object(
      'from', p_from, 'to', p_to,
      'revenue', v_revenue,
      'tax_collected', v_tax,
      'cogs', v_cogs,
      'gross_profit', v_gross,
      'gross_margin_pct', CASE WHEN v_revenue > 0 THEN round((v_gross / v_revenue) * 100, 1) ELSE 0 END,
      'operating_expenses', v_opex,
      'net_profit', v_net,
      'net_margin_pct', CASE WHEN v_revenue > 0 THEN round((v_net / v_revenue) * 100, 1) ELSE 0 END,
      'source', 'gl'
    );
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM organizations WHERE id = p_org_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT
    COALESCE(SUM(revenue), 0),
    COALESCE(SUM(tax_collected), 0),
    COALESCE(SUM(cogs), 0)
  INTO v_revenue, v_tax, v_cogs
  FROM org_daily_sales_summary
  WHERE organization_id = p_org_id
    AND store_id = '00000000-0000-0000-0000-000000000000'::uuid
    AND summary_date BETWEEN p_from AND p_to
    AND summary_date < v_today;

  IF p_to >= v_today AND p_from <= v_today THEN
    SELECT
      v_revenue + COALESCE(SUM(s.subtotal - s.discount_amount), 0),
      v_tax + COALESCE(SUM(s.tax_amount), 0)
    INTO v_revenue, v_tax
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_tz)::date = v_today;

    SELECT v_cogs + COALESCE(SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
    INTO v_cogs
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    LEFT JOIN product_variants pv ON pv.id = sl.variant_id
    LEFT JOIN products p ON p.id = pv.product_id
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_tz)::date = v_today;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_daily_sales_summary
    WHERE organization_id = p_org_id AND summary_date BETWEEN p_from AND LEAST(p_to, v_today - 1)
  ) AND p_from < v_today THEN
    SELECT COALESCE(SUM(s.subtotal - s.discount_amount), 0), COALESCE(SUM(s.tax_amount), 0)
      INTO v_revenue, v_tax
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND s.created_at::date BETWEEN p_from AND p_to;

    SELECT COALESCE(SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
      INTO v_cogs
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    LEFT JOIN product_variants pv ON pv.id = sl.variant_id
    LEFT JOIN products p ON p.id = pv.product_id
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND s.created_at::date BETWEEN p_from AND p_to;
  END IF;

  SELECT COALESCE(SUM(e.amount), 0) INTO v_opex
  FROM expenses e
  WHERE e.organization_id = p_org_id
    AND e.expense_date BETWEEN p_from AND p_to;

  v_gross := v_revenue - v_cogs;
  v_net := v_gross - v_opex;

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenue', v_revenue,
    'tax_collected', v_tax,
    'cogs', v_cogs,
    'gross_profit', v_gross,
    'gross_margin_pct', CASE WHEN v_revenue > 0 THEN round((v_gross / v_revenue) * 100, 1) ELSE 0 END,
    'operating_expenses', v_opex,
    'net_profit', v_net,
    'net_margin_pct', CASE WHEN v_revenue > 0 THEN round((v_net / v_revenue) * 100, 1) ELSE 0 END,
    'source', CASE
      WHEN EXISTS (
        SELECT 1 FROM org_daily_sales_summary
        WHERE organization_id = p_org_id AND summary_date BETWEEN p_from AND p_to
      ) THEN 'rollup'
      ELSE 'live'
    END
  );
END;
$$;

-- Bootstrap fiscal years for existing organizations (migration — no auth check)
DO $$
DECLARE
  r RECORD;
  v_year INT := EXTRACT(YEAR FROM current_date)::INT;
  v_year_id UUID;
  v_month INT;
  v_start DATE;
  v_end DATE;
BEGIN
  FOR r IN SELECT id FROM organizations LOOP
    IF EXISTS (SELECT 1 FROM fiscal_years WHERE organization_id = r.id AND year = v_year) THEN
      CONTINUE;
    END IF;

    INSERT INTO fiscal_years (organization_id, year, name, start_date, end_date)
    VALUES (r.id, v_year, v_year::text, make_date(v_year, 1, 1), make_date(v_year, 12, 31))
    RETURNING id INTO v_year_id;

    FOR v_month IN 1..12 LOOP
      v_start := make_date(v_year, v_month, 1);
      v_end := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
      INSERT INTO fiscal_periods (
        organization_id, fiscal_year_id, period_no, name, start_date, end_date, status
      ) VALUES (
        r.id, v_year_id, v_month,
        trim(to_char(v_start, 'Month')) || ' ' || v_year::text,
        v_start, v_end, 'open'::fiscal_period_status
      );
    END LOOP;
  END LOOP;
END $$;

-- Phase 4: HR / Payroll + Balance Sheet & Cash Flow statements
-- Adds employees, payroll runs + payslips (posted to the ledger), and two more
-- financial statements computed from the ledger.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_type') THEN
    CREATE TYPE employment_type AS ENUM ('full_time', 'part_time', 'contract');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employee_status') THEN
    CREATE TYPE employee_status AS ENUM ('active', 'on_leave', 'terminated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_status') THEN
    CREATE TYPE payroll_status AS ENUM ('draft', 'posted');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  position TEXT,
  email TEXT,
  phone TEXT,
  employment_type employment_type NOT NULL DEFAULT 'full_time',
  base_salary NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  payment_method payment_method NOT NULL DEFAULT 'bank_transfer',
  hire_date DATE NOT NULL DEFAULT current_date,
  status employee_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employees_org ON employees(organization_id, status);

DROP TRIGGER IF EXISTS employees_updated_at ON employees;
CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  payment_method payment_method NOT NULL DEFAULT 'bank_transfer',
  status payroll_status NOT NULL DEFAULT 'draft',
  total_gross NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(14,2) NOT NULL DEFAULT 0,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_org ON payroll_runs(organization_id, period_end DESC);

CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  gross NUMERIC(14,2) NOT NULL DEFAULT 0,
  allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  net NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(run_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;

-- Employees: members read, managers manage.
CREATE POLICY employees_select ON employees FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY employees_write ON employees FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- Payroll: read for managers only (sensitive); posting via SECURITY DEFINER.
CREATE POLICY payroll_select ON payroll_runs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));
CREATE POLICY payslips_select ON payslips FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Run payroll: create run + payslips and post to the ledger.
-- p_lines: [{employeeId, gross, allowances, deductions, tax}]
-- Ledger: Dr Salaries (gross+allowances); Cr Tax/Deductions Payable (tax+deductions);
--         Cr Cash/Bank/Mobile (net).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_payroll(
  p_org_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_payment_method payment_method,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_entry_id UUID;
  v_line JSONB;
  v_gross NUMERIC;
  v_allow NUMERIC;
  v_ded NUMERIC;
  v_tax NUMERIC;
  v_net NUMERIC;
  v_sum_gross NUMERIC := 0;
  v_sum_allow NUMERIC := 0;
  v_sum_ded NUMERIC := 0;
  v_sum_tax NUMERIC := 0;
  v_sum_net NUMERIC := 0;
  v_pay_acct UUID;
  v_je_lines JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  PERFORM public.ensure_default_accounts(p_org_id);

  INSERT INTO payroll_runs (organization_id, period_start, period_end, payment_method, status, created_by)
  VALUES (p_org_id, p_period_start, p_period_end, p_payment_method, 'draft', auth.uid())
  RETURNING id INTO v_run_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_gross := COALESCE((v_line->>'gross')::NUMERIC, 0);
    v_allow := COALESCE((v_line->>'allowances')::NUMERIC, 0);
    v_ded   := COALESCE((v_line->>'deductions')::NUMERIC, 0);
    v_tax   := COALESCE((v_line->>'tax')::NUMERIC, 0);
    v_net   := v_gross + v_allow - v_ded - v_tax;

    INSERT INTO payslips (organization_id, run_id, employee_id, gross, allowances, deductions, tax, net)
    VALUES (p_org_id, v_run_id, (v_line->>'employeeId')::UUID, v_gross, v_allow, v_ded, v_tax, v_net);

    v_sum_gross := v_sum_gross + v_gross;
    v_sum_allow := v_sum_allow + v_allow;
    v_sum_ded   := v_sum_ded + v_ded;
    v_sum_tax   := v_sum_tax + v_tax;
    v_sum_net   := v_sum_net + v_net;
  END LOOP;

  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(p_org_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(p_org_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(p_org_id, '1020')
    ELSE public.account_id_by_code(p_org_id, '1010')
  END;

  -- Dr Salaries expense (6400)
  v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
    'accountId', public.account_id_by_code(p_org_id, '6400'),
    'debit', v_sum_gross + v_sum_allow, 'credit', 0, 'description', 'Payroll gross'));

  -- Cr Tax/Deductions payable (2100)
  IF (v_sum_tax + v_sum_ded) > 0 THEN
    v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(p_org_id, '2100'),
      'debit', 0, 'credit', v_sum_tax + v_sum_ded, 'description', 'Payroll tax & deductions'));
  END IF;

  -- Cr cash/bank for net pay
  v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
    'accountId', v_pay_acct,
    'debit', 0, 'credit', v_sum_net, 'description', 'Net pay'));

  v_entry_id := public.post_journal_entry(
    p_org_id, 'GEN', p_period_end,
    'Payroll ' || p_period_start || ' to ' || p_period_end,
    'payroll', v_run_id, v_je_lines
  );

  UPDATE payroll_runs
  SET status = 'posted',
      total_gross = v_sum_gross + v_sum_allow,
      total_deductions = v_sum_ded,
      total_tax = v_sum_tax,
      total_net = v_sum_net,
      journal_entry_id = v_entry_id
  WHERE id = v_run_id;

  RETURN v_run_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_payroll TO authenticated;

-- ---------------------------------------------------------------------------
-- Balance Sheet (from the ledger, as of a date).
-- ---------------------------------------------------------------------------
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
    LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.entry_date <= p_to
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
    -- net income = income credits less expense debits (both stored as debit-credit)
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
GRANT EXECUTE ON FUNCTION public.balance_sheet TO authenticated;

-- ---------------------------------------------------------------------------
-- Cash Flow (cash-basis movement across cash/bank/mobile accounts).
-- ---------------------------------------------------------------------------
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

  -- opening balance of cash accounts before the period
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO v_opening
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE a.organization_id = p_org_id
    AND a.code IN ('1000', '1010', '1020')
    AND je.entry_date < p_from;

  -- inflows / outflows within the period
  SELECT
    COALESCE(SUM(jel.debit), 0),
    COALESCE(SUM(jel.credit), 0)
  INTO v_inflow, v_outflow
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE a.organization_id = p_org_id
    AND a.code IN ('1000', '1010', '1020')
    AND je.entry_date BETWEEN p_from AND p_to;

  -- net cash movement grouped by source type (sale, expense, payroll, ...)
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
    GROUP BY COALESCE(je.source_type, 'manual')
  ) t;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'opening_cash', v_opening,
    'inflows', v_inflow,
    'outflows', v_outflow,
    'net_change', v_inflow - v_outflow,
    'closing_cash', v_opening + v_inflow - v_outflow,
    'by_source', v_breakdown
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.cash_flow TO authenticated;

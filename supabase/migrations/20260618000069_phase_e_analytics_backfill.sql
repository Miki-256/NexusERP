-- Idempotent Phase E analytics backfill (remote may have partial schema from 00065).

CREATE TABLE IF NOT EXISTS public.analytic_departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_analytic_departments_org ON analytic_departments(organization_id);

ALTER TABLE journal_entry_lines
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES analytic_departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jel_store ON journal_entry_lines(organization_id, store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jel_project ON journal_entry_lines(organization_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jel_department ON journal_entry_lines(organization_id, department_id) WHERE department_id IS NOT NULL;

ALTER TABLE analytic_departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analytic_departments_select ON analytic_departments;
DROP POLICY IF EXISTS analytic_departments_write ON analytic_departments;
DROP POLICY IF EXISTS analytic_departments_select ON analytic_departments;
CREATE POLICY analytic_departments_select ON analytic_departments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS analytic_departments_write ON analytic_departments;
CREATE POLICY analytic_departments_write ON analytic_departments FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'budget_status') THEN
    CREATE TYPE budget_status AS ENUM ('draft', 'active', 'closed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.budgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status budget_status NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_budgets_org ON budgets(organization_id, period_start DESC);

CREATE TABLE IF NOT EXISTS public.budget_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  department_id UUID REFERENCES analytic_departments(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_budget_lines_budget ON budget_lines(budget_id);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budgets_select ON budgets;
DROP POLICY IF EXISTS budgets_write ON budgets;
DROP POLICY IF EXISTS budget_lines_select ON budget_lines;
DROP POLICY IF EXISTS budget_lines_write ON budget_lines;
DROP POLICY IF EXISTS budgets_select ON budgets;
CREATE POLICY budgets_select ON budgets FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS budgets_write ON budgets;
CREATE POLICY budgets_write ON budgets FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));
DROP POLICY IF EXISTS budget_lines_select ON budget_lines;
CREATE POLICY budget_lines_select ON budget_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS budget_lines_write ON budget_lines;
CREATE POLICY budget_lines_write ON budget_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE OR REPLACE FUNCTION public.list_departments(p_org_id UUID)
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
        'id', d.id,
        'code', d.code,
        'name', d.name,
        'is_active', d.is_active
      ) ORDER BY d.code
    )
    FROM analytic_departments d
    WHERE d.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_departments(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_department(
  p_org_id UUID,
  p_department_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_department_id IS NOT NULL THEN
    UPDATE analytic_departments
    SET code = trim(p_code), name = trim(p_name), is_active = COALESCE(p_is_active, true)
    WHERE id = p_department_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Department not found';
    END IF;
  ELSE
    INSERT INTO analytic_departments (organization_id, code, name, is_active)
    VALUES (p_org_id, trim(p_code), trim(p_name), COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_department(UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- Budget CRUD + budget vs actual
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_budgets(p_org_id UUID)
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
        'id', b.id,
        'name', b.name,
        'period_start', b.period_start,
        'period_end', b.period_end,
        'status', b.status,
        'line_count', (SELECT COUNT(*)::INT FROM budget_lines bl WHERE bl.budget_id = b.id),
        'total_budget', COALESCE((SELECT SUM(bl.amount) FROM budget_lines bl WHERE bl.budget_id = b.id), 0)
      ) ORDER BY b.period_start DESC
    )
    FROM budgets b
    WHERE b.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_budgets(UUID) TO authenticated;

-- p_lines: [{accountId, amount, storeId?, projectId?, departmentId?, notes?}]
CREATE OR REPLACE FUNCTION public.upsert_budget(
  p_org_id UUID,
  p_budget_id UUID,
  p_name TEXT,
  p_period_start DATE,
  p_period_end DATE,
  p_status TEXT DEFAULT 'draft',
  p_lines JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_line JSONB;
  v_status budget_status;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Period end must be on or after start';
  END IF;

  v_status := COALESCE(p_status, 'draft')::budget_status;

  IF p_budget_id IS NOT NULL THEN
    UPDATE budgets
    SET name = trim(p_name), period_start = p_period_start, period_end = p_period_end, status = v_status
    WHERE id = p_budget_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Budget not found';
    END IF;
    DELETE FROM budget_lines WHERE budget_id = v_id;
  ELSE
    INSERT INTO budgets (organization_id, name, period_start, period_end, status, created_by)
    VALUES (p_org_id, trim(p_name), p_period_start, p_period_end, v_status, auth.uid())
    RETURNING id INTO v_id;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    INSERT INTO budget_lines (
      budget_id, organization_id, account_id, store_id, project_id, department_id, amount, notes
    ) VALUES (
      v_id, p_org_id,
      (v_line->>'accountId')::UUID,
      NULLIF(v_line->>'storeId', '')::UUID,
      NULLIF(v_line->>'projectId', '')::UUID,
      NULLIF(v_line->>'departmentId', '')::UUID,
      COALESCE((v_line->>'amount')::NUMERIC, 0),
      NULLIF(v_line->>'notes', '')
    );
  END LOOP;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_budget(UUID, UUID, TEXT, DATE, DATE, TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.budget_vs_actual(p_budget_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget budgets%ROWTYPE;
  v_lines JSONB;
  v_total_budget NUMERIC := 0;
  v_total_actual NUMERIC := 0;
BEGIN
  SELECT * INTO v_budget FROM budgets WHERE id = p_budget_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget not found';
  END IF;
  IF NOT public.user_has_org_access(v_budget.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'account_code')), '[]'::jsonb)
  INTO v_lines
  FROM (
    SELECT jsonb_build_object(
      'account_code', a.code,
      'account_name', a.name,
      'account_type', a.type,
      'store_id', bl.store_id,
      'project_id', bl.project_id,
      'department_id', bl.department_id,
      'budget', bl.amount,
      'actual', COALESCE((
        SELECT SUM(
          CASE
            WHEN a.type IN ('expense', 'asset') THEN jel.debit - jel.credit
            WHEN a.type IN ('income', 'liability', 'equity') THEN jel.credit - jel.debit
            ELSE abs(jel.debit - jel.credit)
          END
        )
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE jel.account_id = bl.account_id
          AND jel.organization_id = v_budget.organization_id
          AND je.entry_date BETWEEN v_budget.period_start AND v_budget.period_end
          AND public._je_is_posted(je.entry_status)
          AND (bl.store_id IS NULL OR jel.store_id = bl.store_id)
          AND (bl.project_id IS NULL OR jel.project_id = bl.project_id)
          AND (bl.department_id IS NULL OR jel.department_id = bl.department_id)
      ), 0),
      'variance', bl.amount - COALESCE((
        SELECT SUM(
          CASE
            WHEN a.type IN ('expense', 'asset') THEN jel.debit - jel.credit
            WHEN a.type IN ('income', 'liability', 'equity') THEN jel.credit - jel.debit
            ELSE abs(jel.debit - jel.credit)
          END
        )
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE jel.account_id = bl.account_id
          AND jel.organization_id = v_budget.organization_id
          AND je.entry_date BETWEEN v_budget.period_start AND v_budget.period_end
          AND public._je_is_posted(je.entry_status)
          AND (bl.store_id IS NULL OR jel.store_id = bl.store_id)
          AND (bl.project_id IS NULL OR jel.project_id = bl.project_id)
          AND (bl.department_id IS NULL OR jel.department_id = bl.department_id)
      ), 0),
      'notes', bl.notes
    ) AS row_data,
    bl.amount AS sort_budget
    FROM budget_lines bl
    JOIN accounts a ON a.id = bl.account_id
    WHERE bl.budget_id = p_budget_id
  ) t;

  SELECT COALESCE(SUM((l->>'budget')::NUMERIC), 0), COALESCE(SUM((l->>'actual')::NUMERIC), 0)
  INTO v_total_budget, v_total_actual
  FROM jsonb_array_elements(v_lines) l;

  RETURN jsonb_build_object(
    'budget_id', v_budget.id,
    'name', v_budget.name,
    'period_start', v_budget.period_start,
    'period_end', v_budget.period_end,
    'status', v_budget.status,
    'total_budget', v_total_budget,
    'total_actual', v_total_actual,
    'total_variance', v_total_budget - v_total_actual,
    'lines', v_lines
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.budget_vs_actual(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Analytic summary by dimension (store | project | department)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytic_ledger_summary(
  p_org_id UUID,
  p_from DATE,
  p_to DATE,
  p_dimension TEXT DEFAULT 'store'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dim TEXT := lower(COALESCE(p_dimension, 'store'));
  v_rows JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_dim NOT IN ('store', 'project', 'department') THEN
    RAISE EXCEPTION 'Dimension must be store, project, or department';
  END IF;

  IF v_dim = 'store' THEN
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'name')), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'revenue', COALESCE(SUM(CASE WHEN a.type = 'income' THEN jel.credit - jel.debit ELSE 0 END), 0),
        'expenses', COALESCE(SUM(CASE WHEN a.type = 'expense' AND a.code <> '5000' THEN jel.debit - jel.credit ELSE 0 END), 0),
        'cogs', COALESCE(SUM(CASE WHEN a.code = '5000' THEN jel.debit - jel.credit ELSE 0 END), 0),
        'net', COALESCE(SUM(CASE WHEN a.type = 'income' THEN jel.credit - jel.debit WHEN a.type = 'expense' THEN jel.debit - jel.credit ELSE 0 END), 0)
      ) AS row_data
      FROM stores s
      LEFT JOIN journal_entry_lines jel ON jel.store_id = s.id AND jel.organization_id = p_org_id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id
        AND je.entry_date BETWEEN p_from AND p_to
        AND public._je_is_posted(je.entry_status)
      LEFT JOIN accounts a ON a.id = jel.account_id
      WHERE s.organization_id = p_org_id
      GROUP BY s.id, s.name
      HAVING COUNT(jel.id) > 0
    ) t;
  ELSIF v_dim = 'project' THEN
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'name')), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'revenue', COALESCE(SUM(CASE WHEN a.type = 'income' THEN jel.credit - jel.debit ELSE 0 END), 0),
        'expenses', COALESCE(SUM(CASE WHEN a.type = 'expense' AND a.code <> '5000' THEN jel.debit - jel.credit ELSE 0 END), 0),
        'cogs', COALESCE(SUM(CASE WHEN a.code = '5000' THEN jel.debit - jel.credit ELSE 0 END), 0),
        'net', COALESCE(SUM(CASE WHEN a.type = 'income' THEN jel.credit - jel.debit WHEN a.type = 'expense' THEN jel.debit - jel.credit ELSE 0 END), 0)
      ) AS row_data
      FROM projects p
      LEFT JOIN journal_entry_lines jel ON jel.project_id = p.id AND jel.organization_id = p_org_id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id
        AND je.entry_date BETWEEN p_from AND p_to
        AND public._je_is_posted(je.entry_status)
      LEFT JOIN accounts a ON a.id = jel.account_id
      WHERE p.organization_id = p_org_id
      GROUP BY p.id, p.name
      HAVING COUNT(jel.id) > 0
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'name')), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'revenue', COALESCE(SUM(CASE WHEN a.type = 'income' THEN jel.credit - jel.debit ELSE 0 END), 0),
        'expenses', COALESCE(SUM(CASE WHEN a.type = 'expense' AND a.code <> '5000' THEN jel.debit - jel.credit ELSE 0 END), 0),
        'cogs', COALESCE(SUM(CASE WHEN a.code = '5000' THEN jel.debit - jel.credit ELSE 0 END), 0),
        'net', COALESCE(SUM(CASE WHEN a.type = 'income' THEN jel.credit - jel.debit WHEN a.type = 'expense' THEN jel.debit - jel.credit ELSE 0 END), 0)
      ) AS row_data
      FROM analytic_departments d
      LEFT JOIN journal_entry_lines jel ON jel.department_id = d.id AND jel.organization_id = p_org_id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id
        AND je.entry_date BETWEEN p_from AND p_to
        AND public._je_is_posted(je.entry_status)
      LEFT JOIN accounts a ON a.id = jel.account_id
      WHERE d.organization_id = p_org_id
      GROUP BY d.id, d.name
      HAVING COUNT(jel.id) > 0
    ) t;
  END IF;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'dimension', v_dim,
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.analytic_ledger_summary(UUID, DATE, DATE, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Comparative P&L and balance sheet
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comparative_profit_and_loss(
  p_org_id UUID,
  p_from DATE,
  p_to DATE,
  p_prior_from DATE,
  p_prior_to DATE,
  p_mode TEXT DEFAULT 'operational'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current JSONB;
  v_prior JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_current := public.profit_and_loss(p_org_id, p_from, p_to, p_mode);
  v_prior := public.profit_and_loss(p_org_id, p_prior_from, p_prior_to, p_mode);

  RETURN jsonb_build_object(
    'current', v_current,
    'prior', v_prior,
    'prior_from', p_prior_from,
    'prior_to', p_prior_to,
    'variance', jsonb_build_object(
      'revenue', COALESCE((v_current->>'revenue')::NUMERIC, 0) - COALESCE((v_prior->>'revenue')::NUMERIC, 0),
      'cogs', COALESCE((v_current->>'cogs')::NUMERIC, 0) - COALESCE((v_prior->>'cogs')::NUMERIC, 0),
      'gross_profit', COALESCE((v_current->>'gross_profit')::NUMERIC, 0) - COALESCE((v_prior->>'gross_profit')::NUMERIC, 0),
      'operating_expenses', COALESCE((v_current->>'operating_expenses')::NUMERIC, 0) - COALESCE((v_prior->>'operating_expenses')::NUMERIC, 0),
      'net_profit', COALESCE((v_current->>'net_profit')::NUMERIC, 0) - COALESCE((v_prior->>'net_profit')::NUMERIC, 0)
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.comparative_profit_and_loss(UUID, DATE, DATE, DATE, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.comparative_balance_sheet(
  p_org_id UUID,
  p_as_of DATE,
  p_prior_as_of DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current JSONB;
  v_prior JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_current := public.balance_sheet(p_org_id, p_as_of);
  v_prior := public.balance_sheet(p_org_id, p_prior_as_of);

  RETURN jsonb_build_object(
    'current', v_current,
    'prior', v_prior,
    'prior_as_of', p_prior_as_of,
    'variance', jsonb_build_object(
      'total_assets', COALESCE((v_current->>'total_assets')::NUMERIC, 0) - COALESCE((v_prior->>'total_assets')::NUMERIC, 0),
      'total_liabilities', COALESCE((v_current->>'total_liabilities')::NUMERIC, 0) - COALESCE((v_prior->>'total_liabilities')::NUMERIC, 0),
      'total_equity', COALESCE((v_current->>'total_equity')::NUMERIC, 0) - COALESCE((v_prior->>'total_equity')::NUMERIC, 0)
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.comparative_balance_sheet(UUID, DATE, DATE) TO authenticated;

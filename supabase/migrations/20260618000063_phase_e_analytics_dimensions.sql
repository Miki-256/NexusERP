-- Phase E — Analytics & dimensions: analytic tags on JEL, budgets, comparative reports.

-- ---------------------------------------------------------------------------
-- Analytic dimensions
-- ---------------------------------------------------------------------------
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
CREATE POLICY analytic_departments_select ON analytic_departments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY analytic_departments_write ON analytic_departments FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Budgets
-- ---------------------------------------------------------------------------
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
CREATE POLICY budgets_select ON budgets FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY budgets_write ON budgets FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY budget_lines_select ON budget_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY budget_lines_write ON budget_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Balanced JE writer — persist analytic dimensions on lines
-- Keep a single signature (drop any 8-arg leftover from Phase A).
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
    INSERT INTO journal_entry_lines (
      entry_id, organization_id, account_id, debit, credit, description,
      store_id, project_id, department_id
    )
    VALUES (
      v_entry_id, p_org_id,
      (v_line->>'accountId')::UUID,
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description',
      NULLIF(v_line->>'storeId', '')::UUID,
      NULLIF(v_line->>'projectId', '')::UUID,
      NULLIF(v_line->>'departmentId', '')::UUID
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Departments CRUD
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Ledger page — include dimensions on lines
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
            'account_type', a.type,
            'store_id', jel.store_id,
            'project_id', jel.project_id,
            'department_id', jel.department_id
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

-- ---------------------------------------------------------------------------
-- Wire store dimension on sale posting and expenses
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_expense(
  p_org_id UUID,
  p_store_id UUID,
  p_category_id UUID,
  p_vendor_name TEXT,
  p_description TEXT,
  p_amount NUMERIC,
  p_payment_method payment_method,
  p_expense_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id UUID;
  v_entry_id UUID;
  v_expense_acct UUID;
  v_pay_acct UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  PERFORM public.ensure_default_accounts(p_org_id);

  SELECT COALESCE(ec.account_id, public.account_id_by_code(p_org_id, '6000'))
    INTO v_expense_acct
  FROM (SELECT 1) x
  LEFT JOIN expense_categories ec ON ec.id = p_category_id;
  IF v_expense_acct IS NULL THEN
    v_expense_acct := public.account_id_by_code(p_org_id, '6000');
  END IF;

  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(p_org_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(p_org_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(p_org_id, '1020')
    ELSE public.account_id_by_code(p_org_id, '1000')
  END;

  INSERT INTO expenses (organization_id, store_id, category_id, vendor_name, description, amount, payment_method, expense_date, created_by)
  VALUES (p_org_id, p_store_id, p_category_id, p_vendor_name, p_description, p_amount, p_payment_method, COALESCE(p_expense_date, current_date), auth.uid())
  RETURNING id INTO v_expense_id;

  v_entry_id := public.post_journal_entry(
    p_org_id, 'GEN', COALESCE(p_expense_date, current_date),
    COALESCE('Expense: ' || p_description, 'Expense'),
    'expense', v_expense_id,
    jsonb_build_array(
      jsonb_build_object('accountId', v_expense_acct, 'debit', p_amount, 'credit', 0, 'description', p_description, 'storeId', p_store_id),
      jsonb_build_object('accountId', v_pay_acct, 'debit', 0, 'credit', p_amount, 'description', 'Paid ' || p_payment_method::text)
    )
  );

  UPDATE expenses SET journal_entry_id = v_entry_id WHERE id = v_expense_id;
  RETURN v_expense_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_sale_to_ledger_internal(p_sale_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_cogs NUMERIC := 0;
  v_net_revenue NUMERIC;
  v_entry_id UUID;
  v_pay RECORD;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND OR v_sale.status <> 'completed' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM payments WHERE sale_id = p_sale_id AND status = 'pending') THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = v_sale.organization_id AND source_type = 'sale' AND source_id = p_sale_id
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.ensure_default_accounts(v_sale.organization_id);

  v_net_revenue := v_sale.subtotal - v_sale.discount_amount + COALESCE(v_sale.tip_amount, 0);

  SELECT COALESCE(SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
    INTO v_cogs
  FROM sale_lines sl
  LEFT JOIN product_variants pv ON pv.id = sl.variant_id
  LEFT JOIN products p ON p.id = pv.product_id
  WHERE sl.sale_id = p_sale_id;

  FOR v_pay IN
    SELECT method, SUM(amount) AS amt FROM payments
    WHERE sale_id = p_sale_id AND status = 'completed'
    GROUP BY method
  LOOP
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, public._payment_method_account_code(v_pay.method)),
      'debit', v_pay.amt, 'credit', 0, 'description', 'Receipt ' || v_sale.receipt_no,
      'storeId', v_sale.store_id));
  END LOOP;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'accountId', public.account_id_by_code(v_sale.organization_id, '4000'),
    'debit', 0, 'credit', v_net_revenue, 'description', 'Sales revenue',
    'storeId', v_sale.store_id));

  IF v_sale.tax_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '2100'),
      'debit', 0, 'credit', v_sale.tax_amount, 'description', 'Tax collected',
      'storeId', v_sale.store_id));
  END IF;

  IF v_cogs > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '5000'),
        'debit', v_cogs, 'credit', 0, 'description', 'COGS', 'storeId', v_sale.store_id),
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '1200'),
        'debit', 0, 'credit', v_cogs, 'description', 'Inventory relief', 'storeId', v_sale.store_id));
  END IF;

  v_entry_id := public._post_journal_entry_balanced(
    v_sale.organization_id, 'SAL', v_sale.created_at::date,
    'Sale ' || v_sale.receipt_no, 'sale', p_sale_id, v_lines, auth.uid()
  );
  RETURN v_entry_id;
END;
$$;

-- Bootstrap default department per org
DO $$
DECLARE
  v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    INSERT INTO analytic_departments (organization_id, code, name)
    VALUES (v_org.id, 'ADMIN', 'Administration')
    ON CONFLICT (organization_id, code) DO NOTHING;
  END LOOP;
END $$;

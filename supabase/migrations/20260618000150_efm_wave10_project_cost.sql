-- EFM Wave 10 — Cost & project accounting schema

-- ---------------------------------------------------------------------------
-- Cost centers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cost_centers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
  analytic_department_id UUID REFERENCES analytic_departments(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_cost_centers_org ON cost_centers(organization_id);

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_centers_select ON cost_centers;
CREATE POLICY cost_centers_select ON cost_centers FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS cost_centers_write ON cost_centers;
CREATE POLICY cost_centers_write ON cost_centers FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Project financial metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_code TEXT,
  ADD COLUMN IF NOT EXISTS budget_cost NUMERIC(14,2) CHECK (budget_cost IS NULL OR budget_cost >= 0),
  ADD COLUMN IF NOT EXISTS budget_revenue NUMERIC(14,2) CHECK (budget_revenue IS NULL OR budget_revenue >= 0),
  ADD COLUMN IF NOT EXISTS contract_value NUMERIC(14,2) CHECK (contract_value IS NULL OR contract_value >= 0),
  ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_status TEXT NOT NULL DEFAULT 'active'
    CHECK (accounting_status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_org_code
  ON projects(organization_id, project_code)
  WHERE project_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Project cost budget lines (by category / account)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_cost_budget_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cost_category TEXT NOT NULL DEFAULT 'other'
    CHECK (cost_category IN ('labor', 'materials', 'subcontract', 'overhead', 'other')),
  account_id UUID REFERENCES accounts(id),
  budget_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (budget_amount >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_cost_budget_project
  ON project_cost_budget_lines(project_id);

ALTER TABLE project_cost_budget_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_cost_budget_lines_select ON project_cost_budget_lines;
CREATE POLICY project_cost_budget_lines_select ON project_cost_budget_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS project_cost_budget_lines_write ON project_cost_budget_lines;
CREATE POLICY project_cost_budget_lines_write ON project_cost_budget_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Cost allocation log (JE-backed project cost transfers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_cost_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  allocation_date DATE NOT NULL DEFAULT current_date,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  cost_category TEXT NOT NULL DEFAULT 'other'
    CHECK (cost_category IN ('labor', 'materials', 'subcontract', 'overhead', 'other')),
  memo TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_cost_allocations_project
  ON project_cost_allocations(project_id, allocation_date DESC);

ALTER TABLE project_cost_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_cost_allocations_select ON project_cost_allocations;
CREATE POLICY project_cost_allocations_select ON project_cost_allocations FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS project_cost_allocations_write ON project_cost_allocations;
CREATE POLICY project_cost_allocations_write ON project_cost_allocations FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

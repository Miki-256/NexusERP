-- EFM Wave 4 — Close management orchestration schema

-- ---------------------------------------------------------------------------
-- Checklist templates (per-org catalog)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.close_checklist_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_code TEXT NOT NULL,
  label TEXT NOT NULL,
  module TEXT NOT NULL,
  description TEXT,
  is_blocking BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, task_code)
);
CREATE INDEX IF NOT EXISTS idx_close_checklist_templates_org
  ON close_checklist_templates(organization_id, sort_order);

ALTER TABLE close_checklist_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS close_checklist_templates_select ON close_checklist_templates;
CREATE POLICY close_checklist_templates_select ON close_checklist_templates FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS close_checklist_templates_write ON close_checklist_templates;
CREATE POLICY close_checklist_templates_write ON close_checklist_templates FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Period close run + tasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.period_close_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES fiscal_periods(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'ready', 'closed', 'cancelled')),
  progress_pct INT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  started_by UUID REFERENCES auth.users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  subledgers_locked_at TIMESTAMPTZ,
  subledgers_locked_by UUID REFERENCES auth.users(id),
  UNIQUE (period_id)
);
CREATE INDEX IF NOT EXISTS idx_period_close_runs_org
  ON period_close_runs(organization_id, started_at DESC);

ALTER TABLE period_close_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS period_close_runs_select ON period_close_runs;
CREATE POLICY period_close_runs_select ON period_close_runs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS period_close_runs_write ON period_close_runs;
CREATE POLICY period_close_runs_write ON period_close_runs FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE TABLE IF NOT EXISTS public.period_close_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES period_close_runs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_code TEXT NOT NULL,
  label TEXT NOT NULL,
  module TEXT NOT NULL,
  is_blocking BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'passing', 'blocked', 'waived', 'complete')),
  metric_value NUMERIC,
  metric_label TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  waived_by UUID REFERENCES auth.users(id),
  waived_at TIMESTAMPTZ,
  waive_note TEXT,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, task_code)
);
CREATE INDEX IF NOT EXISTS idx_period_close_tasks_run
  ON period_close_tasks(run_id, task_code);

ALTER TABLE period_close_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS period_close_tasks_select ON period_close_tasks;
CREATE POLICY period_close_tasks_select ON period_close_tasks FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS period_close_tasks_write ON period_close_tasks;
CREATE POLICY period_close_tasks_write ON period_close_tasks FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Fiscal period close flags
-- ---------------------------------------------------------------------------
ALTER TABLE public.fiscal_periods
  ADD COLUMN IF NOT EXISTS close_run_id UUID REFERENCES period_close_runs(id),
  ADD COLUMN IF NOT EXISTS subledgers_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subledgers_locked_at TIMESTAMPTZ;

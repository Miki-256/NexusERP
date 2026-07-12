-- EFM Wave 14 — Financial security (SoD, dual approval) schema

-- ---------------------------------------------------------------------------
-- Org-level financial security controls
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS je_dual_approval_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS je_dual_approval_threshold NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS ap_dual_approval_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ap_dual_approval_threshold NUMERIC(14,2) DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS sod_enforcement_enabled BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- Segregation of duties conflict rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sod_conflict_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  action_create TEXT NOT NULL,
  action_approve TEXT NOT NULL,
  block_same_user BOOLEAN NOT NULL DEFAULT true,
  severity TEXT NOT NULL DEFAULT 'block' CHECK (severity IN ('block', 'warn')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, action_create, action_approve)
);

CREATE INDEX IF NOT EXISTS idx_sod_conflict_rules_org
  ON sod_conflict_rules(organization_id, is_active);

ALTER TABLE sod_conflict_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sod_conflict_rules_select ON sod_conflict_rules;
CREATE POLICY sod_conflict_rules_select ON sod_conflict_rules FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS sod_conflict_rules_write ON sod_conflict_rules;
CREATE POLICY sod_conflict_rules_write ON sod_conflict_rules FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Multi-step approval trail (journal entries, payment runs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_approval_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('journal_entry', 'payment_run')),
  entity_id UUID NOT NULL,
  step_order INT NOT NULL CHECK (step_order >= 1),
  approver_id UUID NOT NULL REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  UNIQUE (entity_type, entity_id, step_order),
  UNIQUE (entity_type, entity_id, approver_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_approval_steps_entity
  ON financial_approval_steps(entity_type, entity_id);

ALTER TABLE financial_approval_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_approval_steps_select ON financial_approval_steps;
CREATE POLICY financial_approval_steps_select ON financial_approval_steps FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS financial_approval_steps_write ON financial_approval_steps;
CREATE POLICY financial_approval_steps_write ON financial_approval_steps FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

ALTER TABLE public.ap_payment_runs
  ADD COLUMN IF NOT EXISTS approval_count INT NOT NULL DEFAULT 0;

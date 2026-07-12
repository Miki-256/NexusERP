-- EFM Wave 13 — Financial automation, alerts & scheduled reports schema

-- ---------------------------------------------------------------------------
-- Financial automation rules (KPI thresholds, close reminders, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_automation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL
    CHECK (rule_type IN ('kpi_threshold', 'period_close_reminder', 'ar_overdue', 'cash_minimum')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  cooldown_hours INT NOT NULL DEFAULT 24 CHECK (cooldown_hours >= 1 AND cooldown_hours <= 168),
  last_evaluated_at TIMESTAMPTZ,
  last_triggered_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_financial_automation_rules_org
  ON financial_automation_rules(organization_id, is_active);

ALTER TABLE financial_automation_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_automation_rules_select ON financial_automation_rules;
CREATE POLICY financial_automation_rules_select ON financial_automation_rules FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS financial_automation_rules_write ON financial_automation_rules;
CREATE POLICY financial_automation_rules_write ON financial_automation_rules FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

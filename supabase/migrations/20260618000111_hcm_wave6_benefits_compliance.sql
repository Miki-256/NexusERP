-- HCM Wave 6: benefits & compliance — plans, enrollments, policies, expiry alerts.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'benefit_plan_type') THEN
    CREATE TYPE benefit_plan_type AS ENUM ('health', 'dental', 'life', 'retirement', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'benefit_enrollment_status') THEN
    CREATE TYPE benefit_enrollment_status AS ENUM ('pending', 'active', 'waived', 'terminated');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Benefit plans & enrollments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS benefit_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  plan_type benefit_plan_type NOT NULL DEFAULT 'other',
  description TEXT,
  employer_contribution_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  employee_cost_monthly NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_benefit_plans_org ON benefit_plans(organization_id, is_active);

CREATE TABLE IF NOT EXISTS benefit_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES benefit_plans(id) ON DELETE CASCADE,
  status benefit_enrollment_status NOT NULL DEFAULT 'pending',
  coverage_level TEXT,
  effective_date DATE NOT NULL DEFAULT current_date,
  end_date DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_benefit_enrollments_emp ON benefit_enrollments(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_benefit_enrollments_plan ON benefit_enrollments(plan_id);

DROP TRIGGER IF EXISTS benefit_enrollments_updated_at ON benefit_enrollments;
CREATE TRIGGER benefit_enrollments_updated_at
  BEFORE UPDATE ON benefit_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- HR policies & acknowledgements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  summary TEXT,
  content_url TEXT,
  requires_acknowledgement BOOLEAN NOT NULL DEFAULT true,
  effective_date DATE NOT NULL DEFAULT current_date,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code, version)
);

CREATE INDEX IF NOT EXISTS idx_hr_policies_org ON hr_policies(organization_id, is_active);

DROP TRIGGER IF EXISTS hr_policies_updated_at ON hr_policies;
CREATE TRIGGER hr_policies_updated_at
  BEFORE UPDATE ON hr_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES hr_policies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  policy_version INT NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (policy_id, employee_id, policy_version)
);

CREATE INDEX IF NOT EXISTS idx_policy_ack_emp ON policy_acknowledgements(employee_id);

-- Track compliance alert dispatches (idempotent notifications)
CREATE TABLE IF NOT EXISTS compliance_alert_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  alert_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_compliance_alert_log_org ON compliance_alert_log(organization_id, sent_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE benefit_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefit_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_alert_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS benefit_plans_select ON benefit_plans;
CREATE POLICY benefit_plans_select ON benefit_plans FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS benefit_plans_write ON benefit_plans;
CREATE POLICY benefit_plans_write ON benefit_plans FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS benefit_enrollments_select ON benefit_enrollments;
CREATE POLICY benefit_enrollments_select ON benefit_enrollments FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_view_employee(employee_id)
  );

DROP POLICY IF EXISTS benefit_enrollments_write ON benefit_enrollments;
CREATE POLICY benefit_enrollments_write ON benefit_enrollments FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS hr_policies_select ON hr_policies;
CREATE POLICY hr_policies_select ON hr_policies FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS hr_policies_write ON hr_policies;
CREATE POLICY hr_policies_write ON hr_policies FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS policy_acknowledgements_select ON policy_acknowledgements;
CREATE POLICY policy_acknowledgements_select ON policy_acknowledgements FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_view_employee(employee_id)
  );

DROP POLICY IF EXISTS policy_acknowledgements_write ON policy_acknowledgements;
CREATE POLICY policy_acknowledgements_write ON policy_acknowledgements FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS compliance_alert_log_select ON compliance_alert_log;
CREATE POLICY compliance_alert_log_select ON compliance_alert_log FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  );

DROP POLICY IF EXISTS compliance_alert_log_write ON compliance_alert_log;
CREATE POLICY compliance_alert_log_write ON compliance_alert_log FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

-- HCM Wave 2: talent acquisition & onboarding foundation.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_requisition_status') THEN
    CREATE TYPE job_requisition_status AS ENUM (
      'draft', 'pending_approval', 'approved', 'rejected', 'posted', 'cancelled'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'interview_status') THEN
    CREATE TYPE interview_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_offer_status') THEN
    CREATE TYPE job_offer_status AS ENUM ('draft', 'sent', 'accepted', 'declined', 'withdrawn');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'onboarding_task_status') THEN
    CREATE TYPE onboarding_task_status AS ENUM ('pending', 'in_progress', 'completed', 'skipped');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Job requisitions (approval before posting)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_requisitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  department TEXT,
  org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  headcount INT NOT NULL DEFAULT 1 CHECK (headcount > 0),
  employment_type employment_type NOT NULL DEFAULT 'full_time',
  justification TEXT,
  status job_requisition_status NOT NULL DEFAULT 'draft',
  requested_by UUID REFERENCES auth.users(id),
  job_position_id UUID REFERENCES job_positions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_requisitions_org_status
  ON job_requisitions(organization_id, status);

DROP TRIGGER IF EXISTS job_requisitions_updated_at ON job_requisitions;
CREATE TRIGGER job_requisitions_updated_at
  BEFORE UPDATE ON job_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Extend job postings
ALTER TABLE job_positions
  ADD COLUMN IF NOT EXISTS requisition_id UUID REFERENCES job_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employment_type employment_type DEFAULT 'full_time',
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- Extend applicants
ALTER TABLE job_applicants
  ADD COLUMN IF NOT EXISTS hired_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resume_url TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS idx_applicants_hired_employee
  ON job_applicants(hired_employee_id) WHERE hired_employee_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Interviews & scorecards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applicant_interviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  applicant_id UUID NOT NULL REFERENCES job_applicants(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  interviewer_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  location_or_link TEXT,
  status interview_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  scorecard JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applicant_interviews_applicant
  ON applicant_interviews(applicant_id, scheduled_at DESC);

-- ---------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  applicant_id UUID NOT NULL REFERENCES job_applicants(id) ON DELETE CASCADE,
  salary NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (salary >= 0),
  start_date DATE NOT NULL,
  employment_type employment_type NOT NULL DEFAULT 'full_time',
  status job_offer_status NOT NULL DEFAULT 'draft',
  offer_letter_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_offers_applicant ON job_offers(applicant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Onboarding
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_id UUID REFERENCES onboarding_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'welcome',
  status onboarding_task_status NOT NULL DEFAULT 'pending',
  assigned_to UUID REFERENCES auth.users(id),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_employee
  ON onboarding_tasks(employee_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_org_status
  ON onboarding_tasks(organization_id, status);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE job_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE applicant_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_requisitions_select ON job_requisitions;
CREATE POLICY job_requisitions_select ON job_requisitions FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS job_requisitions_write ON job_requisitions;
CREATE POLICY job_requisitions_write ON job_requisitions FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS applicant_interviews_select ON applicant_interviews;
CREATE POLICY applicant_interviews_select ON applicant_interviews FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS applicant_interviews_write ON applicant_interviews;
CREATE POLICY applicant_interviews_write ON applicant_interviews FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS job_offers_select ON job_offers;
CREATE POLICY job_offers_select ON job_offers FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS job_offers_write ON job_offers;
CREATE POLICY job_offers_write ON job_offers FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS onboarding_templates_select ON onboarding_templates;
CREATE POLICY onboarding_templates_select ON onboarding_templates FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS onboarding_templates_write ON onboarding_templates;
CREATE POLICY onboarding_templates_write ON onboarding_templates FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS onboarding_tasks_select ON onboarding_tasks;
CREATE POLICY onboarding_tasks_select ON onboarding_tasks FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR employee_id = public.my_employee_id(organization_id)
    )
  );

DROP POLICY IF EXISTS onboarding_tasks_write ON onboarding_tasks;
CREATE POLICY onboarding_tasks_write ON onboarding_tasks FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

-- ---------------------------------------------------------------------------
-- Default onboarding template + requisition workflow
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_onboarding_template(p_org_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM onboarding_templates
  WHERE organization_id = p_org_id AND is_default = true LIMIT 1;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO onboarding_templates (organization_id, name, is_default, items)
  VALUES (
    p_org_id, 'Standard onboarding', true,
    '[
      {"title": "Create ERP account invite", "category": "it", "sort_order": 1},
      {"title": "Assign laptop / equipment", "category": "assets", "sort_order": 2},
      {"title": "Complete HR orientation", "category": "training", "sort_order": 3},
      {"title": "Welcome meeting with manager", "category": "welcome", "sort_order": 4}
    ]'::jsonb
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_default_hr_workflows(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.user_can_manage_hr(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO workflow_definitions (organization_id, code, name, entity_type, steps)
  SELECT p_org_id, 'leave_default', 'Leave approval', 'leave_request',
    '[
      {"order": 1, "name": "Manager", "approver": "manager"},
      {"order": 2, "name": "HR", "approver": "hr"}
    ]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM workflow_definitions
    WHERE organization_id = p_org_id AND code = 'leave_default'
  );

  INSERT INTO workflow_definitions (organization_id, code, name, entity_type, steps)
  SELECT p_org_id, 'job_requisition_default', 'Job requisition approval', 'job_requisition',
    '[
      {"order": 1, "name": "HR", "approver": "hr"}
    ]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM workflow_definitions
    WHERE organization_id = p_org_id AND code = 'job_requisition_default'
  );
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_hr_workflows(v_org);
    PERFORM public.ensure_default_onboarding_template(v_org);
  END LOOP;
END;
$$;

-- HCM Wave 8: employee lifecycle automation — offboarding, probation, contracts.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'probation_review_status') THEN
    CREATE TYPE probation_review_status AS ENUM ('pending', 'passed', 'extended', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_contract_status') THEN
    CREATE TYPE employment_contract_status AS ENUM ('active', 'expiring_soon', 'renewed', 'expired', 'terminated');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Offboarding
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS offboarding_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS offboarding_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_id UUID REFERENCES offboarding_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'exit',
  status onboarding_task_status NOT NULL DEFAULT 'pending',
  assigned_to UUID REFERENCES auth.users(id),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offboarding_tasks_employee ON offboarding_tasks(employee_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_offboarding_tasks_org_status ON offboarding_tasks(organization_id, status);

-- ---------------------------------------------------------------------------
-- Probation reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS probation_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  probation_end_date DATE NOT NULL,
  status probation_review_status NOT NULL DEFAULT 'pending',
  outcome_notes TEXT,
  extended_until DATE,
  reviewer_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_probation_reviews_emp ON probation_reviews(employee_id);
CREATE INDEX IF NOT EXISTS idx_probation_reviews_due ON probation_reviews(organization_id, probation_end_date, status);

DROP TRIGGER IF EXISTS probation_reviews_updated_at ON probation_reviews;
CREATE TRIGGER probation_reviews_updated_at
  BEFORE UPDATE ON probation_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Employment contracts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employment_contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contract_title TEXT NOT NULL DEFAULT 'Employment contract',
  start_date DATE NOT NULL DEFAULT current_date,
  end_date DATE,
  status employment_contract_status NOT NULL DEFAULT 'active',
  renewed_from_id UUID REFERENCES employment_contracts(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employment_contracts_emp ON employment_contracts(employee_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_employment_contracts_end ON employment_contracts(organization_id, end_date, status)
  WHERE end_date IS NOT NULL;

DROP TRIGGER IF EXISTS employment_contracts_updated_at ON employment_contracts;
CREATE TRIGGER employment_contracts_updated_at
  BEFORE UPDATE ON employment_contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE offboarding_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE offboarding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE probation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE employment_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offboarding_templates_select ON offboarding_templates;
CREATE POLICY offboarding_templates_select ON offboarding_templates FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS offboarding_templates_write ON offboarding_templates;
CREATE POLICY offboarding_templates_write ON offboarding_templates FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS offboarding_tasks_select ON offboarding_tasks;
CREATE POLICY offboarding_tasks_select ON offboarding_tasks FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR employee_id = public.my_employee_id(organization_id)
    )
  );

DROP POLICY IF EXISTS offboarding_tasks_write ON offboarding_tasks;
CREATE POLICY offboarding_tasks_write ON offboarding_tasks FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS probation_reviews_select ON probation_reviews;
CREATE POLICY probation_reviews_select ON probation_reviews FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_view_employee(employee_id)
  );

DROP POLICY IF EXISTS probation_reviews_write ON probation_reviews;
CREATE POLICY probation_reviews_write ON probation_reviews FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS employment_contracts_select ON employment_contracts;
CREATE POLICY employment_contracts_select ON employment_contracts FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_view_employee(employee_id)
  );

DROP POLICY IF EXISTS employment_contracts_write ON employment_contracts;
CREATE POLICY employment_contracts_write ON employment_contracts FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

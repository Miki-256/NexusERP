-- HCM Wave 1: org hierarchy, employee 360°, documents, workflow engine v1.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_unit_type') THEN
    CREATE TYPE org_unit_type AS ENUM (
      'company', 'business_unit', 'division', 'region', 'branch', 'department', 'team'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_instance_status') THEN
    CREATE TYPE workflow_instance_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_approval_status') THEN
    CREATE TYPE workflow_approval_status AS ENUM ('pending', 'approved', 'rejected', 'skipped');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Organization hierarchy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  unit_type org_unit_type NOT NULL DEFAULT 'department',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  analytic_department_id UUID REFERENCES analytic_departments(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_org_units_org ON org_units(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_org_units_parent ON org_units(parent_id);

DROP TRIGGER IF EXISTS org_units_updated_at ON org_units;
CREATE TRIGGER org_units_updated_at
  BEFORE UPDATE ON org_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- HR positions (job slots — distinct from recruitment job_positions)
CREATE TABLE IF NOT EXISTS hr_positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  reports_to_position_id UUID REFERENCES hr_positions(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_hr_positions_org ON hr_positions(organization_id);

-- Extend employees with org assignment
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_number TEXT,
  ADD COLUMN IF NOT EXISTS org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_position_id UUID REFERENCES hr_positions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_org_unit ON employees(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_employee_id);

-- ---------------------------------------------------------------------------
-- Employee 360° profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_profiles (
  employee_id UUID PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date_of_birth DATE,
  gender TEXT,
  marital_status TEXT,
  nationality TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state_region TEXT,
  postal_code TEXT,
  country TEXT,
  national_id TEXT,
  passport_number TEXT,
  passport_expiry DATE,
  visa_number TEXT,
  visa_expiry DATE,
  driving_license TEXT,
  driving_license_expiry DATE,
  work_email TEXT,
  work_phone TEXT,
  termination_date DATE,
  probation_end_date DATE,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relation TEXT,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_branch TEXT,
  medical_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_profiles_org ON employee_profiles(organization_id);

DROP TRIGGER IF EXISTS employee_profiles_updated_at ON employee_profiles;
CREATE TRIGGER employee_profiles_updated_at
  BEFORE UPDATE ON employee_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS employee_dependents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship TEXT,
  date_of_birth DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_dependents_emp ON employee_dependents(employee_id);

CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL DEFAULT 'general',
  name TEXT NOT NULL,
  url TEXT,
  mime_type TEXT,
  expires_at DATE,
  version INT NOT NULL DEFAULT 1,
  previous_version_id UUID REFERENCES employee_documents(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_emp ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry ON employee_documents(organization_id, expires_at)
  WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Workflow engine v1
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  definition_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  current_step INT NOT NULL DEFAULT 1,
  status workflow_instance_status NOT NULL DEFAULT 'pending',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_entity
  ON workflow_instances(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_org_status
  ON workflow_instances(organization_id, status);

CREATE TABLE IF NOT EXISTS workflow_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  approver_role TEXT,
  approver_user_id UUID REFERENCES auth.users(id),
  status workflow_approval_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  decided_at TIMESTAMPTZ,
  UNIQUE (instance_id, step_order)
);

-- ---------------------------------------------------------------------------
-- Access helpers (must exist before RLS policies that reference them)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_view_employee(p_employee_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_my_emp UUID;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF public.user_can_manage_hr(v_emp.organization_id) THEN
    RETURN true;
  END IF;

  IF v_emp.user_id = auth.uid() THEN
    RETURN true;
  END IF;

  v_my_emp := public.my_employee_id(v_emp.organization_id);
  IF v_my_emp IS NOT NULL AND v_emp.manager_employee_id = v_my_emp THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_view_employee(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_dependents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_units_select ON org_units;
CREATE POLICY org_units_select ON org_units FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS org_units_write ON org_units;
CREATE POLICY org_units_write ON org_units FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS hr_positions_select ON hr_positions;
CREATE POLICY hr_positions_select ON hr_positions FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS hr_positions_write ON hr_positions;
CREATE POLICY hr_positions_write ON hr_positions FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS employee_profiles_select ON employee_profiles;
CREATE POLICY employee_profiles_select ON employee_profiles FOR SELECT
  USING (public.user_can_view_employee(employee_id));

DROP POLICY IF EXISTS employee_profiles_write ON employee_profiles;
CREATE POLICY employee_profiles_write ON employee_profiles FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS employee_dependents_select ON employee_dependents;
CREATE POLICY employee_dependents_select ON employee_dependents FOR SELECT
  USING (public.user_can_view_employee(employee_id));

DROP POLICY IF EXISTS employee_dependents_write ON employee_dependents;
CREATE POLICY employee_dependents_write ON employee_dependents FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS employee_documents_select ON employee_documents;
CREATE POLICY employee_documents_select ON employee_documents FOR SELECT
  USING (public.user_can_view_employee(employee_id));

DROP POLICY IF EXISTS employee_documents_write ON employee_documents;
CREATE POLICY employee_documents_write ON employee_documents FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS workflow_definitions_select ON workflow_definitions;
CREATE POLICY workflow_definitions_select ON workflow_definitions FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS workflow_definitions_write ON workflow_definitions;
CREATE POLICY workflow_definitions_write ON workflow_definitions FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS workflow_instances_select ON workflow_instances;
CREATE POLICY workflow_instances_select ON workflow_instances FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS workflow_approvals_select ON workflow_approvals;
CREATE POLICY workflow_approvals_select ON workflow_approvals FOR SELECT
  USING (
    instance_id IN (
      SELECT wi.id FROM workflow_instances wi
      WHERE wi.organization_id IN (SELECT public.user_organization_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Seed default org + workflows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_hr_org(p_org_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root_id UUID;
  v_org_name TEXT;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT id INTO v_root_id
  FROM org_units
  WHERE organization_id = p_org_id AND unit_type = 'company'
  LIMIT 1;

  IF v_root_id IS NOT NULL THEN
    RETURN v_root_id;
  END IF;

  SELECT name INTO v_org_name FROM organizations WHERE id = p_org_id;

  INSERT INTO org_units (organization_id, parent_id, unit_type, code, name, description)
  VALUES (p_org_id, NULL, 'company', 'company', COALESCE(v_org_name, 'Company'), 'Root organization')
  RETURNING id INTO v_root_id;

  RETURN v_root_id;
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
END;
$$;

-- Sync finance analytic departments → HR department org units
CREATE OR REPLACE FUNCTION public.sync_analytic_departments_to_org(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root_id UUID;
  v_count INT := 0;
  v_ad RECORD;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_root_id := public.ensure_default_hr_org(p_org_id);

  FOR v_ad IN
    SELECT id, code, name FROM analytic_departments
    WHERE organization_id = p_org_id AND is_active = true
  LOOP
    INSERT INTO org_units (
      organization_id, parent_id, unit_type, code, name, analytic_department_id
    )
    VALUES (
      p_org_id, v_root_id, 'department',
      'dept-' || v_ad.code, v_ad.name, v_ad.id
    )
    ON CONFLICT (organization_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        analytic_department_id = EXCLUDED.analytic_department_id,
        parent_id = EXCLUDED.parent_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Backfill workflows for existing orgs
DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_hr_workflows(v_org);
  END LOOP;
END;
$$;


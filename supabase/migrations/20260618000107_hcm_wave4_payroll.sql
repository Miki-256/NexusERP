-- HCM Wave 4: payroll & compensation foundation.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pay_component_type') THEN
    CREATE TYPE pay_component_type AS ENUM ('earning', 'deduction', 'tax', 'employer_contribution');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pay_calc_type') THEN
    CREATE TYPE pay_calc_type AS ENUM ('fixed', 'percent_gross', 'percent_base');
  END IF;
END $$;

-- Extend payroll run lifecycle
ALTER TYPE payroll_status ADD VALUE IF NOT EXISTS 'pending_approval';
ALTER TYPE payroll_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE payroll_status ADD VALUE IF NOT EXISTS 'cancelled';

-- ---------------------------------------------------------------------------
-- Pay components
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_components (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  component_type pay_component_type NOT NULL DEFAULT 'earning',
  calc_type pay_calc_type NOT NULL DEFAULT 'fixed',
  default_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  default_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  is_taxable BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  gl_account_code TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_pay_components_org ON pay_components(organization_id, is_active);

CREATE TABLE IF NOT EXISTS employee_pay_components (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES pay_components(id) ON DELETE CASCADE,
  amount_override NUMERIC(14,2),
  rate_override NUMERIC(8,4),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_pay_components_emp ON employee_pay_components(employee_id);

-- Payslip line breakdown
CREATE TABLE IF NOT EXISTS payslip_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payslip_id UUID NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  component_id UUID REFERENCES pay_components(id) ON DELETE SET NULL,
  component_code TEXT,
  component_name TEXT NOT NULL,
  component_type pay_component_type NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payslip_lines_payslip ON payslip_lines(payslip_id);

-- Extend payroll runs
ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Salary history
CREATE TABLE IF NOT EXISTS salary_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL DEFAULT current_date,
  base_salary NUMERIC(14,2) NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_history_emp ON salary_history(employee_id, effective_date DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE pay_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_pay_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslip_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pay_components_select ON pay_components;
CREATE POLICY pay_components_select ON pay_components FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS pay_components_write ON pay_components;
CREATE POLICY pay_components_write ON pay_components FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS employee_pay_components_select ON employee_pay_components;
CREATE POLICY employee_pay_components_select ON employee_pay_components FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR employee_id = public.my_employee_id(organization_id)
    )
  );

DROP POLICY IF EXISTS employee_pay_components_write ON employee_pay_components;
CREATE POLICY employee_pay_components_write ON employee_pay_components FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS payslip_lines_select ON payslip_lines;
CREATE POLICY payslip_lines_select ON payslip_lines FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR payslip_id IN (
        SELECT ps.id FROM payslips ps
        WHERE ps.employee_id = public.my_employee_id(organization_id)
      )
    )
  );

DROP POLICY IF EXISTS payslip_lines_write ON payslip_lines;
CREATE POLICY payslip_lines_write ON payslip_lines FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS salary_history_select ON salary_history;
CREATE POLICY salary_history_select ON salary_history FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR employee_id = public.my_employee_id(organization_id)
    )
  );

DROP POLICY IF EXISTS salary_history_write ON salary_history;
CREATE POLICY salary_history_write ON salary_history FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

-- Payslips: allow employee self-service read
DROP POLICY IF EXISTS payslips_select ON payslips;
CREATE POLICY payslips_select ON payslips FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR employee_id = public.my_employee_id(organization_id)
    )
  );

-- Payroll runs: managers see all; employees see runs that include their payslip
DROP POLICY IF EXISTS payroll_select ON payroll_runs;
CREATE POLICY payroll_select ON payroll_runs FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR EXISTS (
        SELECT 1 FROM payslips ps
        WHERE ps.run_id = payroll_runs.id
          AND ps.employee_id = public.my_employee_id(organization_id)
      )
    )
  );

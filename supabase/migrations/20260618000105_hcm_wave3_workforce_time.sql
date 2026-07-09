-- HCM Wave 3: workforce time — leave policies, holidays, attendance, shifts.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_method') THEN
    CREATE TYPE attendance_method AS ENUM ('web', 'qr', 'gps', 'manual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_record_status') THEN
    CREATE TYPE attendance_record_status AS ENUM ('open', 'closed', 'adjusted');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Leave types & balances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_paid BOOLEAN NOT NULL DEFAULT true,
  annual_entitlement_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (annual_entitlement_days >= 0),
  accrual_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  max_carry_forward_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (max_carry_forward_days >= 0),
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_leave_types_org ON leave_types(organization_id, is_active);

CREATE TABLE IF NOT EXISTS leave_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  balance_year INT NOT NULL,
  entitled_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  used_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  carried_forward_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, leave_type_id, balance_year)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_emp ON leave_balances(employee_id, balance_year);

DROP TRIGGER IF EXISTS leave_balances_updated_at ON leave_balances;
CREATE TRIGGER leave_balances_updated_at
  BEFORE UPDATE ON leave_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS leave_type_id UUID REFERENCES leave_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS days_requested NUMERIC(6,2);

-- ---------------------------------------------------------------------------
-- Holiday calendars
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holiday_calendars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  country_code TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS holiday_dates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  calendar_id UUID NOT NULL REFERENCES holiday_calendars(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  holiday_date DATE NOT NULL,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (calendar_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_holiday_dates_cal ON holiday_dates(calendar_id, holiday_date);

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_minutes INT NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  grace_minutes_late INT NOT NULL DEFAULT 0 CHECK (grace_minutes_late >= 0),
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_work_shifts_org ON work_shifts(organization_id, is_active);

CREATE TABLE IF NOT EXISTS shift_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES work_shifts(id) ON DELETE CASCADE,
  assignment_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, assignment_date)
);

CREATE INDEX IF NOT EXISTS idx_shift_assignments_org_date
  ON shift_assignments(organization_id, assignment_date);

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  late_after_minutes INT NOT NULL DEFAULT 15 CHECK (late_after_minutes >= 0),
  early_leave_before_minutes INT NOT NULL DEFAULT 15 CHECK (early_leave_before_minutes >= 0),
  overtime_after_minutes INT NOT NULL DEFAULT 30 CHECK (overtime_after_minutes >= 0),
  geofence_radius_meters INT NOT NULL DEFAULT 0 CHECK (geofence_radius_meters >= 0),
  is_default BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_assignment_id UUID REFERENCES shift_assignments(id) ON DELETE SET NULL,
  clock_in_at TIMESTAMPTZ NOT NULL,
  clock_out_at TIMESTAMPTZ,
  clock_in_method attendance_method NOT NULL DEFAULT 'web',
  clock_out_method attendance_method,
  clock_in_lat NUMERIC(10,7),
  clock_in_lng NUMERIC(10,7),
  clock_out_lat NUMERIC(10,7),
  clock_out_lng NUMERIC(10,7),
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  status attendance_record_status NOT NULL DEFAULT 'open',
  is_late BOOLEAN NOT NULL DEFAULT false,
  is_early_leave BOOLEAN NOT NULL DEFAULT false,
  overtime_minutes INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_emp_date
  ON attendance_records(employee_id, clock_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_org_date
  ON attendance_records(organization_id, clock_in_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_open_per_employee
  ON attendance_records(employee_id) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_types_select ON leave_types;
CREATE POLICY leave_types_select ON leave_types FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS leave_types_write ON leave_types;
CREATE POLICY leave_types_write ON leave_types FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS leave_balances_select ON leave_balances;
CREATE POLICY leave_balances_select ON leave_balances FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR employee_id = public.my_employee_id(organization_id)
    )
  );

DROP POLICY IF EXISTS leave_balances_write ON leave_balances;
CREATE POLICY leave_balances_write ON leave_balances FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS holiday_calendars_select ON holiday_calendars;
CREATE POLICY holiday_calendars_select ON holiday_calendars FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS holiday_calendars_write ON holiday_calendars;
CREATE POLICY holiday_calendars_write ON holiday_calendars FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS holiday_dates_select ON holiday_dates;
CREATE POLICY holiday_dates_select ON holiday_dates FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS holiday_dates_write ON holiday_dates;
CREATE POLICY holiday_dates_write ON holiday_dates FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS work_shifts_select ON work_shifts;
CREATE POLICY work_shifts_select ON work_shifts FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS work_shifts_write ON work_shifts;
CREATE POLICY work_shifts_write ON work_shifts FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS shift_assignments_select ON shift_assignments;
CREATE POLICY shift_assignments_select ON shift_assignments FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_has_hr_app_access(organization_id)
      AND (
        public.user_can_manage_hr(organization_id)
        OR employee_id = public.my_employee_id(organization_id)
      )
    )
  );

DROP POLICY IF EXISTS shift_assignments_write ON shift_assignments;
CREATE POLICY shift_assignments_write ON shift_assignments FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS attendance_rules_select ON attendance_rules;
CREATE POLICY attendance_rules_select ON attendance_rules FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS attendance_rules_write ON attendance_rules;
CREATE POLICY attendance_rules_write ON attendance_rules FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS attendance_records_select ON attendance_records;
CREATE POLICY attendance_records_select ON attendance_records FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR employee_id = public.my_employee_id(organization_id)
    )
  );

DROP POLICY IF EXISTS attendance_records_write ON attendance_records;
CREATE POLICY attendance_records_write ON attendance_records FOR ALL
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR employee_id = public.my_employee_id(organization_id)
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR employee_id = public.my_employee_id(organization_id)
    )
  );

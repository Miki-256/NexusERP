-- HCM Wave 0: security hardening, HR permissions, audit log, paginated RPCs, notifications.

-- ---------------------------------------------------------------------------
-- Helper: HR app access
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_hr_app_access(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID;
  v_apps TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT om.id INTO v_member_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
    AND om.organization_id = p_org_id
    AND om.is_active = true;

  IF v_member_id IS NULL THEN
    RETURN false;
  END IF;

  v_apps := public.resolve_member_app_ids(v_member_id);
  RETURN v_apps && ARRAY['hr', 'recruitment', 'timeoff']::TEXT[];
END;
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage_hr(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID;
  v_manage TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF public.user_can_manage(p_org_id) THEN
    RETURN true;
  END IF;

  SELECT om.id INTO v_member_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
    AND om.organization_id = p_org_id
    AND om.is_active = true;

  IF v_member_id IS NULL THEN
    RETURN false;
  END IF;

  v_manage := public.resolve_member_manage_app_ids(v_member_id);
  RETURN v_manage && ARRAY['hr', 'recruitment', 'timeoff']::TEXT[];
END;
$$;

CREATE OR REPLACE FUNCTION public.my_employee_id(p_org_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM employees e
  WHERE e.organization_id = p_org_id
    AND e.user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.user_has_hr_app_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_manage_hr(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_employee_id(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- HR audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_audit_org_created
  ON hr_audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_audit_entity
  ON hr_audit_logs(entity_type, entity_id);

ALTER TABLE hr_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_audit_select ON hr_audit_logs;
CREATE POLICY hr_audit_select ON hr_audit_logs FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  );

CREATE OR REPLACE FUNCTION public.hr_write_audit_log(
  p_org_id UUID,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_action TEXT,
  p_old_data JSONB DEFAULT NULL,
  p_new_data JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO hr_audit_logs (
    organization_id, actor_user_id, entity_type, entity_id, action, old_data, new_data
  ) VALUES (
    p_org_id, auth.uid(), p_entity_type, p_entity_id, p_action, p_old_data, p_new_data
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_write_audit_log(UUID, TEXT, UUID, TEXT, JSONB, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- Employee identity: unique user link per org
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_org_user_unique
  ON employees(organization_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_user
  ON employees(user_id)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Leave requests: requested_by + indexes
-- ---------------------------------------------------------------------------
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leave_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_org_status ON leave_requests(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payslips_run_employee_unique
  ON payslips(run_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_applicants_org_status ON job_applicants(organization_id, status);

-- ---------------------------------------------------------------------------
-- RLS hardening
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS employees_select ON employees;
DROP POLICY IF EXISTS employees_write ON employees;

CREATE POLICY employees_select ON employees FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR user_id = auth.uid()
    )
  );

CREATE POLICY employees_write ON employees FOR ALL
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  );

DROP POLICY IF EXISTS payroll_select ON payroll_runs;
CREATE POLICY payroll_select ON payroll_runs FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  );

DROP POLICY IF EXISTS payslips_select ON payslips;
CREATE POLICY payslips_select ON payslips FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  );

DROP POLICY IF EXISTS applicants_write ON job_applicants;
CREATE POLICY applicants_write ON job_applicants FOR ALL
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  );

DROP POLICY IF EXISTS jobs_write ON job_positions;
CREATE POLICY jobs_write ON job_positions FOR ALL
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  );

DROP POLICY IF EXISTS leave_insert ON leave_requests;
DROP POLICY IF EXISTS leave_update ON leave_requests;
DROP POLICY IF EXISTS leave_select ON leave_requests;

CREATE POLICY leave_select ON leave_requests FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      public.user_can_manage_hr(organization_id)
      OR requested_by = auth.uid()
      OR employee_id = public.my_employee_id(organization_id)
    )
  );

-- Inserts/updates only via SECURITY DEFINER RPCs (no direct write policies).

-- ---------------------------------------------------------------------------
-- Paginated list RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_hr_employees(
  p_org_id UUID,
  p_search TEXT DEFAULT NULL,
  p_status employee_status DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sensitive BOOLEAN;
  v_q TEXT := NULLIF(trim(COALESCE(p_search, '')), '');
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_total BIGINT;
  v_items JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.user_can_manage_hr(p_org_id) AND public.my_employee_id(p_org_id) IS NULL THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_sensitive := public.user_can_manage_hr(p_org_id);

  SELECT COUNT(*) INTO v_total
  FROM employees e
  WHERE e.organization_id = p_org_id
    AND (p_status IS NULL OR e.status = p_status)
    AND (
      v_q IS NULL
      OR e.name ILIKE '%' || v_q || '%'
      OR COALESCE(e.email, '') ILIKE '%' || v_q || '%'
      OR COALESCE(e.position, '') ILIKE '%' || v_q || '%'
    )
    AND (
      v_sensitive
      OR e.user_id = auth.uid()
    );

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.name), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      e.id,
      e.name,
      e.position,
      e.email,
      e.phone,
      e.employment_type,
      CASE WHEN v_sensitive THEN e.base_salary ELSE NULL END AS base_salary,
      e.payment_method,
      e.hire_date,
      e.status,
      e.store_id,
      e.user_id,
      e.created_at
    FROM employees e
    WHERE e.organization_id = p_org_id
      AND (p_status IS NULL OR e.status = p_status)
      AND (
        v_q IS NULL
        OR e.name ILIKE '%' || v_q || '%'
        OR COALESCE(e.email, '') ILIKE '%' || v_q || '%'
        OR COALESCE(e.position, '') ILIKE '%' || v_q || '%'
      )
      AND (
        v_sensitive
        OR e.user_id = auth.uid()
      )
    ORDER BY e.name
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_timeoff_employees(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name) ORDER BY e.name), '[]'::jsonb)
    FROM employees e
    WHERE e.organization_id = p_org_id
      AND e.status = 'active'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_leave_requests(
  p_org_id UUID,
  p_status leave_status DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_total BIGINT;
  v_items JSONB;
  v_manage BOOLEAN;
  v_my_emp UUID;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_manage := public.user_can_manage_hr(p_org_id);
  v_my_emp := public.my_employee_id(p_org_id);

  SELECT COUNT(*) INTO v_total
  FROM leave_requests lr
  WHERE lr.organization_id = p_org_id
    AND (p_status IS NULL OR lr.status = p_status)
    AND (
      v_manage
      OR lr.requested_by = auth.uid()
      OR lr.employee_id = v_my_emp
    );

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      lr.id,
      lr.start_date,
      lr.end_date,
      lr.reason,
      lr.status,
      lr.created_at,
      lr.requested_by,
      jsonb_build_object('name', e.name) AS employees
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    WHERE lr.organization_id = p_org_id
      AND (p_status IS NULL OR lr.status = p_status)
      AND (
        v_manage
        OR lr.requested_by = auth.uid()
        OR lr.employee_id = v_my_emp
      )
    ORDER BY lr.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_job_positions(
  p_org_id UUID,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q TEXT := NULLIF(trim(COALESCE(p_search, '')), '');
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_total BIGINT;
  v_items JSONB;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM job_positions jp
  WHERE jp.organization_id = p_org_id
    AND (v_q IS NULL OR jp.title ILIKE '%' || v_q || '%' OR COALESCE(jp.department, '') ILIKE '%' || v_q || '%');

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.title), '[]'::jsonb) INTO v_items
  FROM (
    SELECT jp.id, jp.title, jp.department, jp.is_open, jp.created_at
    FROM job_positions jp
    WHERE jp.organization_id = p_org_id
      AND (v_q IS NULL OR jp.title ILIKE '%' || v_q || '%' OR COALESCE(jp.department, '') ILIKE '%' || v_q || '%')
    ORDER BY jp.title
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_job_applicants(
  p_org_id UUID,
  p_status applicant_status DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_total BIGINT;
  v_items JSONB;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM job_applicants ja
  WHERE ja.organization_id = p_org_id
    AND (p_status IS NULL OR ja.status = p_status);

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      ja.id,
      ja.full_name,
      ja.email,
      ja.phone,
      ja.status,
      ja.created_at,
      jsonb_build_object('title', jp.title) AS job_positions
    FROM job_applicants ja
    JOIN job_positions jp ON jp.id = ja.position_id
    WHERE ja.organization_id = p_org_id
      AND (p_status IS NULL OR ja.status = p_status)
    ORDER BY ja.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_hr_employees(UUID, TEXT, employee_status, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_timeoff_employees(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_leave_requests(UUID, leave_status, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_job_positions(UUID, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_job_applicants(UUID, applicant_status, INT, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Link employee to ERP user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_employee_to_user(
  p_employee_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF NOT public.user_can_manage_hr(v_emp.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = v_emp.organization_id
      AND om.user_id = p_user_id
      AND om.is_active = true
  ) THEN
    RAISE EXCEPTION 'User is not an active member of this organization';
  END IF;

  UPDATE employees SET user_id = p_user_id WHERE id = p_employee_id;

  PERFORM public.hr_write_audit_log(
    v_emp.organization_id, 'employee', p_employee_id, 'link_user',
    jsonb_build_object('user_id', v_emp.user_id),
    jsonb_build_object('user_id', p_user_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_employee_to_user(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Leave: submit + review (secured)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_leave_request(
  p_org_id UUID,
  p_employee_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_id UUID;
  v_manage BOOLEAN;
  v_my_emp UUID;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be on or after start date';
  END IF;

  SELECT * INTO v_emp FROM employees
  WHERE id = p_employee_id AND organization_id = p_org_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found or inactive';
  END IF;

  v_manage := public.user_can_manage_hr(p_org_id);
  v_my_emp := public.my_employee_id(p_org_id);

  IF NOT v_manage AND (v_my_emp IS NULL OR v_my_emp <> p_employee_id) THEN
    RAISE EXCEPTION 'You can only submit leave for your own employee profile';
  END IF;

  INSERT INTO leave_requests (
    organization_id, employee_id, start_date, end_date, reason, status, requested_by
  ) VALUES (
    p_org_id, p_employee_id, p_start_date, p_end_date, NULLIF(trim(p_reason), ''), 'pending', auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.hr_write_audit_log(
    p_org_id, 'leave_request', v_id, 'submit', NULL,
    jsonb_build_object('employee_id', p_employee_id, 'start_date', p_start_date, 'end_date', p_end_date)
  );

  PERFORM public.enqueue_notification_event(
    p_org_id,
    'hr.leave_requested',
    'leave_request',
    v_id,
    jsonb_build_object(
      'employee_name', v_emp.name,
      'start_date', p_start_date,
      'end_date', p_end_date,
      'reason', NULLIF(trim(p_reason), '')
    ),
    'leave_request:' || v_id::text
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_leave_request(
  p_request_id UUID,
  p_status leave_status
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req leave_requests%ROWTYPE;
  v_emp_name TEXT;
BEGIN
  SELECT * INTO v_req FROM leave_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF NOT public.user_can_manage_hr(v_req.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request already reviewed';
  END IF;

  SELECT name INTO v_emp_name FROM employees WHERE id = v_req.employee_id;

  UPDATE leave_requests
  SET status = p_status, reviewed_by = auth.uid()
  WHERE id = p_request_id;

  IF p_status = 'approved'
     AND v_req.start_date <= current_date
     AND v_req.end_date >= current_date THEN
    UPDATE employees SET status = 'on_leave'
    WHERE id = v_req.employee_id AND status = 'active';
  END IF;

  PERFORM public.hr_write_audit_log(
    v_req.organization_id, 'leave_request', p_request_id, p_status::text,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('status', p_status)
  );

  PERFORM public.enqueue_notification_event(
    v_req.organization_id,
    'hr.leave_reviewed',
    'leave_request',
    p_request_id,
    jsonb_build_object(
      'employee_name', v_emp_name,
      'status', p_status::text,
      'start_date', v_req.start_date,
      'end_date', v_req.end_date
    ),
    'leave_reviewed:' || p_request_id::text || ':' || p_status::text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_leave_request(UUID, UUID, DATE, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_leave_request(UUID, leave_status) TO authenticated;

-- ---------------------------------------------------------------------------
-- Payroll: HR manage + employee validation + notification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_payroll(
  p_org_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_payment_method payment_method,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_entry_id UUID;
  v_line JSONB;
  v_gross NUMERIC;
  v_allow NUMERIC;
  v_ded NUMERIC;
  v_tax NUMERIC;
  v_net NUMERIC;
  v_sum_gross NUMERIC := 0;
  v_sum_allow NUMERIC := 0;
  v_sum_ded NUMERIC := 0;
  v_sum_tax NUMERIC := 0;
  v_sum_net NUMERIC := 0;
  v_pay_acct UUID;
  v_je_lines JSONB := '[]'::jsonb;
  v_emp_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_accounts(p_org_id);

  INSERT INTO payroll_runs (organization_id, period_start, period_end, payment_method, status, created_by)
  VALUES (p_org_id, p_period_start, p_period_end, p_payment_method, 'draft', auth.uid())
  RETURNING id INTO v_run_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_emp_id := (v_line->>'employeeId')::UUID;
    IF NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = v_emp_id AND e.organization_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'Invalid employee in payroll lines';
    END IF;

    v_gross := COALESCE((v_line->>'gross')::NUMERIC, 0);
    v_allow := COALESCE((v_line->>'allowances')::NUMERIC, 0);
    v_ded   := COALESCE((v_line->>'deductions')::NUMERIC, 0);
    v_tax   := COALESCE((v_line->>'tax')::NUMERIC, 0);
    v_net   := v_gross + v_allow - v_ded - v_tax;

    INSERT INTO payslips (organization_id, run_id, employee_id, gross, allowances, deductions, tax, net)
    VALUES (p_org_id, v_run_id, v_emp_id, v_gross, v_allow, v_ded, v_tax, v_net);

    v_sum_gross := v_sum_gross + v_gross;
    v_sum_allow := v_sum_allow + v_allow;
    v_sum_ded   := v_sum_ded + v_ded;
    v_sum_tax   := v_sum_tax + v_tax;
    v_sum_net   := v_sum_net + v_net;
  END LOOP;

  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(p_org_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(p_org_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(p_org_id, '1020')
    ELSE public.account_id_by_code(p_org_id, '1010')
  END;

  v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
    'accountId', public.account_id_by_code(p_org_id, '6400'),
    'debit', v_sum_gross + v_sum_allow, 'credit', 0, 'description', 'Payroll gross'));

  IF (v_sum_tax + v_sum_ded) > 0 THEN
    v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(p_org_id, '2100'),
      'debit', 0, 'credit', v_sum_tax + v_sum_ded, 'description', 'Payroll tax & deductions'));
  END IF;

  v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
    'accountId', v_pay_acct,
    'debit', 0, 'credit', v_sum_net, 'description', 'Net pay'));

  v_entry_id := public.post_journal_entry(
    p_org_id, 'GEN', p_period_end,
    'Payroll ' || p_period_start || ' to ' || p_period_end,
    'payroll', v_run_id, v_je_lines
  );

  UPDATE payroll_runs
  SET status = 'posted',
      total_gross = v_sum_gross + v_sum_allow,
      total_deductions = v_sum_ded,
      total_tax = v_sum_tax,
      total_net = v_sum_net,
      journal_entry_id = v_entry_id
  WHERE id = v_run_id;

  PERFORM public.hr_write_audit_log(
    p_org_id, 'payroll_run', v_run_id, 'posted', NULL,
    jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'total_net', v_sum_net
    )
  );

  PERFORM public.enqueue_notification_event(
    p_org_id,
    'hr.payroll_completed',
    'payroll_run',
    v_run_id,
    jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'total_net', v_sum_net,
      'employee_count', jsonb_array_length(p_lines)
    ),
    'payroll_run:' || v_run_id::text
  );

  RETURN v_run_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- HR notification templates
-- ---------------------------------------------------------------------------
INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'hr.leave_requested.manager', 'in_app', 'Leave requested (in-app)',
  'Leave request',
  '{{employee_name}} requested leave {{start_date}} to {{end_date}}.',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'hr.leave_requested.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'hr.leave_reviewed.employee', 'in_app', 'Leave reviewed (in-app)',
  'Leave {{status}}',
  'Leave for {{employee_name}} ({{start_date}} to {{end_date}}) was {{status}}.',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'hr.leave_reviewed.employee' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'hr.payroll_completed.manager', 'in_app', 'Payroll completed (in-app)',
  'Payroll posted',
  'Payroll {{period_start}} to {{period_end}} posted. Net pay: {{total_net}}.',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'hr.payroll_completed.manager' AND channel = 'in_app'
);

-- Extend rule-driven events
CREATE OR REPLACE FUNCTION public._notification_rule_driven_event(p_event_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_event_type IN (
    'pos.sale_completed',
    'inventory.low_stock',
    'inventory.out_of_stock',
    'inventory.stock_adjustment',
    'reports.daily_sales',
    'accounting.payment_received',
    'accounting.journal_posted',
    'crm.customer_created',
    'crm.complaint_logged',
    'security.login_failed',
    'system.queue_backlog',
    'hr.leave_requested',
    'hr.leave_reviewed',
    'hr.payroll_completed'
  );
$$;

-- Backfill HR notification rules for existing orgs (does not replace ensure_default_notification_rules).
CREATE OR REPLACE FUNCTION public.ensure_hr_notification_rules(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Leave requested — HR in-app', 'hr.leave_requested', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.leave_requested.manager"}'::jsonb,
    170, true
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND event_type = 'hr.leave_requested'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Leave reviewed — in-app', 'hr.leave_reviewed', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.leave_reviewed.employee"}'::jsonb,
    171, true
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND event_type = 'hr.leave_reviewed'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Payroll completed — in-app', 'hr.payroll_completed', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.payroll_completed.manager"}'::jsonb,
    172, true
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND event_type = 'hr.payroll_completed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_hr_notification_rules(UUID) TO authenticated;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_hr_notification_rules(v_org);
  END LOOP;
END;
$$;

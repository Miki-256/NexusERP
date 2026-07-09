-- HCM Wave 3: workforce time RPCs.

-- ---------------------------------------------------------------------------
-- Helpers & defaults
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_count_leave_days(
  p_org_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cal_id UUID;
  v_days NUMERIC := 0;
  v_d DATE;
BEGIN
  IF p_end_date < p_start_date THEN RETURN 0; END IF;

  SELECT id INTO v_cal_id FROM holiday_calendars
  WHERE organization_id = p_org_id AND is_default = true LIMIT 1;

  v_d := p_start_date;
  WHILE v_d <= p_end_date LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      IF v_cal_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM holiday_dates hd
        WHERE hd.calendar_id = v_cal_id
          AND (hd.holiday_date = v_d OR (hd.is_recurring AND EXTRACT(MONTH FROM hd.holiday_date) = EXTRACT(MONTH FROM v_d)
            AND EXTRACT(DAY FROM hd.holiday_date) = EXTRACT(DAY FROM v_d)))
      ) THEN
        v_days := v_days + 1;
      END IF;
    END IF;
    v_d := v_d + 1;
  END LOOP;

  RETURN v_days;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_default_leave_types(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO leave_types (organization_id, code, name, is_paid, annual_entitlement_days, sort_order)
  SELECT p_org_id, 'annual', 'Annual leave', true, 20, 1
  WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE organization_id = p_org_id AND code = 'annual');

  INSERT INTO leave_types (organization_id, code, name, is_paid, annual_entitlement_days, sort_order)
  SELECT p_org_id, 'sick', 'Sick leave', true, 10, 2
  WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE organization_id = p_org_id AND code = 'sick');

  INSERT INTO leave_types (organization_id, code, name, is_paid, annual_entitlement_days, sort_order)
  SELECT p_org_id, 'unpaid', 'Unpaid leave', false, 0, 3
  WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE organization_id = p_org_id AND code = 'unpaid');
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_default_holiday_calendar(p_org_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM holiday_calendars
  WHERE organization_id = p_org_id AND is_default = true LIMIT 1;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO holiday_calendars (organization_id, name, country_code, is_default)
  VALUES (p_org_id, 'Default calendar', NULL, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_default_attendance_rules(p_org_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM attendance_rules
  WHERE organization_id = p_org_id AND is_default = true LIMIT 1;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO attendance_rules (organization_id, name, is_default)
  VALUES (p_org_id, 'Default', true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_leave_balances_for_org(p_org_id UUID, p_year INT DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM current_date)::INT);
  v_emp RECORD;
  v_lt RECORD;
  v_count INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.user_can_manage_hr(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_leave_types(p_org_id);

  FOR v_emp IN SELECT id FROM employees WHERE organization_id = p_org_id AND status = 'active' LOOP
    FOR v_lt IN SELECT id, annual_entitlement_days FROM leave_types WHERE organization_id = p_org_id AND is_active = true LOOP
      INSERT INTO leave_balances (
        organization_id, employee_id, leave_type_id, balance_year, entitled_days
      ) VALUES (
        p_org_id, v_emp.id, v_lt.id, v_year, v_lt.annual_entitlement_days
      )
      ON CONFLICT (employee_id, leave_type_id, balance_year) DO UPDATE
      SET entitled_days = EXCLUDED.entitled_days;
      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public._apply_leave_balance_on_approval(p_leave_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req leave_requests%ROWTYPE;
  v_days NUMERIC;
  v_year INT;
BEGIN
  SELECT * INTO v_req FROM leave_requests WHERE id = p_leave_id;
  IF NOT FOUND OR v_req.leave_type_id IS NULL THEN RETURN; END IF;

  v_days := COALESCE(v_req.days_requested, public.hr_count_leave_days(
    v_req.organization_id, v_req.start_date, v_req.end_date));
  v_year := EXTRACT(YEAR FROM v_req.start_date)::INT;

  INSERT INTO leave_balances (
    organization_id, employee_id, leave_type_id, balance_year, entitled_days, used_days
  )
  SELECT v_req.organization_id, v_req.employee_id, v_req.leave_type_id, v_year,
    lt.annual_entitlement_days, v_days
  FROM leave_types lt WHERE lt.id = v_req.leave_type_id
  ON CONFLICT (employee_id, leave_type_id, balance_year) DO UPDATE
  SET used_days = leave_balances.used_days + EXCLUDED.used_days;
END;
$$;

-- ---------------------------------------------------------------------------
-- Leave types & balances
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_leave_types(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  PERFORM public.ensure_default_leave_types(p_org_id);
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(lt) ORDER BY lt.sort_order, lt.name), '[]'::jsonb)
    FROM leave_types lt WHERE lt.organization_id = p_org_id AND lt.is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_employee_leave_balances(
  p_org_id UUID,
  p_employee_id UUID DEFAULT NULL,
  p_year INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM current_date)::INT);
  v_emp_id UUID := p_employee_id;
  v_my_emp UUID;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  v_my_emp := public.my_employee_id(p_org_id);
  IF v_emp_id IS NULL THEN v_emp_id := v_my_emp; END IF;
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'Employee not specified'; END IF;

  IF NOT public.user_can_manage_hr(p_org_id) AND v_emp_id <> v_my_emp THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_leave_types(p_org_id);

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'leave_type_id', lt.id, 'code', lt.code, 'name', lt.name, 'is_paid', lt.is_paid,
      'entitled_days', COALESCE(lb.entitled_days, lt.annual_entitlement_days),
      'used_days', COALESCE(lb.used_days, 0),
      'carried_forward_days', COALESCE(lb.carried_forward_days, 0),
      'available_days', COALESCE(lb.entitled_days, lt.annual_entitlement_days)
        + COALESCE(lb.carried_forward_days, 0) - COALESCE(lb.used_days, 0)
    ) ORDER BY lt.sort_order), '[]'::jsonb)
    FROM leave_types lt
    LEFT JOIN leave_balances lb ON lb.leave_type_id = lt.id
      AND lb.employee_id = v_emp_id AND lb.balance_year = v_year
    WHERE lt.organization_id = p_org_id AND lt.is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_holiday_date(
  p_org_id UUID,
  p_name TEXT,
  p_holiday_date DATE,
  p_is_recurring BOOLEAN DEFAULT false,
  p_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cal_id UUID;
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_cal_id := public.ensure_default_holiday_calendar(p_org_id);

  IF p_id IS NOT NULL THEN
    UPDATE holiday_dates SET
      name = COALESCE(NULLIF(trim(p_name), ''), name),
      holiday_date = COALESCE(p_holiday_date, holiday_date),
      is_recurring = COALESCE(p_is_recurring, is_recurring)
    WHERE id = p_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO holiday_dates (calendar_id, organization_id, name, holiday_date, is_recurring)
    VALUES (v_cal_id, p_org_id, trim(p_name), p_holiday_date, COALESCE(p_is_recurring, false))
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_holiday_dates(p_org_id UUID, p_year INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM current_date)::INT);
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  PERFORM public.ensure_default_holiday_calendar(p_org_id);

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY h.holiday_date), '[]'::jsonb)
    FROM (
      SELECT hd.id, hd.name, hd.holiday_date, hd.is_recurring
      FROM holiday_dates hd
      JOIN holiday_calendars hc ON hc.id = hd.calendar_id
      WHERE hc.organization_id = p_org_id AND hc.is_default = true
        AND (EXTRACT(YEAR FROM hd.holiday_date) = v_year OR hd.is_recurring = true)
    ) h
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_leave_request(
  p_org_id UUID,
  p_employee_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_reason TEXT DEFAULT NULL,
  p_leave_type_id UUID DEFAULT NULL
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
  v_wf_id UUID;
  v_lt_id UUID;
  v_days NUMERIC;
  v_available NUMERIC;
  v_year INT;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_end_date < p_start_date THEN RAISE EXCEPTION 'End date must be on or after start date'; END IF;

  SELECT * INTO v_emp FROM employees
  WHERE id = p_employee_id AND organization_id = p_org_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found or inactive'; END IF;

  v_manage := public.user_can_manage_hr(p_org_id);
  v_my_emp := public.my_employee_id(p_org_id);
  IF NOT v_manage AND (v_my_emp IS NULL OR v_my_emp <> p_employee_id) THEN
    RAISE EXCEPTION 'You can only submit leave for your own employee profile';
  END IF;

  PERFORM public.ensure_default_leave_types(p_org_id);
  IF p_leave_type_id IS NOT NULL THEN
    v_lt_id := p_leave_type_id;
  ELSE
    SELECT id INTO v_lt_id FROM leave_types
    WHERE organization_id = p_org_id AND code = 'annual' AND is_active = true LIMIT 1;
  END IF;

  v_days := public.hr_count_leave_days(p_org_id, p_start_date, p_end_date);
  v_year := EXTRACT(YEAR FROM p_start_date)::INT;

  IF v_lt_id IS NOT NULL THEN
    SELECT
      COALESCE(lb.entitled_days, lt.annual_entitlement_days)
      + COALESCE(lb.carried_forward_days, 0) - COALESCE(lb.used_days, 0)
    INTO v_available
    FROM leave_types lt
    LEFT JOIN leave_balances lb ON lb.leave_type_id = lt.id
      AND lb.employee_id = p_employee_id AND lb.balance_year = v_year
    WHERE lt.id = v_lt_id;

    IF v_available IS NOT NULL AND v_days > v_available THEN
      RAISE EXCEPTION 'Insufficient leave balance (requested %, available %)', v_days, v_available;
    END IF;
  END IF;

  INSERT INTO leave_requests (
    organization_id, employee_id, leave_type_id, start_date, end_date,
    days_requested, reason, status, requested_by
  ) VALUES (
    p_org_id, p_employee_id, v_lt_id, p_start_date, p_end_date,
    v_days, NULLIF(trim(p_reason), ''), 'pending', auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.hr_write_audit_log(p_org_id, 'leave_request', v_id, 'submit', NULL,
    jsonb_build_object('employee_id', p_employee_id, 'days', v_days, 'leave_type_id', v_lt_id));

  PERFORM public.ensure_default_hr_workflows(p_org_id);
  v_wf_id := public._start_workflow(p_org_id, 'leave_request', v_id, 'leave_default');

  PERFORM public.enqueue_notification_event(p_org_id, 'hr.leave_requested', 'leave_request', v_id,
    jsonb_build_object('employee_name', v_emp.name, 'start_date', p_start_date, 'end_date', p_end_date,
      'reason', NULLIF(trim(p_reason), ''), 'days', v_days, 'workflow_id', v_wf_id),
    'leave_request:' || v_id::text);

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
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.user_can_manage_hr(v_req.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE leave_requests SET status = p_status, reviewed_by = auth.uid() WHERE id = p_request_id;

  IF p_status = 'approved' THEN
    PERFORM public._apply_leave_balance_on_approval(p_request_id);
    IF v_req.start_date <= current_date AND v_req.end_date >= current_date THEN
      UPDATE employees SET status = 'on_leave' WHERE id = v_req.employee_id AND status = 'active';
    END IF;
  END IF;

  SELECT name INTO v_emp_name FROM employees WHERE id = v_req.employee_id;
  PERFORM public.hr_write_audit_log(v_req.organization_id, 'leave_request', p_request_id, 'review', NULL,
    jsonb_build_object('status', p_status));
  PERFORM public.enqueue_notification_event(v_req.organization_id, 'hr.leave_reviewed', 'leave_request', p_request_id,
    jsonb_build_object('status', p_status, 'employee_name', v_emp_name),
    'leave_review:' || p_request_id::text || ':' || p_status::text);
END;
$$;

-- Patch workflow approval to apply leave balance
CREATE OR REPLACE FUNCTION public.approve_workflow_step(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_approved BOOLEAN,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance workflow_instances%ROWTYPE;
  v_def workflow_definitions%ROWTYPE;
  v_current_step JSONB;
  v_req leave_requests%ROWTYPE;
  v_emp employees%ROWTYPE;
  v_can_approve BOOLEAN := false;
  v_total_steps INT;
  v_next_step INT;
BEGIN
  SELECT wi.* INTO v_instance FROM workflow_instances wi
  WHERE wi.entity_type = p_entity_type AND wi.entity_id = p_entity_id AND wi.status = 'pending'
  ORDER BY wi.created_at DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('workflow', false, 'message', 'No pending workflow');
  END IF;

  SELECT * INTO v_def FROM workflow_definitions WHERE id = v_instance.definition_id;
  SELECT step INTO v_current_step FROM jsonb_array_elements(v_def.steps) AS step
  WHERE (step->>'order')::INT = v_instance.current_step;

  IF (v_current_step->>'approver') = 'hr' THEN
    v_can_approve := public.user_can_manage_hr(v_instance.organization_id);
  ELSIF (v_current_step->>'approver') = 'manager' AND p_entity_type = 'leave_request' THEN
    SELECT * INTO v_req FROM leave_requests WHERE id = p_entity_id;
    SELECT * INTO v_emp FROM employees WHERE id = v_req.employee_id;
    v_can_approve := v_emp.manager_employee_id IS NOT NULL
      AND v_emp.manager_employee_id = public.my_employee_id(v_instance.organization_id);
    IF NOT v_can_approve THEN
      v_can_approve := public.user_can_manage_hr(v_instance.organization_id);
    END IF;
  ELSE
    v_can_approve := public.user_can_manage_hr(v_instance.organization_id);
  END IF;

  IF NOT v_can_approve THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE workflow_approvals SET
    status = CASE WHEN p_approved THEN 'approved'::workflow_approval_status ELSE 'rejected'::workflow_approval_status END,
    approver_user_id = auth.uid(), notes = NULLIF(trim(p_notes), ''), decided_at = now()
  WHERE instance_id = v_instance.id AND step_order = v_instance.current_step;

  IF NOT p_approved THEN
    UPDATE workflow_instances SET status = 'rejected', completed_at = now() WHERE id = v_instance.id;
    IF p_entity_type = 'leave_request' THEN
      UPDATE leave_requests SET status = 'rejected', reviewed_by = auth.uid() WHERE id = p_entity_id;
    ELSIF p_entity_type = 'job_requisition' THEN
      UPDATE job_requisitions SET status = 'rejected' WHERE id = p_entity_id;
    END IF;
    RETURN jsonb_build_object('workflow', true, 'status', 'rejected');
  END IF;

  v_total_steps := jsonb_array_length(v_def.steps);
  v_next_step := v_instance.current_step + 1;

  IF v_next_step > v_total_steps THEN
    UPDATE workflow_instances SET status = 'approved', completed_at = now() WHERE id = v_instance.id;
    IF p_entity_type = 'leave_request' THEN
      SELECT * INTO v_req FROM leave_requests WHERE id = p_entity_id;
      UPDATE leave_requests SET status = 'approved', reviewed_by = auth.uid() WHERE id = p_entity_id;
      PERFORM public._apply_leave_balance_on_approval(p_entity_id);
      IF v_req.start_date <= current_date AND v_req.end_date >= current_date THEN
        UPDATE employees SET status = 'on_leave' WHERE id = v_req.employee_id AND status = 'active';
      END IF;
      PERFORM public.enqueue_notification_event(
        v_instance.organization_id, 'hr.leave_reviewed', 'leave_request', p_entity_id,
        jsonb_build_object('status', 'approved'), 'leave_workflow:' || p_entity_id::text || ':approved'
      );
    ELSIF p_entity_type = 'job_requisition' THEN
      UPDATE job_requisitions SET status = 'approved' WHERE id = p_entity_id;
    END IF;
    RETURN jsonb_build_object('workflow', true, 'status', 'approved');
  END IF;

  UPDATE workflow_instances SET current_step = v_next_step WHERE id = v_instance.id;
  RETURN jsonb_build_object('workflow', true, 'status', 'pending', 'current_step', v_next_step);
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
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_manage := public.user_can_manage_hr(p_org_id);
  v_my_emp := public.my_employee_id(p_org_id);

  SELECT COUNT(*) INTO v_total FROM leave_requests lr
  WHERE lr.organization_id = p_org_id
    AND (p_status IS NULL OR lr.status = p_status)
    AND (v_manage OR lr.requested_by = auth.uid() OR lr.employee_id = v_my_emp);

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT lr.id, lr.start_date, lr.end_date, lr.reason, lr.status, lr.days_requested,
      lr.created_at, lr.requested_by, lt.name AS leave_type_name,
      jsonb_build_object('name', e.name) AS employees
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.organization_id = p_org_id
      AND (p_status IS NULL OR lr.status = p_status)
      AND (v_manage OR lr.requested_by = auth.uid() OR lr.employee_id = v_my_emp)
    ORDER BY lr.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_work_shifts(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.name), '[]'::jsonb)
    FROM (
      SELECT ws.id, ws.name, ws.start_time, ws.end_time, ws.break_minutes,
        ws.grace_minutes_late, ws.store_id, ws.org_unit_id, ws.is_active
      FROM work_shifts ws WHERE ws.organization_id = p_org_id AND ws.is_active = true
    ) s
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_work_shift(
  p_org_id UUID,
  p_name TEXT,
  p_start_time TIME,
  p_end_time TIME,
  p_break_minutes INT DEFAULT 0,
  p_grace_minutes_late INT DEFAULT 15,
  p_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT := NULLIF(trim(p_name), '');
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Name is required'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE work_shifts SET
      name = v_name, start_time = p_start_time, end_time = p_end_time,
      break_minutes = COALESCE(p_break_minutes, break_minutes),
      grace_minutes_late = COALESCE(p_grace_minutes_late, grace_minutes_late)
    WHERE id = p_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO work_shifts (
      organization_id, name, start_time, end_time, break_minutes, grace_minutes_late
    ) VALUES (
      p_org_id, v_name, p_start_time, p_end_time,
      COALESCE(p_break_minutes, 0), COALESCE(p_grace_minutes_late, 15)
    )
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_shift_assignments(
  p_org_id UUID,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
  p_employee_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from DATE := COALESCE(p_from_date, current_date - 7);
  v_to DATE := COALESCE(p_to_date, current_date + 14);
  v_my_emp UUID;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_my_emp := public.my_employee_id(p_org_id);

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.assignment_date, x.employee_name), '[]'::jsonb)
    FROM (
      SELECT sa.id, sa.employee_id, sa.assignment_date, sa.notes,
        e.name AS employee_name, ws.name AS shift_name,
        ws.start_time, ws.end_time
      FROM shift_assignments sa
      JOIN employees e ON e.id = sa.employee_id
      JOIN work_shifts ws ON ws.id = sa.shift_id
      WHERE sa.organization_id = p_org_id
        AND sa.assignment_date BETWEEN v_from AND v_to
        AND (p_employee_id IS NULL OR sa.employee_id = p_employee_id)
        AND (public.user_can_manage_hr(p_org_id) OR sa.employee_id = v_my_emp)
    ) x
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_employee_shift(
  p_org_id UUID,
  p_employee_id UUID,
  p_shift_id UUID,
  p_assignment_date DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO shift_assignments (
    organization_id, employee_id, shift_id, assignment_date, notes
  ) VALUES (
    p_org_id, p_employee_id, p_shift_id, p_assignment_date, NULLIF(trim(p_notes), '')
  )
  ON CONFLICT (employee_id, assignment_date) DO UPDATE
  SET shift_id = EXCLUDED.shift_id, notes = EXCLUDED.notes
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Attendance clock in/out
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_attendance_status(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id UUID;
  v_open attendance_records%ROWTYPE;
  v_shift JSONB;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_emp_id := public.my_employee_id(p_org_id);
  IF v_emp_id IS NULL THEN
    RETURN jsonb_build_object('has_employee', false);
  END IF;

  SELECT * INTO v_open FROM attendance_records
  WHERE employee_id = v_emp_id AND status = 'open' LIMIT 1;

  SELECT jsonb_build_object(
    'shift_name', ws.name, 'start_time', ws.start_time, 'end_time', ws.end_time
  ) INTO v_shift
  FROM shift_assignments sa
  JOIN work_shifts ws ON ws.id = sa.shift_id
  WHERE sa.employee_id = v_emp_id AND sa.assignment_date = current_date
  LIMIT 1;

  RETURN jsonb_build_object(
    'has_employee', true,
    'employee_id', v_emp_id,
    'is_clocked_in', v_open.id IS NOT NULL,
    'open_record', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_open.id, 'clock_in_at', v_open.clock_in_at, 'clock_in_method', v_open.clock_in_method
    ) END,
    'today_shift', v_shift
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.clock_in(
  p_org_id UUID,
  p_method attendance_method DEFAULT 'web',
  p_lat NUMERIC DEFAULT NULL,
  p_lng NUMERIC DEFAULT NULL,
  p_store_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id UUID;
  v_id UUID;
  v_shift_id UUID;
  v_sa_id UUID;
  v_rules attendance_rules%ROWTYPE;
  v_shift work_shifts%ROWTYPE;
  v_is_late BOOLEAN := false;
  v_scheduled_start TIME;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_emp_id := public.my_employee_id(p_org_id);
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'No linked employee profile'; END IF;

  IF EXISTS (SELECT 1 FROM attendance_records WHERE employee_id = v_emp_id AND status = 'open') THEN
    RAISE EXCEPTION 'Already clocked in';
  END IF;

  SELECT sa.id, sa.shift_id INTO v_sa_id, v_shift_id
  FROM shift_assignments sa
  WHERE sa.employee_id = v_emp_id AND sa.assignment_date = current_date LIMIT 1;

  PERFORM public.ensure_default_attendance_rules(p_org_id);
  SELECT * INTO v_rules FROM attendance_rules WHERE organization_id = p_org_id AND is_default = true LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    SELECT * INTO v_shift FROM work_shifts WHERE id = v_shift_id;
    v_scheduled_start := v_shift.start_time;
    IF (current_time > v_scheduled_start + ((v_shift.grace_minutes_late + v_rules.late_after_minutes) || ' minutes')::interval) THEN
      v_is_late := true;
    END IF;
  END IF;

  INSERT INTO attendance_records (
    organization_id, employee_id, shift_assignment_id, clock_in_at,
    clock_in_method, clock_in_lat, clock_in_lng, store_id, is_late, status
  ) VALUES (
    p_org_id, v_emp_id, v_sa_id, now(), COALESCE(p_method, 'web'),
    p_lat, p_lng, p_store_id, v_is_late, 'open'
  )
  RETURNING id INTO v_id;

  PERFORM public.hr_write_audit_log(p_org_id, 'attendance', v_id, 'clock_in', NULL,
    jsonb_build_object('method', p_method, 'is_late', v_is_late));

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clock_out(
  p_org_id UUID,
  p_method attendance_method DEFAULT 'web',
  p_lat NUMERIC DEFAULT NULL,
  p_lng NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id UUID;
  v_rec attendance_records%ROWTYPE;
  v_rules attendance_rules%ROWTYPE;
  v_shift work_shifts%ROWTYPE;
  v_is_early BOOLEAN := false;
  v_overtime INT := 0;
  v_worked_minutes INT;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_emp_id := public.my_employee_id(p_org_id);
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'No linked employee profile'; END IF;

  SELECT * INTO v_rec FROM attendance_records
  WHERE employee_id = v_emp_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not clocked in'; END IF;

  SELECT * INTO v_rules FROM attendance_rules WHERE organization_id = p_org_id AND is_default = true LIMIT 1;

  IF v_rec.shift_assignment_id IS NOT NULL THEN
    SELECT ws.* INTO v_shift FROM shift_assignments sa
    JOIN work_shifts ws ON ws.id = sa.shift_id
    WHERE sa.id = v_rec.shift_assignment_id;

    IF current_time < v_shift.end_time - ((v_rules.early_leave_before_minutes) || ' minutes')::interval THEN
      v_is_early := true;
    END IF;

    v_worked_minutes := EXTRACT(EPOCH FROM (now() - v_rec.clock_in_at))::INT / 60;
    IF v_worked_minutes > EXTRACT(EPOCH FROM (v_shift.end_time - v_shift.start_time))::INT / 60
      + v_rules.overtime_after_minutes - v_shift.break_minutes THEN
      v_overtime := v_worked_minutes
        - EXTRACT(EPOCH FROM (v_shift.end_time - v_shift.start_time))::INT / 60
        + v_shift.break_minutes;
      IF v_overtime < 0 THEN v_overtime := 0; END IF;
    END IF;
  END IF;

  UPDATE attendance_records SET
    clock_out_at = now(),
    clock_out_method = COALESCE(p_method, 'web'),
    clock_out_lat = p_lat,
    clock_out_lng = p_lng,
    is_early_leave = v_is_early,
    overtime_minutes = v_overtime,
    status = 'closed'
  WHERE id = v_rec.id;

  PERFORM public.hr_write_audit_log(p_org_id, 'attendance', v_rec.id, 'clock_out', NULL,
    jsonb_build_object('is_early', v_is_early, 'overtime_minutes', v_overtime));

  RETURN v_rec.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_attendance_records(
  p_org_id UUID,
  p_employee_id UUID DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
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
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_from TIMESTAMPTZ := COALESCE(p_from_date, current_date - 30)::TIMESTAMPTZ;
  v_to TIMESTAMPTZ := (COALESCE(p_to_date, current_date) + 1)::TIMESTAMPTZ;
  v_total BIGINT;
  v_items JSONB;
  v_my_emp UUID;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_my_emp := public.my_employee_id(p_org_id);

  SELECT COUNT(*) INTO v_total FROM attendance_records ar
  WHERE ar.organization_id = p_org_id
    AND ar.clock_in_at >= v_from AND ar.clock_in_at < v_to
    AND (p_employee_id IS NULL OR ar.employee_id = p_employee_id)
    AND (public.user_can_manage_hr(p_org_id) OR ar.employee_id = v_my_emp);

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.clock_in_at DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT ar.id, ar.employee_id, e.name AS employee_name, ar.clock_in_at, ar.clock_out_at,
      ar.clock_in_method, ar.status, ar.is_late, ar.is_early_leave, ar.overtime_minutes
    FROM attendance_records ar
    JOIN employees e ON e.id = ar.employee_id
    WHERE ar.organization_id = p_org_id
      AND ar.clock_in_at >= v_from AND ar.clock_in_at < v_to
      AND (p_employee_id IS NULL OR ar.employee_id = p_employee_id)
      AND (public.user_can_manage_hr(p_org_id) OR ar.employee_id = v_my_emp)
    ORDER BY ar.clock_in_at DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

-- Seed defaults for existing orgs
DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_leave_types(v_org);
    PERFORM public.ensure_default_holiday_calendar(v_org);
    PERFORM public.ensure_default_attendance_rules(v_org);
    PERFORM public.sync_leave_balances_for_org(v_org, EXTRACT(YEAR FROM current_date)::INT);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_count_leave_days(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_leave_types(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_leave_balances(UUID, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_leave_balances_for_org(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_holiday_date(UUID, TEXT, DATE, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_holiday_dates(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_work_shifts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_work_shift(UUID, TEXT, TIME, TIME, INT, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_shift_assignments(UUID, DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_employee_shift(UUID, UUID, UUID, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_attendance_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clock_in(UUID, attendance_method, NUMERIC, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clock_out(UUID, attendance_method, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_leave_request(UUID, UUID, DATE, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_leave_requests(UUID, leave_status, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_leave_request(UUID, leave_status) TO authenticated;

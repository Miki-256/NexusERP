-- HCM Wave 1: RPCs, workflow integration, extended employee list.

-- ---------------------------------------------------------------------------
-- Org unit RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_org_units(p_org_id UUID)
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
    SELECT COALESCE(jsonb_agg(row_to_json(u) ORDER BY u.sort_order, u.name), '[]'::jsonb)
    FROM (
      SELECT
        ou.id, ou.parent_id, ou.unit_type, ou.code, ou.name, ou.description,
        ou.manager_employee_id, ou.analytic_department_id, ou.is_active, ou.sort_order,
        (SELECT COUNT(*)::INT FROM employees e WHERE e.org_unit_id = ou.id AND e.status = 'active') AS headcount
      FROM org_units ou
      WHERE ou.organization_id = p_org_id AND ou.is_active = true
    ) u
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_org_unit(
  p_org_id UUID,
  p_id UUID DEFAULT NULL,
  p_parent_id UUID DEFAULT NULL,
  p_unit_type org_unit_type DEFAULT 'department',
  p_code TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_manager_employee_id UUID DEFAULT NULL,
  p_sort_order INT DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_code TEXT := NULLIF(trim(COALESCE(p_code, '')), '');
  v_name TEXT := NULLIF(trim(COALESCE(p_name, '')), '');
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Name is required'; END IF;
  IF v_code IS NULL THEN
    v_code := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE org_units SET
      parent_id = p_parent_id,
      unit_type = COALESCE(p_unit_type, unit_type),
      code = v_code,
      name = v_name,
      description = NULLIF(trim(COALESCE(p_description, '')), ''),
      manager_employee_id = p_manager_employee_id,
      sort_order = COALESCE(p_sort_order, sort_order)
    WHERE id = p_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO org_units (
      organization_id, parent_id, unit_type, code, name, description, manager_employee_id, sort_order
    ) VALUES (
      p_org_id, p_parent_id, p_unit_type, v_code, v_name,
      NULLIF(trim(COALESCE(p_description, '')), ''), p_manager_employee_id, COALESCE(p_sort_order, 0)
    )
    RETURNING id INTO v_id;
  END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'Org unit not found'; END IF;

  PERFORM public.hr_write_audit_log(
    p_org_id, 'org_unit', v_id, CASE WHEN p_id IS NULL THEN 'create' ELSE 'update' END,
    NULL, jsonb_build_object('name', v_name, 'code', v_code)
  );
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_org_chart(p_org_id UUID)
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
    WITH RECURSIVE tree AS (
      SELECT ou.*, 0 AS depth
      FROM org_units ou
      WHERE ou.organization_id = p_org_id AND ou.is_active = true AND ou.parent_id IS NULL
      UNION ALL
      SELECT c.*, t.depth + 1
      FROM org_units c
      JOIN tree t ON c.parent_id = t.id
      WHERE c.organization_id = p_org_id AND c.is_active = true
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', id, 'parent_id', parent_id, 'unit_type', unit_type,
        'code', code, 'name', name, 'depth', depth,
        'headcount', (SELECT COUNT(*) FROM employees e WHERE e.org_unit_id = tree.id AND e.status = 'active')
      ) ORDER BY depth, sort_order, name
    ), '[]'::jsonb)
    FROM tree
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Employee 360°
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_employee_360(p_employee_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_profile JSONB;
  v_dependents JSONB;
  v_documents JSONB;
  v_leaves JSONB;
  v_org_unit JSONB;
  v_position JSONB;
  v_manager JSONB;
BEGIN
  IF NOT public.user_can_view_employee(p_employee_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;

  SELECT to_jsonb(ep.*) INTO v_profile FROM employee_profiles ep WHERE ep.employee_id = p_employee_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.full_name), '[]'::jsonb) INTO v_dependents
    FROM employee_dependents d WHERE d.employee_id = p_employee_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(doc) ORDER BY doc.created_at DESC), '[]'::jsonb) INTO v_documents
    FROM employee_documents doc WHERE doc.employee_id = p_employee_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', lr.id, 'start_date', lr.start_date, 'end_date', lr.end_date, 'status', lr.status, 'reason', lr.reason
    ) ORDER BY lr.created_at DESC), '[]'::jsonb) INTO v_leaves
    FROM leave_requests lr WHERE lr.employee_id = p_employee_id LIMIT 20;

  IF v_emp.org_unit_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', ou.id, 'name', ou.name, 'code', ou.code) INTO v_org_unit
    FROM org_units ou WHERE ou.id = v_emp.org_unit_id;
  END IF;
  IF v_emp.hr_position_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', hp.id, 'title', hp.title, 'code', hp.code) INTO v_position
    FROM hr_positions hp WHERE hp.id = v_emp.hr_position_id;
  END IF;
  IF v_emp.manager_employee_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', m.id, 'name', m.name) INTO v_manager
    FROM employees m WHERE m.id = v_emp.manager_employee_id;
  END IF;

  RETURN jsonb_build_object(
    'employee', jsonb_build_object(
      'id', v_emp.id, 'organization_id', v_emp.organization_id, 'name', v_emp.name,
      'position', v_emp.position, 'email', v_emp.email, 'phone', v_emp.phone,
      'employment_type', v_emp.employment_type,
      'base_salary', CASE WHEN public.user_can_manage_hr(v_emp.organization_id) THEN v_emp.base_salary ELSE NULL END,
      'payment_method', v_emp.payment_method, 'hire_date', v_emp.hire_date, 'status', v_emp.status,
      'store_id', v_emp.store_id, 'user_id', v_emp.user_id, 'employee_number', v_emp.employee_number,
      'org_unit_id', v_emp.org_unit_id, 'hr_position_id', v_emp.hr_position_id,
      'manager_employee_id', v_emp.manager_employee_id, 'notes', v_emp.notes
    ),
    'profile', COALESCE(v_profile, '{}'::jsonb),
    'dependents', v_dependents,
    'documents', v_documents,
    'leave_history', v_leaves,
    'org_unit', COALESCE(v_org_unit, 'null'::jsonb),
    'hr_position', COALESCE(v_position, 'null'::jsonb),
    'manager', COALESCE(v_manager, 'null'::jsonb),
    'can_manage', public.user_can_manage_hr(v_emp.organization_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_employee_360(
  p_employee_id UUID,
  p_employee JSONB DEFAULT '{}'::jsonb,
  p_profile JSONB DEFAULT '{}'::jsonb,
  p_dependents JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_dep JSONB;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF NOT public.user_can_manage_hr(v_emp.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE employees SET
    name = COALESCE(p_employee->>'name', name),
    position = COALESCE(NULLIF(p_employee->>'position', ''), position),
    email = COALESCE(NULLIF(p_employee->>'email', ''), email),
    phone = COALESCE(NULLIF(p_employee->>'phone', ''), phone),
    employment_type = COALESCE((p_employee->>'employment_type')::employment_type, employment_type),
    base_salary = COALESCE((p_employee->>'base_salary')::NUMERIC, base_salary),
    payment_method = COALESCE((p_employee->>'payment_method')::payment_method, payment_method),
    hire_date = COALESCE((p_employee->>'hire_date')::DATE, hire_date),
    status = COALESCE((p_employee->>'status')::employee_status, status),
    store_id = CASE WHEN p_employee ? 'store_id' THEN NULLIF(p_employee->>'store_id', '')::UUID ELSE store_id END,
    employee_number = COALESCE(NULLIF(p_employee->>'employee_number', ''), employee_number),
    org_unit_id = CASE WHEN p_employee ? 'org_unit_id' THEN NULLIF(p_employee->>'org_unit_id', '')::UUID ELSE org_unit_id END,
    hr_position_id = CASE WHEN p_employee ? 'hr_position_id' THEN NULLIF(p_employee->>'hr_position_id', '')::UUID ELSE hr_position_id END,
    manager_employee_id = CASE WHEN p_employee ? 'manager_employee_id' THEN NULLIF(p_employee->>'manager_employee_id', '')::UUID ELSE manager_employee_id END,
    notes = COALESCE(NULLIF(p_employee->>'notes', ''), notes)
  WHERE id = p_employee_id;

  INSERT INTO employee_profiles (
    employee_id, organization_id, date_of_birth, gender, marital_status, nationality,
    address_line1, address_line2, city, state_region, postal_code, country,
    national_id, passport_number, passport_expiry, visa_number, visa_expiry,
    driving_license, driving_license_expiry, work_email, work_phone,
    termination_date, probation_end_date,
    emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
    bank_name, bank_account_number, bank_branch, medical_notes
  ) VALUES (
    p_employee_id, v_emp.organization_id,
    NULLIF(p_profile->>'date_of_birth', '')::DATE, NULLIF(p_profile->>'gender', ''),
    NULLIF(p_profile->>'marital_status', ''), NULLIF(p_profile->>'nationality', ''),
    NULLIF(p_profile->>'address_line1', ''), NULLIF(p_profile->>'address_line2', ''),
    NULLIF(p_profile->>'city', ''), NULLIF(p_profile->>'state_region', ''),
    NULLIF(p_profile->>'postal_code', ''), NULLIF(p_profile->>'country', ''),
    NULLIF(p_profile->>'national_id', ''), NULLIF(p_profile->>'passport_number', ''),
    NULLIF(p_profile->>'passport_expiry', '')::DATE, NULLIF(p_profile->>'visa_number', ''),
    NULLIF(p_profile->>'visa_expiry', '')::DATE, NULLIF(p_profile->>'driving_license', ''),
    NULLIF(p_profile->>'driving_license_expiry', '')::DATE,
    NULLIF(p_profile->>'work_email', ''), NULLIF(p_profile->>'work_phone', ''),
    NULLIF(p_profile->>'termination_date', '')::DATE, NULLIF(p_profile->>'probation_end_date', '')::DATE,
    NULLIF(p_profile->>'emergency_contact_name', ''), NULLIF(p_profile->>'emergency_contact_phone', ''),
    NULLIF(p_profile->>'emergency_contact_relation', ''),
    NULLIF(p_profile->>'bank_name', ''), NULLIF(p_profile->>'bank_account_number', ''),
    NULLIF(p_profile->>'bank_branch', ''), NULLIF(p_profile->>'medical_notes', '')
  )
  ON CONFLICT (employee_id) DO UPDATE SET
    date_of_birth = EXCLUDED.date_of_birth, gender = EXCLUDED.gender,
    marital_status = EXCLUDED.marital_status, nationality = EXCLUDED.nationality,
    address_line1 = EXCLUDED.address_line1, address_line2 = EXCLUDED.address_line2,
    city = EXCLUDED.city, state_region = EXCLUDED.state_region,
    postal_code = EXCLUDED.postal_code, country = EXCLUDED.country,
    national_id = EXCLUDED.national_id, passport_number = EXCLUDED.passport_number,
    passport_expiry = EXCLUDED.passport_expiry, visa_number = EXCLUDED.visa_number,
    visa_expiry = EXCLUDED.visa_expiry, driving_license = EXCLUDED.driving_license,
    driving_license_expiry = EXCLUDED.driving_license_expiry,
    work_email = EXCLUDED.work_email, work_phone = EXCLUDED.work_phone,
    termination_date = EXCLUDED.termination_date, probation_end_date = EXCLUDED.probation_end_date,
    emergency_contact_name = EXCLUDED.emergency_contact_name,
    emergency_contact_phone = EXCLUDED.emergency_contact_phone,
    emergency_contact_relation = EXCLUDED.emergency_contact_relation,
    bank_name = EXCLUDED.bank_name, bank_account_number = EXCLUDED.bank_account_number,
    bank_branch = EXCLUDED.bank_branch, medical_notes = EXCLUDED.medical_notes;

  IF p_dependents IS NOT NULL AND jsonb_typeof(p_dependents) = 'array' THEN
    DELETE FROM employee_dependents WHERE employee_id = p_employee_id;
    FOR v_dep IN SELECT * FROM jsonb_array_elements(p_dependents) LOOP
      IF NULLIF(trim(v_dep->>'full_name'), '') IS NOT NULL THEN
        INSERT INTO employee_dependents (employee_id, organization_id, full_name, relationship, date_of_birth)
        VALUES (p_employee_id, v_emp.organization_id, trim(v_dep->>'full_name'),
          NULLIF(v_dep->>'relationship', ''), NULLIF(v_dep->>'date_of_birth', '')::DATE);
      END IF;
    END LOOP;
  END IF;

  PERFORM public.hr_write_audit_log(v_emp.organization_id, 'employee', p_employee_id, 'save_360', NULL, p_employee);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_employee_document(
  p_employee_id UUID,
  p_name TEXT,
  p_document_type TEXT DEFAULT 'general',
  p_url TEXT DEFAULT NULL,
  p_mime_type TEXT DEFAULT NULL,
  p_expires_at DATE DEFAULT NULL,
  p_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF NOT public.user_can_manage_hr(v_emp.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE employee_documents SET
      name = COALESCE(NULLIF(trim(p_name), ''), name),
      document_type = COALESCE(NULLIF(trim(p_document_type), ''), document_type),
      url = COALESCE(NULLIF(trim(p_url), ''), url),
      mime_type = COALESCE(p_mime_type, mime_type),
      expires_at = p_expires_at
    WHERE id = p_id AND employee_id = p_employee_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO employee_documents (
      organization_id, employee_id, document_type, name, url, mime_type, expires_at, uploaded_by
    ) VALUES (
      v_emp.organization_id, p_employee_id,
      COALESCE(NULLIF(trim(p_document_type), ''), 'general'),
      trim(p_name), NULLIF(trim(p_url), ''), p_mime_type, p_expires_at, auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Workflow
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._start_workflow(
  p_org_id UUID,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_definition_code TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_def workflow_definitions%ROWTYPE;
  v_instance_id UUID;
  v_step JSONB;
  v_order INT;
BEGIN
  SELECT * INTO v_def FROM workflow_definitions
  WHERE organization_id = p_org_id AND entity_type = p_entity_type AND is_active = true
    AND (p_definition_code IS NULL OR code = p_definition_code)
  ORDER BY created_at LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO workflow_instances (
    organization_id, definition_id, entity_type, entity_id, current_step, status, created_by
  ) VALUES (p_org_id, v_def.id, p_entity_type, p_entity_id, 1, 'pending', auth.uid())
  RETURNING id INTO v_instance_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(v_def.steps) LOOP
    v_order := (v_step->>'order')::INT;
    INSERT INTO workflow_approvals (instance_id, step_order, approver_role, status)
    VALUES (v_instance_id, v_order, v_step->>'approver', 'pending');
  END LOOP;

  RETURN v_instance_id;
END;
$$;

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
      IF v_req.start_date <= current_date AND v_req.end_date >= current_date THEN
        UPDATE employees SET status = 'on_leave' WHERE id = v_req.employee_id AND status = 'active';
      END IF;
      PERFORM public.enqueue_notification_event(
        v_instance.organization_id, 'hr.leave_reviewed', 'leave_request', p_entity_id,
        jsonb_build_object('status', 'approved'), 'leave_workflow:' || p_entity_id::text || ':approved'
      );
    END IF;
    RETURN jsonb_build_object('workflow', true, 'status', 'approved');
  END IF;

  UPDATE workflow_instances SET current_step = v_next_step WHERE id = v_instance.id;
  RETURN jsonb_build_object('workflow', true, 'status', 'pending', 'current_step', v_next_step);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_leave_workflow_status(p_leave_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance workflow_instances%ROWTYPE;
  v_def workflow_definitions%ROWTYPE;
BEGIN
  SELECT wi.* INTO v_instance FROM workflow_instances wi
  JOIN leave_requests lr ON lr.id = p_leave_id
  WHERE wi.entity_type = 'leave_request' AND wi.entity_id = p_leave_id
    AND wi.organization_id = lr.organization_id
  ORDER BY wi.created_at DESC LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('has_workflow', false); END IF;

  SELECT * INTO v_def FROM workflow_definitions WHERE id = v_instance.definition_id;
  RETURN jsonb_build_object(
    'has_workflow', true, 'status', v_instance.status,
    'current_step', v_instance.current_step,
    'total_steps', jsonb_array_length(v_def.steps), 'steps', v_def.steps
  );
END;
$$;

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
  v_wf_id UUID;
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

  INSERT INTO leave_requests (organization_id, employee_id, start_date, end_date, reason, status, requested_by)
  VALUES (p_org_id, p_employee_id, p_start_date, p_end_date, NULLIF(trim(p_reason), ''), 'pending', auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.hr_write_audit_log(p_org_id, 'leave_request', v_id, 'submit', NULL,
    jsonb_build_object('employee_id', p_employee_id, 'start_date', p_start_date, 'end_date', p_end_date));

  PERFORM public.ensure_default_hr_workflows(p_org_id);
  v_wf_id := public._start_workflow(p_org_id, 'leave_request', v_id, 'leave_default');

  PERFORM public.enqueue_notification_event(p_org_id, 'hr.leave_requested', 'leave_request', v_id,
    jsonb_build_object('employee_name', v_emp.name, 'start_date', p_start_date, 'end_date', p_end_date,
      'reason', NULLIF(trim(p_reason), ''), 'workflow_id', v_wf_id),
    'leave_request:' || v_id::text);

  RETURN v_id;
END;
$$;

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
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF NOT public.user_can_manage_hr(p_org_id) AND public.my_employee_id(p_org_id) IS NULL THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_sensitive := public.user_can_manage_hr(p_org_id);

  SELECT COUNT(*) INTO v_total FROM employees e
  WHERE e.organization_id = p_org_id
    AND (p_status IS NULL OR e.status = p_status)
    AND (v_q IS NULL OR e.name ILIKE '%' || v_q || '%' OR COALESCE(e.email, '') ILIKE '%' || v_q || '%'
      OR COALESCE(e.position, '') ILIKE '%' || v_q || '%' OR COALESCE(e.employee_number, '') ILIKE '%' || v_q || '%')
    AND (v_sensitive OR e.user_id = auth.uid());

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.name), '[]'::jsonb) INTO v_items FROM (
    SELECT e.id, e.name, e.position, e.email, e.phone, e.employment_type,
      CASE WHEN v_sensitive THEN e.base_salary ELSE NULL END AS base_salary,
      e.payment_method, e.hire_date, e.status, e.store_id, e.user_id,
      e.employee_number, e.org_unit_id, e.manager_employee_id,
      ou.name AS org_unit_name, e.created_at
    FROM employees e
    LEFT JOIN org_units ou ON ou.id = e.org_unit_id
    WHERE e.organization_id = p_org_id
      AND (p_status IS NULL OR e.status = p_status)
      AND (v_q IS NULL OR e.name ILIKE '%' || v_q || '%' OR COALESCE(e.email, '') ILIKE '%' || v_q || '%'
        OR COALESCE(e.position, '') ILIKE '%' || v_q || '%' OR COALESCE(e.employee_number, '') ILIKE '%' || v_q || '%')
      AND (v_sensitive OR e.user_id = auth.uid())
    ORDER BY e.name LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_org_units(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_org_unit(UUID, UUID, UUID, org_unit_type, TEXT, TEXT, TEXT, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_chart(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_hr_org(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_analytic_departments_to_org(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_360(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_employee_360(UUID, JSONB, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_employee_document(UUID, TEXT, TEXT, TEXT, TEXT, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_workflow_step(TEXT, UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leave_workflow_status(UUID) TO authenticated;

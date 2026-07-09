-- HCM Wave 2: talent acquisition & onboarding RPCs.

-- ---------------------------------------------------------------------------
-- Job requisitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_job_requisitions(
  p_org_id UUID,
  p_status job_requisition_status DEFAULT NULL,
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
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COUNT(*) INTO v_total FROM job_requisitions jr
  WHERE jr.organization_id = p_org_id AND (p_status IS NULL OR jr.status = p_status);

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT jr.id, jr.title, jr.department, jr.org_unit_id, jr.headcount, jr.employment_type,
      jr.justification, jr.status, jr.job_position_id, jr.created_at,
      ou.name AS org_unit_name
    FROM job_requisitions jr
    LEFT JOIN org_units ou ON ou.id = jr.org_unit_id
    WHERE jr.organization_id = p_org_id AND (p_status IS NULL OR jr.status = p_status)
    ORDER BY jr.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_job_requisition(
  p_org_id UUID,
  p_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_department TEXT DEFAULT NULL,
  p_org_unit_id UUID DEFAULT NULL,
  p_headcount INT DEFAULT 1,
  p_employment_type employment_type DEFAULT 'full_time',
  p_justification TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_title TEXT := NULLIF(trim(COALESCE(p_title, '')), '');
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Title is required'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE job_requisitions SET
      title = v_title,
      department = NULLIF(trim(COALESCE(p_department, '')), ''),
      org_unit_id = p_org_unit_id,
      headcount = GREATEST(1, COALESCE(p_headcount, headcount)),
      employment_type = COALESCE(p_employment_type, employment_type),
      justification = NULLIF(trim(COALESCE(p_justification, '')), '')
    WHERE id = p_id AND organization_id = p_org_id AND status IN ('draft', 'rejected')
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO job_requisitions (
      organization_id, title, department, org_unit_id, headcount, employment_type,
      justification, status, requested_by
    ) VALUES (
      p_org_id, v_title, NULLIF(trim(COALESCE(p_department, '')), ''), p_org_unit_id,
      GREATEST(1, COALESCE(p_headcount, 1)), COALESCE(p_employment_type, 'full_time'),
      NULLIF(trim(COALESCE(p_justification, '')), ''), 'draft', auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'Requisition not found or not editable'; END IF;

  PERFORM public.hr_write_audit_log(p_org_id, 'job_requisition', v_id, 'upsert', NULL,
    jsonb_build_object('title', v_title));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_job_requisition(p_requisition_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req job_requisitions%ROWTYPE;
  v_wf_id UUID;
BEGIN
  SELECT * INTO v_req FROM job_requisitions WHERE id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found'; END IF;
  IF NOT public.user_can_manage_hr(v_req.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_req.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Only draft or rejected requisitions can be submitted';
  END IF;

  UPDATE job_requisitions SET status = 'pending_approval' WHERE id = p_requisition_id;

  PERFORM public.ensure_default_hr_workflows(v_req.organization_id);
  v_wf_id := public._start_workflow(v_req.organization_id, 'job_requisition', p_requisition_id, 'job_requisition_default');

  PERFORM public.hr_write_audit_log(v_req.organization_id, 'job_requisition', p_requisition_id, 'submit', NULL,
    jsonb_build_object('workflow_id', v_wf_id));

  RETURN p_requisition_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_job_requisition(p_requisition_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req job_requisitions%ROWTYPE;
  v_job_id UUID;
BEGIN
  SELECT * INTO v_req FROM job_requisitions WHERE id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found'; END IF;
  IF NOT public.user_can_manage_hr(v_req.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_req.status NOT IN ('approved', 'posted') THEN
    RAISE EXCEPTION 'Requisition must be approved before posting';
  END IF;
  IF v_req.job_position_id IS NOT NULL THEN RETURN v_req.job_position_id; END IF;

  INSERT INTO job_positions (
    organization_id, title, department, requisition_id, org_unit_id, employment_type, is_open
  ) VALUES (
    v_req.organization_id, v_req.title, v_req.department, v_req.id,
    v_req.org_unit_id, v_req.employment_type, true
  )
  RETURNING id INTO v_job_id;

  UPDATE job_requisitions SET status = 'posted', job_position_id = v_job_id WHERE id = p_requisition_id;

  PERFORM public.hr_write_audit_log(v_req.organization_id, 'job_requisition', p_requisition_id, 'publish', NULL,
    jsonb_build_object('job_position_id', v_job_id));

  RETURN v_job_id;
END;
$$;

-- Extend workflow approval for job requisitions
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
  v_jr job_requisitions%ROWTYPE;
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

-- ---------------------------------------------------------------------------
-- Applicant pipeline
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_applicant_pipeline(p_applicant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app job_applicants%ROWTYPE;
  v_interviews JSONB;
  v_offers JSONB;
  v_job JSONB;
BEGIN
  SELECT * INTO v_app FROM job_applicants WHERE id = p_applicant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Applicant not found'; END IF;
  IF NOT public.user_has_hr_app_access(v_app.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(i) ORDER BY i.scheduled_at DESC), '[]'::jsonb) INTO v_interviews
  FROM (
    SELECT ai.id, ai.scheduled_at, ai.duration_minutes, ai.status, ai.location_or_link,
      ai.notes, ai.scorecard, e.name AS interviewer_name
    FROM applicant_interviews ai
    LEFT JOIN employees e ON e.id = ai.interviewer_employee_id
    WHERE ai.applicant_id = p_applicant_id
  ) i;

  SELECT COALESCE(jsonb_agg(row_to_json(o) ORDER BY o.created_at DESC), '[]'::jsonb) INTO v_offers
  FROM (
    SELECT jo.id, jo.salary, jo.start_date, jo.employment_type, jo.status,
      jo.offer_letter_url, jo.notes, jo.sent_at, jo.created_at
    FROM job_offers jo WHERE jo.applicant_id = p_applicant_id
  ) o;

  SELECT jsonb_build_object('id', jp.id, 'title', jp.title, 'department', jp.department) INTO v_job
  FROM job_positions jp WHERE jp.id = v_app.position_id;

  RETURN jsonb_build_object(
    'applicant', jsonb_build_object(
      'id', v_app.id, 'full_name', v_app.full_name, 'email', v_app.email, 'phone', v_app.phone,
      'status', v_app.status, 'resume_url', v_app.resume_url, 'source', v_app.source,
      'hired_employee_id', v_app.hired_employee_id, 'created_at', v_app.created_at
    ),
    'job', COALESCE(v_job, 'null'::jsonb),
    'interviews', v_interviews,
    'offers', v_offers,
    'can_manage', public.user_can_manage_hr(v_app.organization_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_applicant_interview(
  p_applicant_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_duration_minutes INT DEFAULT 60,
  p_interviewer_employee_id UUID DEFAULT NULL,
  p_location_or_link TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app job_applicants%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO v_app FROM job_applicants WHERE id = p_applicant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Applicant not found'; END IF;
  IF NOT public.user_can_manage_hr(v_app.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO applicant_interviews (
    organization_id, applicant_id, scheduled_at, duration_minutes,
    interviewer_employee_id, location_or_link, notes, created_by
  ) VALUES (
    v_app.organization_id, p_applicant_id, p_scheduled_at,
    GREATEST(15, COALESCE(p_duration_minutes, 60)),
    p_interviewer_employee_id, NULLIF(trim(COALESCE(p_location_or_link, '')), ''),
    NULLIF(trim(COALESCE(p_notes, '')), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  IF v_app.status = 'new' THEN
    UPDATE job_applicants SET status = 'interview' WHERE id = p_applicant_id;
  END IF;

  PERFORM public.hr_write_audit_log(v_app.organization_id, 'applicant_interview', v_id, 'schedule', NULL,
    jsonb_build_object('applicant_id', p_applicant_id));

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_interview_scorecard(
  p_interview_id UUID,
  p_status interview_status DEFAULT 'completed',
  p_scorecard JSONB DEFAULT '{}'::jsonb,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_iv applicant_interviews%ROWTYPE;
BEGIN
  SELECT * INTO v_iv FROM applicant_interviews WHERE id = p_interview_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Interview not found'; END IF;
  IF NOT public.user_can_manage_hr(v_iv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE applicant_interviews SET
    status = COALESCE(p_status, status),
    scorecard = COALESCE(p_scorecard, scorecard),
    notes = COALESCE(NULLIF(trim(p_notes), ''), notes)
  WHERE id = p_interview_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_job_offer(
  p_applicant_id UUID,
  p_salary NUMERIC,
  p_start_date DATE,
  p_employment_type employment_type DEFAULT 'full_time',
  p_offer_letter_url TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_status job_offer_status DEFAULT 'draft',
  p_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app job_applicants%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO v_app FROM job_applicants WHERE id = p_applicant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Applicant not found'; END IF;
  IF NOT public.user_can_manage_hr(v_app.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE job_offers SET
      salary = COALESCE(p_salary, salary),
      start_date = COALESCE(p_start_date, start_date),
      employment_type = COALESCE(p_employment_type, employment_type),
      offer_letter_url = COALESCE(NULLIF(trim(p_offer_letter_url), ''), offer_letter_url),
      notes = COALESCE(NULLIF(trim(p_notes), ''), notes),
      status = COALESCE(p_status, status),
      sent_at = CASE WHEN p_status = 'sent' AND sent_at IS NULL THEN now() ELSE sent_at END
    WHERE id = p_id AND applicant_id = p_applicant_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO job_offers (
      organization_id, applicant_id, salary, start_date, employment_type,
      offer_letter_url, notes, status, created_by,
      sent_at
    ) VALUES (
      v_app.organization_id, p_applicant_id, COALESCE(p_salary, 0), p_start_date,
      COALESCE(p_employment_type, 'full_time'),
      NULLIF(trim(COALESCE(p_offer_letter_url, '')), ''),
      NULLIF(trim(COALESCE(p_notes, '')), ''),
      COALESCE(p_status, 'draft'), auth.uid(),
      CASE WHEN p_status = 'sent' THEN now() ELSE NULL END
    )
    RETURNING id INTO v_id;
  END IF;

  IF p_status IN ('draft', 'sent') THEN
    UPDATE job_applicants SET status = 'offer' WHERE id = p_applicant_id AND status <> 'hired';
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hire_applicant(
  p_applicant_id UUID,
  p_base_salary NUMERIC DEFAULT NULL,
  p_hire_date DATE DEFAULT NULL,
  p_org_unit_id UUID DEFAULT NULL,
  p_send_erp_invite BOOLEAN DEFAULT true,
  p_invite_role member_role DEFAULT 'cashier',
  p_department_role_ids UUID[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app job_applicants%ROWTYPE;
  v_job job_positions%ROWTYPE;
  v_offer job_offers%ROWTYPE;
  v_emp_id UUID;
  v_invite_id UUID;
  v_template_id UUID;
  v_item JSONB;
  v_sort INT;
BEGIN
  SELECT * INTO v_app FROM job_applicants WHERE id = p_applicant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Applicant not found'; END IF;
  IF NOT public.user_can_manage_hr(v_app.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_app.status = 'hired' AND v_app.hired_employee_id IS NOT NULL THEN
    RETURN jsonb_build_object('employee_id', v_app.hired_employee_id, 'already_hired', true);
  END IF;

  SELECT * INTO v_job FROM job_positions WHERE id = v_app.position_id;
  SELECT * INTO v_offer FROM job_offers
  WHERE applicant_id = p_applicant_id AND status IN ('sent', 'accepted', 'draft')
  ORDER BY created_at DESC LIMIT 1;

  INSERT INTO employees (
    organization_id, name, position, email, phone, employment_type,
    base_salary, hire_date, status, org_unit_id, created_by
  ) VALUES (
    v_app.organization_id, v_app.full_name, v_job.title, v_app.email, v_app.phone,
    COALESCE(v_offer.employment_type, v_job.employment_type, 'full_time'),
    COALESCE(p_base_salary, v_offer.salary, 0),
    COALESCE(p_hire_date, v_offer.start_date, current_date),
    'active',
    COALESCE(p_org_unit_id, v_job.org_unit_id),
    auth.uid()
  )
  RETURNING id INTO v_emp_id;

  UPDATE job_applicants SET status = 'hired', hired_employee_id = v_emp_id WHERE id = p_applicant_id;

  IF p_send_erp_invite AND v_app.email IS NOT NULL AND trim(v_app.email) <> '' THEN
    INSERT INTO staff_invites (organization_id, email, role, department_role_ids, invited_by)
    VALUES (
      v_app.organization_id, lower(trim(v_app.email)),
      COALESCE(p_invite_role, 'cashier'),
      COALESCE(p_department_role_ids, '{}'::UUID[]),
      auth.uid()
    )
    ON CONFLICT (organization_id, email) DO UPDATE
    SET role = EXCLUDED.role,
        department_role_ids = EXCLUDED.department_role_ids,
        invited_by = EXCLUDED.invited_by,
        accepted_at = NULL
    RETURNING id INTO v_invite_id;
  END IF;

  v_template_id := public.ensure_default_onboarding_template(v_app.organization_id);
  v_sort := 0;
  FOR v_item IN
    SELECT elem.value
    FROM jsonb_array_elements(
      (SELECT items FROM onboarding_templates WHERE id = v_template_id)
    ) AS elem(value)
    ORDER BY (elem.value->>'sort_order')::INT NULLS LAST
  LOOP
    v_sort := v_sort + 1;
    INSERT INTO onboarding_tasks (
      organization_id, employee_id, template_id, title, category, sort_order, due_date
    ) VALUES (
      v_app.organization_id, v_emp_id, v_template_id,
      v_item->>'title', COALESCE(v_item->>'category', 'welcome'), v_sort,
      current_date + 7
    );
  END LOOP;

  PERFORM public.hr_write_audit_log(v_app.organization_id, 'job_applicant', p_applicant_id, 'hire', NULL,
    jsonb_build_object('employee_id', v_emp_id, 'invite_id', v_invite_id));

  RETURN jsonb_build_object(
    'employee_id', v_emp_id,
    'invite_id', v_invite_id,
    'onboarding_tasks', v_sort
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Onboarding tasks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_onboarding_tasks(
  p_org_id UUID,
  p_employee_id UUID DEFAULT NULL,
  p_status onboarding_task_status DEFAULT NULL,
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
  v_total BIGINT;
  v_items JSONB;
  v_my_emp UUID;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_my_emp := public.my_employee_id(p_org_id);

  SELECT COUNT(*) INTO v_total FROM onboarding_tasks ot
  JOIN employees e ON e.id = ot.employee_id
  WHERE ot.organization_id = p_org_id
    AND (p_employee_id IS NULL OR ot.employee_id = p_employee_id)
    AND (p_status IS NULL OR ot.status = p_status)
    AND (public.user_can_manage_hr(p_org_id) OR ot.employee_id = v_my_emp);

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.sort_order, x.created_at), '[]'::jsonb) INTO v_items
  FROM (
    SELECT ot.id, ot.employee_id, ot.title, ot.category, ot.status, ot.due_date,
      ot.completed_at, ot.sort_order, e.name AS employee_name
    FROM onboarding_tasks ot
    JOIN employees e ON e.id = ot.employee_id
    WHERE ot.organization_id = p_org_id
      AND (p_employee_id IS NULL OR ot.employee_id = p_employee_id)
      AND (p_status IS NULL OR ot.status = p_status)
      AND (public.user_can_manage_hr(p_org_id) OR ot.employee_id = v_my_emp)
    ORDER BY ot.sort_order, ot.created_at
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_onboarding_task(
  p_task_id UUID,
  p_status onboarding_task_status DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task onboarding_tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_task FROM onboarding_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;

  IF NOT public.user_can_manage_hr(v_task.organization_id)
     AND v_task.employee_id <> public.my_employee_id(v_task.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE onboarding_tasks SET
    status = COALESCE(p_status, status),
    completed_at = CASE
      WHEN COALESCE(p_status, status) = 'completed' THEN COALESCE(completed_at, now())
      WHEN p_status IS NOT NULL AND p_status <> 'completed' THEN NULL
      ELSE completed_at
    END
  WHERE id = p_task_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_job_requisitions(UUID, job_requisition_status, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_job_requisition(UUID, UUID, TEXT, TEXT, UUID, INT, employment_type, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_job_requisition(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_job_requisition(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_applicant_pipeline(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_applicant_interview(UUID, TIMESTAMPTZ, INT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_interview_scorecard(UUID, interview_status, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_job_offer(UUID, NUMERIC, DATE, employment_type, TEXT, TEXT, job_offer_status, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hire_applicant(UUID, NUMERIC, DATE, UUID, BOOLEAN, member_role, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_onboarding_tasks(UUID, UUID, onboarding_task_status, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_onboarding_task(UUID, onboarding_task_status, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_onboarding_template(UUID) TO authenticated;

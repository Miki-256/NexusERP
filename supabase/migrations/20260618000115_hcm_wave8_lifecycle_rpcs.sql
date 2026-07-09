-- HCM Wave 8: lifecycle automation RPCs and notifications.

-- ---------------------------------------------------------------------------
-- Offboarding
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_offboarding_template(p_org_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM offboarding_templates
  WHERE organization_id = p_org_id AND is_default = true LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO offboarding_templates (organization_id, name, is_default, items)
  VALUES (
    p_org_id, 'Standard offboarding', true,
    '[
      {"title": "Schedule exit interview", "category": "hr", "sort_order": 1},
      {"title": "Collect company assets", "category": "assets", "sort_order": 2},
      {"title": "Revoke system access", "category": "it", "sort_order": 3},
      {"title": "Final payroll & benefits", "category": "payroll", "sort_order": 4},
      {"title": "Issue experience letter", "category": "hr", "sort_order": 5}
    ]'::jsonb
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_employee_offboarding(
  p_employee_id UUID,
  p_last_working_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_template_id UUID;
  v_item JSONB;
  v_sort INT := 0;
  v_last DATE;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF NOT public.user_can_manage_hr(v_emp.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  v_last := COALESCE(p_last_working_date, current_date + 14);

  INSERT INTO employee_profiles (employee_id, organization_id, termination_date)
  VALUES (p_employee_id, v_emp.organization_id, v_last)
  ON CONFLICT (employee_id) DO UPDATE SET termination_date = EXCLUDED.termination_date;

  v_template_id := public.ensure_default_offboarding_template(v_emp.organization_id);

  FOR v_item IN
    SELECT elem.value FROM jsonb_array_elements(
      (SELECT items FROM offboarding_templates WHERE id = v_template_id)
    ) AS elem(value)
    ORDER BY (elem.value->>'sort_order')::INT NULLS LAST
  LOOP
    v_sort := v_sort + 1;
    INSERT INTO offboarding_tasks (
      organization_id, employee_id, template_id, title, category, sort_order, due_date
    ) VALUES (
      v_emp.organization_id, p_employee_id, v_template_id,
      v_item->>'title', COALESCE(v_item->>'category', 'exit'), v_sort, v_last
    );
  END LOOP;

  PERFORM public.hr_write_audit_log(
    v_emp.organization_id, 'employee', p_employee_id, 'offboarding_started', NULL,
    jsonb_build_object('last_working_date', v_last, 'tasks', v_sort, 'notes', p_notes)
  );

  PERFORM public.enqueue_notification_event(
    v_emp.organization_id, 'hr.offboarding_started', 'employee', p_employee_id,
    jsonb_build_object('employee_name', v_emp.name, 'last_working_date', v_last),
    'offboarding:' || p_employee_id::text
  );

  RETURN jsonb_build_object('employee_id', p_employee_id, 'tasks_created', v_sort, 'last_working_date', v_last);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_offboarding_tasks(
  p_org_id UUID, p_employee_id UUID DEFAULT NULL,
  p_status onboarding_task_status DEFAULT NULL,
  p_limit INT DEFAULT 50, p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_total INT; v_items JSONB;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COUNT(*) INTO v_total FROM offboarding_tasks ot
  JOIN employees e ON e.id = ot.employee_id
  WHERE ot.organization_id = p_org_id
    AND (p_employee_id IS NULL OR ot.employee_id = p_employee_id)
    AND (p_status IS NULL OR ot.status = p_status)
    AND (
      public.user_can_manage_hr(p_org_id)
      OR ot.employee_id = public.my_employee_id(p_org_id)
    );

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT ot.id, ot.employee_id, e.name AS employee_name, ot.title, ot.category,
      ot.status::text AS status, ot.due_date, ot.completed_at, ot.sort_order
    FROM offboarding_tasks ot
    JOIN employees e ON e.id = ot.employee_id
    WHERE ot.organization_id = p_org_id
      AND (p_employee_id IS NULL OR ot.employee_id = p_employee_id)
      AND (p_status IS NULL OR ot.status = p_status)
      AND (
        public.user_can_manage_hr(p_org_id)
        OR ot.employee_id = public.my_employee_id(p_org_id)
      )
    ORDER BY ot.due_date NULLS LAST, ot.sort_order
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_offboarding_task(
  p_task_id UUID,
  p_status onboarding_task_status DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_task offboarding_tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_task FROM offboarding_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF NOT public.user_can_manage_hr(v_task.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE offboarding_tasks SET
    status = COALESCE(p_status, status),
    completed_at = CASE WHEN COALESCE(p_status, status) = 'completed' THEN now() ELSE completed_at END
  WHERE id = p_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_employee_offboarding(p_employee_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_emp employees%ROWTYPE;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF NOT public.user_can_manage_hr(v_emp.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE employees SET status = 'terminated', updated_at = now() WHERE id = p_employee_id;
  UPDATE offboarding_tasks SET status = 'completed', completed_at = now()
  WHERE employee_id = p_employee_id AND status NOT IN ('completed', 'skipped');

  PERFORM public.hr_write_audit_log(
    v_emp.organization_id, 'employee', p_employee_id, 'offboarding_finalized', NULL,
    jsonb_build_object('status', 'terminated')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_offboarding_tasks(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_emp_id UUID;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_emp_id := public.my_employee_id(p_org_id);
  IF v_emp_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.sort_order)
    FROM (
      SELECT id, title, category, status::text AS status, due_date, completed_at, sort_order
      FROM offboarding_tasks
      WHERE organization_id = p_org_id AND employee_id = v_emp_id
        AND status NOT IN ('completed', 'skipped')
    ) x
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Probation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_probation_review(
  p_employee_id UUID, p_probation_end_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_emp employees%ROWTYPE; v_id UUID; v_reviewer UUID;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF NOT public.user_can_manage_hr(v_emp.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO employee_profiles (employee_id, organization_id, probation_end_date)
  VALUES (p_employee_id, v_emp.organization_id, p_probation_end_date)
  ON CONFLICT (employee_id) DO UPDATE SET probation_end_date = EXCLUDED.probation_end_date;

  v_reviewer := v_emp.manager_employee_id;

  SELECT id INTO v_id FROM probation_reviews
  WHERE employee_id = p_employee_id AND status = 'pending'
  ORDER BY created_at DESC LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE probation_reviews SET probation_end_date = p_probation_end_date, updated_at = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO probation_reviews (
    organization_id, employee_id, probation_end_date, reviewer_employee_id, status
  ) VALUES (
    v_emp.organization_id, p_employee_id, p_probation_end_date, v_reviewer, 'pending'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_probation_reviews(
  p_org_id UUID, p_status TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25, p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_total INT; v_items JSONB;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COUNT(*) INTO v_total FROM probation_reviews pr
  WHERE pr.organization_id = p_org_id
    AND (p_status IS NULL OR pr.status::text = p_status)
    AND (
      public.user_can_manage_hr(p_org_id)
      OR pr.employee_id = public.my_employee_id(p_org_id)
      OR pr.reviewer_employee_id = public.my_employee_id(p_org_id)
    );

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT pr.id, pr.employee_id, e.name AS employee_name, pr.probation_end_date,
      pr.status::text AS status, pr.outcome_notes, pr.extended_until,
      pr.reviewer_employee_id, rev.name AS reviewer_name, pr.completed_at
    FROM probation_reviews pr
    JOIN employees e ON e.id = pr.employee_id
    LEFT JOIN employees rev ON rev.id = pr.reviewer_employee_id
    WHERE pr.organization_id = p_org_id
      AND (p_status IS NULL OR pr.status::text = p_status)
      AND (
        public.user_can_manage_hr(p_org_id)
        OR pr.employee_id = public.my_employee_id(p_org_id)
        OR pr.reviewer_employee_id = public.my_employee_id(p_org_id)
      )
    ORDER BY pr.probation_end_date ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_probation_review(
  p_review_id UUID,
  p_outcome probation_review_status,
  p_notes TEXT DEFAULT NULL,
  p_extended_until DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_review probation_reviews%ROWTYPE;
BEGIN
  SELECT * INTO v_review FROM probation_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;

  IF NOT public.user_can_manage_hr(v_review.organization_id)
     AND v_review.reviewer_employee_id <> public.my_employee_id(v_review.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_outcome NOT IN ('passed', 'extended', 'failed') THEN
    RAISE EXCEPTION 'Invalid outcome';
  END IF;

  UPDATE probation_reviews SET
    status = p_outcome,
    outcome_notes = NULLIF(trim(p_notes), ''),
    extended_until = p_extended_until,
    completed_at = now(),
    updated_at = now()
  WHERE id = p_review_id;

  IF p_outcome = 'extended' AND p_extended_until IS NOT NULL THEN
    UPDATE employee_profiles SET probation_end_date = p_extended_until
    WHERE employee_id = v_review.employee_id;
    PERFORM public.schedule_probation_review(v_review.employee_id, p_extended_until);
  ELSIF p_outcome = 'failed' THEN
    UPDATE employees SET status = 'terminated' WHERE id = v_review.employee_id;
    UPDATE employee_profiles SET termination_date = COALESCE(termination_date, current_date)
    WHERE employee_id = v_review.employee_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Contracts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_employment_contract(
  p_org_id UUID, p_employee_id UUID, p_title TEXT DEFAULT 'Employment contract',
  p_start_date DATE DEFAULT NULL, p_end_date DATE DEFAULT NULL, p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = p_employee_id AND e.organization_id = p_org_id) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  INSERT INTO employment_contracts (
    organization_id, employee_id, contract_title, start_date, end_date, status, notes, created_by
  ) VALUES (
    p_org_id, p_employee_id, COALESCE(NULLIF(trim(p_title), ''), 'Employment contract'),
    COALESCE(p_start_date, current_date), p_end_date,
    CASE WHEN p_end_date IS NOT NULL AND p_end_date <= current_date + 30 THEN 'expiring_soon'::employment_contract_status ELSE 'active'::employment_contract_status END,
    NULLIF(trim(p_notes), ''), auth.uid()
  ) RETURNING id INTO v_id;

  IF p_end_date IS NOT NULL THEN
    UPDATE employees SET employment_type = 'contract' WHERE id = p_employee_id AND employment_type <> 'contract';
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_employment_contract(
  p_contract_id UUID, p_new_end_date DATE, p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old employment_contracts%ROWTYPE; v_new_id UUID;
BEGIN
  SELECT * INTO v_old FROM employment_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF NOT public.user_can_manage_hr(v_old.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE employment_contracts SET status = 'renewed', updated_at = now() WHERE id = p_contract_id;

  INSERT INTO employment_contracts (
    organization_id, employee_id, contract_title, start_date, end_date, status,
    renewed_from_id, notes, created_by
  ) VALUES (
    v_old.organization_id, v_old.employee_id, v_old.contract_title,
    COALESCE(v_old.end_date, current_date) + 1, p_new_end_date, 'active',
    p_contract_id, NULLIF(trim(p_notes), ''), auth.uid()
  ) RETURNING id INTO v_new_id;

  PERFORM public.hr_write_audit_log(
    v_old.organization_id, 'employment_contract', v_new_id, 'renewed',
    jsonb_build_object('from_contract_id', p_contract_id),
    jsonb_build_object('new_end_date', p_new_end_date)
  );

  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_employment_contracts(
  p_org_id UUID, p_employee_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 25, p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_total INT; v_items JSONB;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COUNT(*) INTO v_total FROM employment_contracts ec
  WHERE ec.organization_id = p_org_id
    AND (p_employee_id IS NULL OR ec.employee_id = p_employee_id)
    AND (
      public.user_can_manage_hr(p_org_id)
      OR ec.employee_id = public.my_employee_id(p_org_id)
    );

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT ec.id, ec.employee_id, e.name AS employee_name, ec.contract_title,
      ec.start_date, ec.end_date, ec.status::text AS status, ec.notes, ec.created_at
    FROM employment_contracts ec
    JOIN employees e ON e.id = ec.employee_id
    WHERE ec.organization_id = p_org_id
      AND (p_employee_id IS NULL OR ec.employee_id = p_employee_id)
      AND ec.status IN ('active', 'expiring_soon')
      AND (
        public.user_can_manage_hr(p_org_id)
        OR ec.employee_id = public.my_employee_id(p_org_id)
      )
    ORDER BY ec.end_date NULLS LAST, e.name
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_contracts_due_for_renewal(p_org_id UUID, p_days_ahead INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_horizon DATE := current_date + GREATEST(1, LEAST(COALESCE(p_days_ahead, 30), 365));
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.end_date)
    FROM (
      SELECT ec.id, ec.employee_id, e.name AS employee_name, ec.contract_title,
        ec.end_date, (ec.end_date - current_date) AS days_remaining, ec.status::text AS status
      FROM employment_contracts ec
      JOIN employees e ON e.id = ec.employee_id
      WHERE ec.organization_id = p_org_id
        AND ec.status IN ('active', 'expiring_soon')
        AND ec.end_date IS NOT NULL
        AND ec.end_date <= v_horizon
        AND ec.end_date >= current_date
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_lifecycle_alerts(p_org_id UUID, p_days_ahead INT DEFAULT 14)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INT := 0; v_row RECORD; v_key TEXT;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  FOR v_row IN
    SELECT pr.id, pr.employee_id, e.name AS employee_name, pr.probation_end_date
    FROM probation_reviews pr
    JOIN employees e ON e.id = pr.employee_id
    WHERE pr.organization_id = p_org_id AND pr.status = 'pending'
      AND pr.probation_end_date <= current_date + p_days_ahead
      AND pr.probation_end_date >= current_date
  LOOP
    v_key := 'probation:' || v_row.id::text || ':' || v_row.probation_end_date::text;
    IF NOT EXISTS (SELECT 1 FROM compliance_alert_log WHERE organization_id = p_org_id AND alert_key = v_key) THEN
      PERFORM public.enqueue_notification_event(
        p_org_id, 'hr.probation_due', 'probation_review', v_row.id,
        jsonb_build_object('employee_name', v_row.employee_name, 'due_date', v_row.probation_end_date),
        v_key
      );
      INSERT INTO compliance_alert_log (organization_id, alert_type, entity_type, entity_id, alert_key)
      VALUES (p_org_id, 'probation_due', 'probation_review', v_row.id, v_key);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT ec.id, ec.employee_id, e.name AS employee_name, ec.end_date, ec.contract_title
    FROM employment_contracts ec
    JOIN employees e ON e.id = ec.employee_id
    WHERE ec.organization_id = p_org_id AND ec.status IN ('active', 'expiring_soon')
      AND ec.end_date IS NOT NULL
      AND ec.end_date <= current_date + p_days_ahead
      AND ec.end_date >= current_date
  LOOP
    v_key := 'contract:' || v_row.id::text || ':' || v_row.end_date::text;
    IF NOT EXISTS (SELECT 1 FROM compliance_alert_log WHERE organization_id = p_org_id AND alert_key = v_key) THEN
      PERFORM public.enqueue_notification_event(
        p_org_id, 'hr.contract_expiring', 'employment_contract', v_row.id,
        jsonb_build_object('employee_name', v_row.employee_name, 'contract_title', v_row.contract_title, 'end_date', v_row.end_date),
        v_key
      );
      INSERT INTO compliance_alert_log (organization_id, alert_type, entity_type, entity_id, alert_key)
      VALUES (p_org_id, 'contract_expiring', 'employment_contract', v_row.id, v_key);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'hr.offboarding_started.manager', 'in_app', 'Offboarding started (in-app)',
  'Offboarding started',
  'Offboarding checklist created for {{employee_name}}. Last day: {{last_working_date}}.',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'hr.offboarding_started.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'hr.probation_due.manager', 'in_app', 'Probation review due (in-app)',
  'Probation review due',
  'Probation review due for {{employee_name}} on {{due_date}}.',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'hr.probation_due.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'hr.contract_expiring.manager', 'in_app', 'Contract expiring (in-app)',
  'Contract renewal',
  '{{contract_title}} for {{employee_name}} ends {{end_date}}.',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'hr.contract_expiring.manager' AND channel = 'in_app'
);

CREATE OR REPLACE FUNCTION public._notification_rule_driven_event(p_event_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_event_type IN (
    'pos.sale_completed', 'inventory.low_stock', 'inventory.out_of_stock', 'inventory.stock_adjustment',
    'reports.daily_sales', 'accounting.payment_received', 'accounting.journal_posted',
    'crm.customer_created', 'crm.complaint_logged', 'security.login_failed', 'system.queue_backlog',
    'hr.leave_requested', 'hr.leave_reviewed', 'hr.payroll_completed',
    'hr.document_expiring', 'hr.policy_pending',
    'hr.offboarding_started', 'hr.probation_due', 'hr.contract_expiring'
  );
$$;

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
    ARRAY['in_app']::notification_channel[], '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.leave_requested.manager"}'::jsonb, 170, true
  WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE organization_id = p_org_id AND event_type = 'hr.leave_requested');

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Leave reviewed — in-app', 'hr.leave_reviewed', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[], '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.leave_reviewed.employee"}'::jsonb, 171, true
  WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE organization_id = p_org_id AND event_type = 'hr.leave_reviewed');

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Payroll completed — in-app', 'hr.payroll_completed', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[], '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.payroll_completed.manager"}'::jsonb, 172, true
  WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE organization_id = p_org_id AND event_type = 'hr.payroll_completed');

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Document expiring — HR in-app', 'hr.document_expiring', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[], '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.document_expiring.manager"}'::jsonb, 173, true
  WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE organization_id = p_org_id AND event_type = 'hr.document_expiring');

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Policy pending — employee in-app', 'hr.policy_pending', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[], '{"employee_linked":true}'::jsonb,
    '{"in_app":"hr.policy_pending.employee"}'::jsonb, 174, true
  WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE organization_id = p_org_id AND event_type = 'hr.policy_pending');

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Offboarding started — HR in-app', 'hr.offboarding_started', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[], '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.offboarding_started.manager"}'::jsonb, 175, true
  WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE organization_id = p_org_id AND event_type = 'hr.offboarding_started');

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Probation due — HR in-app', 'hr.probation_due', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[], '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.probation_due.manager"}'::jsonb, 176, true
  WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE organization_id = p_org_id AND event_type = 'hr.probation_due');

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Contract expiring — HR in-app', 'hr.contract_expiring', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[], '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.contract_expiring.manager"}'::jsonb, 177, true
  WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE organization_id = p_org_id AND event_type = 'hr.contract_expiring');
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_offboarding_template(v_org);
    PERFORM public.ensure_hr_notification_rules(v_org);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_employee_offboarding(UUID, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_offboarding_tasks(UUID, UUID, onboarding_task_status, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_offboarding_task(UUID, onboarding_task_status, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_employee_offboarding(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_offboarding_tasks(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_probation_review(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_probation_reviews(UUID, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_probation_review(UUID, probation_review_status, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_employment_contract(UUID, UUID, TEXT, DATE, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renew_employment_contract(UUID, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_employment_contracts(UUID, UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_contracts_due_for_renewal(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_lifecycle_alerts(UUID, INT) TO authenticated;

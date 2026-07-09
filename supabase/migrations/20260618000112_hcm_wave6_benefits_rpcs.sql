-- HCM Wave 6: benefits & compliance RPCs, notifications, expiry scanning.

-- ---------------------------------------------------------------------------
-- Defaults
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_benefit_plans(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO benefit_plans (organization_id, code, name, plan_type, description, employer_contribution_pct, employee_cost_monthly)
  SELECT p_org_id, 'health_basic', 'Basic health insurance', 'health', 'Standard medical coverage', 80, 0
  WHERE NOT EXISTS (SELECT 1 FROM benefit_plans WHERE organization_id = p_org_id AND code = 'health_basic');

  INSERT INTO benefit_plans (organization_id, code, name, plan_type, description, employer_contribution_pct, employee_cost_monthly)
  SELECT p_org_id, 'pension', 'Retirement pension', 'retirement', 'Employer-matched pension plan', 5, 0
  WHERE NOT EXISTS (SELECT 1 FROM benefit_plans WHERE organization_id = p_org_id AND code = 'pension');

  INSERT INTO benefit_plans (organization_id, code, name, plan_type, description, employer_contribution_pct, employee_cost_monthly)
  SELECT p_org_id, 'life', 'Group life insurance', 'life', 'Basic life cover', 100, 0
  WHERE NOT EXISTS (SELECT 1 FROM benefit_plans WHERE organization_id = p_org_id AND code = 'life');
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_default_hr_policies(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO hr_policies (organization_id, code, name, version, summary, requires_acknowledgement, effective_date)
  SELECT p_org_id, 'code_of_conduct', 'Code of conduct', 1,
    'Standards of professional behavior and workplace ethics.', true, current_date
  WHERE NOT EXISTS (SELECT 1 FROM hr_policies WHERE organization_id = p_org_id AND code = 'code_of_conduct');

  INSERT INTO hr_policies (organization_id, code, name, version, summary, requires_acknowledgement, effective_date)
  SELECT p_org_id, 'data_privacy', 'Data privacy policy', 1,
    'Handling of customer and employee personal data.', true, current_date
  WHERE NOT EXISTS (SELECT 1 FROM hr_policies WHERE organization_id = p_org_id AND code = 'data_privacy');

  INSERT INTO hr_policies (organization_id, code, name, version, summary, requires_acknowledgement, effective_date)
  SELECT p_org_id, 'health_safety', 'Health & safety policy', 1,
    'Workplace safety procedures and incident reporting.', true, current_date
  WHERE NOT EXISTS (SELECT 1 FROM hr_policies WHERE organization_id = p_org_id AND code = 'health_safety');
END;
$$;

-- ---------------------------------------------------------------------------
-- Benefit plans
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_benefit_plans(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(p) ORDER BY p.plan_type, p.name)
    FROM (
      SELECT id, code, name, plan_type::text AS plan_type, description,
        employer_contribution_pct, employee_cost_monthly, is_active
      FROM benefit_plans WHERE organization_id = p_org_id AND is_active = true
    ) p
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_benefit_plan(
  p_org_id UUID, p_code TEXT, p_name TEXT, p_plan_type benefit_plan_type DEFAULT 'other',
  p_description TEXT DEFAULT NULL, p_employer_pct NUMERIC DEFAULT 0,
  p_employee_cost NUMERIC DEFAULT 0, p_plan_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_plan_id IS NOT NULL THEN
    UPDATE benefit_plans SET
      name = trim(p_name), plan_type = p_plan_type, description = NULLIF(trim(p_description), ''),
      employer_contribution_pct = COALESCE(p_employer_pct, 0),
      employee_cost_monthly = COALESCE(p_employee_cost, 0), is_active = true
    WHERE id = p_plan_id AND organization_id = p_org_id RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  INSERT INTO benefit_plans (
    organization_id, code, name, plan_type, description, employer_contribution_pct, employee_cost_monthly
  ) VALUES (
    p_org_id, lower(trim(p_code)), trim(p_name), p_plan_type, NULLIF(trim(p_description), ''),
    COALESCE(p_employer_pct, 0), COALESCE(p_employee_cost, 0)
  )
  ON CONFLICT (organization_id, code) DO UPDATE SET
    name = EXCLUDED.name, plan_type = EXCLUDED.plan_type, description = EXCLUDED.description,
    employer_contribution_pct = EXCLUDED.employer_contribution_pct,
    employee_cost_monthly = EXCLUDED.employee_cost_monthly, is_active = true
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_benefit_enrollments(
  p_org_id UUID, p_employee_id UUID DEFAULT NULL, p_status TEXT DEFAULT NULL,
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

  SELECT COUNT(*) INTO v_total
  FROM benefit_enrollments be
  JOIN employees e ON e.id = be.employee_id
  WHERE be.organization_id = p_org_id
    AND (p_employee_id IS NULL OR be.employee_id = p_employee_id)
    AND (p_status IS NULL OR be.status::text = p_status)
    AND (
      public.user_can_manage_hr(p_org_id)
      OR be.employee_id = public.my_employee_id(p_org_id)
      OR e.manager_employee_id = public.my_employee_id(p_org_id)
    );

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT be.id, be.employee_id, e.name AS employee_name, be.plan_id, bp.code AS plan_code,
      bp.name AS plan_name, bp.plan_type::text AS plan_type, be.status::text AS status,
      be.coverage_level, be.effective_date, be.end_date, be.notes
    FROM benefit_enrollments be
    JOIN employees e ON e.id = be.employee_id
    JOIN benefit_plans bp ON bp.id = be.plan_id
    WHERE be.organization_id = p_org_id
      AND (p_employee_id IS NULL OR be.employee_id = p_employee_id)
      AND (p_status IS NULL OR be.status::text = p_status)
      AND (
        public.user_can_manage_hr(p_org_id)
        OR be.employee_id = public.my_employee_id(p_org_id)
        OR e.manager_employee_id = public.my_employee_id(p_org_id)
      )
    ORDER BY be.effective_date DESC, e.name
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.enroll_employee_benefit(
  p_org_id UUID, p_employee_id UUID, p_plan_id UUID,
  p_coverage_level TEXT DEFAULT NULL, p_effective_date DATE DEFAULT NULL,
  p_status benefit_enrollment_status DEFAULT 'active'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO benefit_enrollments (
    organization_id, employee_id, plan_id, status, coverage_level, effective_date, created_by
  ) VALUES (
    p_org_id, p_employee_id, p_plan_id, COALESCE(p_status, 'active'),
    NULLIF(trim(p_coverage_level), ''), COALESCE(p_effective_date, current_date), auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM public.hr_write_audit_log(
    p_org_id, 'benefit_enrollment', v_id, 'create',
    NULL, jsonb_build_object('employee_id', p_employee_id, 'plan_id', p_plan_id)
  );
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_benefit_enrollment(
  p_enrollment_id UUID, p_status benefit_enrollment_status, p_end_date DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_enr benefit_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO v_enr FROM benefit_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment not found'; END IF;
  IF NOT public.user_can_manage_hr(v_enr.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE benefit_enrollments SET status = p_status, end_date = p_end_date, updated_at = now()
  WHERE id = p_enrollment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_benefits(p_org_id UUID)
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
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.plan_name)
    FROM (
      SELECT be.id, bp.name AS plan_name, bp.plan_type::text AS plan_type, be.status::text AS status,
        be.coverage_level, be.effective_date, be.end_date, bp.employee_cost_monthly
      FROM benefit_enrollments be
      JOIN benefit_plans bp ON bp.id = be.plan_id
      WHERE be.organization_id = p_org_id AND be.employee_id = v_emp_id
        AND be.status IN ('pending', 'active')
    ) x
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_hr_policies(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(p) ORDER BY p.name, p.version DESC)
    FROM (
      SELECT id, code, name, version, summary, content_url, requires_acknowledgement,
        effective_date, is_active
      FROM hr_policies WHERE organization_id = p_org_id AND is_active = true
    ) p
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_hr_policy(
  p_org_id UUID, p_code TEXT, p_name TEXT, p_summary TEXT DEFAULT NULL,
  p_content_url TEXT DEFAULT NULL, p_requires_ack BOOLEAN DEFAULT true, p_policy_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID; v_version INT;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_policy_id IS NOT NULL THEN
    UPDATE hr_policies SET
      name = trim(p_name), summary = NULLIF(trim(p_summary), ''),
      content_url = NULLIF(trim(p_content_url), ''),
      requires_acknowledgement = COALESCE(p_requires_ack, requires_acknowledgement), is_active = true
    WHERE id = p_policy_id AND organization_id = p_org_id RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
  FROM hr_policies WHERE organization_id = p_org_id AND code = lower(trim(p_code));

  INSERT INTO hr_policies (
    organization_id, code, name, version, summary, content_url, requires_acknowledgement, effective_date
  ) VALUES (
    p_org_id, lower(trim(p_code)), trim(p_name), v_version,
    NULLIF(trim(p_summary), ''), NULLIF(trim(p_content_url), ''), COALESCE(p_requires_ack, true), current_date
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_pending_policies(p_org_id UUID, p_employee_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_emp_id UUID;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_emp_id := COALESCE(p_employee_id, public.my_employee_id(p_org_id));
  IF v_emp_id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF p_employee_id IS NOT NULL AND NOT public.user_can_view_employee(p_employee_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.name)
    FROM (
      SELECT hp.id, hp.code, hp.name, hp.version, hp.summary, hp.content_url, hp.effective_date
      FROM hr_policies hp
      WHERE hp.organization_id = p_org_id AND hp.is_active = true AND hp.requires_acknowledgement = true
        AND NOT EXISTS (
          SELECT 1 FROM policy_acknowledgements pa
          WHERE pa.policy_id = hp.id AND pa.employee_id = v_emp_id AND pa.policy_version = hp.version
        )
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_hr_policy(p_policy_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_policy hr_policies%ROWTYPE; v_emp_id UUID; v_id UUID;
BEGIN
  SELECT * INTO v_policy FROM hr_policies WHERE id = p_policy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Policy not found'; END IF;
  v_emp_id := public.my_employee_id(v_policy.organization_id);
  IF v_emp_id IS NULL AND NOT public.user_can_manage_hr(v_policy.organization_id) THEN
    RAISE EXCEPTION 'No linked employee profile';
  END IF;
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'HR must acknowledge via employee profile'; END IF;

  INSERT INTO policy_acknowledgements (organization_id, policy_id, employee_id, policy_version)
  VALUES (v_policy.organization_id, p_policy_id, v_emp_id, v_policy.version)
  ON CONFLICT (policy_id, employee_id, policy_version) DO UPDATE SET acknowledged_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_policy_acknowledgements(
  p_org_id UUID, p_policy_id UUID DEFAULT NULL, p_limit INT DEFAULT 25, p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_total INT; v_items JSONB;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COUNT(*) INTO v_total
  FROM policy_acknowledgements pa
  WHERE pa.organization_id = p_org_id
    AND (p_policy_id IS NULL OR pa.policy_id = p_policy_id);

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT pa.id, pa.policy_id, hp.name AS policy_name, pa.policy_version,
      pa.employee_id, e.name AS employee_name, pa.acknowledged_at
    FROM policy_acknowledgements pa
    JOIN hr_policies hp ON hp.id = pa.policy_id
    JOIN employees e ON e.id = pa.employee_id
    WHERE pa.organization_id = p_org_id
      AND (p_policy_id IS NULL OR pa.policy_id = p_policy_id)
    ORDER BY pa.acknowledged_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

-- ---------------------------------------------------------------------------
-- Compliance / expiry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_expiring_compliance_items(
  p_org_id UUID, p_days_ahead INT DEFAULT 30
)
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
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.expires_on, x.employee_name)
    FROM (
      SELECT ed.id AS entity_id, 'employee_document'::text AS entity_type, ed.employee_id,
        e.name AS employee_name, ed.name AS item_name, ed.document_type AS item_category,
        ed.expires_at AS expires_on,
        (ed.expires_at - current_date) AS days_remaining
      FROM employee_documents ed
      JOIN employees e ON e.id = ed.employee_id
      WHERE ed.organization_id = p_org_id AND ed.expires_at IS NOT NULL
        AND ed.expires_at <= v_horizon AND ed.expires_at >= current_date - 7

      UNION ALL

      SELECT e.id, 'passport'::text, e.id, e.name, 'Passport', 'identity',
        ep.passport_expiry, (ep.passport_expiry - current_date)
      FROM employees e
      JOIN employee_profiles ep ON ep.employee_id = e.id
      WHERE e.organization_id = p_org_id AND ep.passport_expiry IS NOT NULL
        AND ep.passport_expiry <= v_horizon AND ep.passport_expiry >= current_date - 7

      UNION ALL

      SELECT e.id, 'visa'::text, e.id, e.name, 'Work visa', 'identity',
        ep.visa_expiry, (ep.visa_expiry - current_date)
      FROM employees e
      JOIN employee_profiles ep ON ep.employee_id = e.id
      WHERE e.organization_id = p_org_id AND ep.visa_expiry IS NOT NULL
        AND ep.visa_expiry <= v_horizon AND ep.visa_expiry >= current_date - 7

      UNION ALL

      SELECT e.id, 'driving_license'::text, e.id, e.name, 'Driving license', 'identity',
        ep.driving_license_expiry, (ep.driving_license_expiry - current_date)
      FROM employees e
      JOIN employee_profiles ep ON ep.employee_id = e.id
      WHERE e.organization_id = p_org_id AND ep.driving_license_expiry IS NOT NULL
        AND ep.driving_license_expiry <= v_horizon AND ep.driving_license_expiry >= current_date - 7
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_hr_compliance_alerts(p_org_id UUID, p_days_ahead INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_item JSONB; v_count INT := 0; v_key TEXT;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(public.list_expiring_compliance_items(p_org_id, p_days_ahead)) LOOP
    v_key := 'doc_expiry:' || (v_item->>'entity_type') || ':' || (v_item->>'entity_id') || ':' || (v_item->>'expires_on');
    IF EXISTS (SELECT 1 FROM compliance_alert_log WHERE organization_id = p_org_id AND alert_key = v_key) THEN
      CONTINUE;
    END IF;

    PERFORM public.enqueue_notification_event(
      p_org_id,
      'hr.document_expiring',
      v_item->>'entity_type',
      (v_item->>'entity_id')::uuid,
      jsonb_build_object(
        'employee_name', v_item->>'employee_name',
        'item_name', v_item->>'item_name',
        'expires_on', v_item->>'expires_on',
        'days_remaining', v_item->>'days_remaining'
      ),
      v_key
    );

    INSERT INTO compliance_alert_log (organization_id, alert_type, entity_type, entity_id, alert_key)
    VALUES (
      p_org_id, 'document_expiring', v_item->>'entity_type',
      (v_item->>'entity_id')::uuid, v_key
    );
    v_count := v_count + 1;
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
SELECT NULL, 'hr.document_expiring.manager', 'in_app', 'Document expiring (in-app)',
  'Compliance alert',
  '{{item_name}} for {{employee_name}} expires {{expires_on}} ({{days_remaining}} days).',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'hr.document_expiring.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'hr.policy_pending.employee', 'in_app', 'Policy acknowledgement (in-app)',
  'Policy acknowledgement required',
  'Please acknowledge: {{policy_name}} (v{{policy_version}}).',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'hr.policy_pending.employee' AND channel = 'in_app'
);

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
    'hr.payroll_completed',
    'hr.document_expiring',
    'hr.policy_pending'
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

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Document expiring — HR in-app', 'hr.document_expiring', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"hr.document_expiring.manager"}'::jsonb,
    173, true
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND event_type = 'hr.document_expiring'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Policy pending — employee in-app', 'hr.policy_pending', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"employee_linked":true}'::jsonb,
    '{"in_app":"hr.policy_pending.employee"}'::jsonb,
    174, true
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND event_type = 'hr.policy_pending'
  );
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_benefit_plans(v_org);
    PERFORM public.ensure_default_hr_policies(v_org);
    PERFORM public.ensure_hr_notification_rules(v_org);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_benefit_plans(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_benefit_plan(UUID, TEXT, TEXT, benefit_plan_type, TEXT, NUMERIC, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_benefit_enrollments(UUID, UUID, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_employee_benefit(UUID, UUID, UUID, TEXT, DATE, benefit_enrollment_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_benefit_enrollment(UUID, benefit_enrollment_status, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_benefits(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_hr_policies(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_hr_policy(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_policies(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_hr_policy(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_policy_acknowledgements(UUID, UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_expiring_compliance_items(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_hr_compliance_alerts(UUID, INT) TO authenticated;

-- HCM Wave 5: performance & learning RPCs.

-- ---------------------------------------------------------------------------
-- Defaults
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_skills(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO skills (organization_id, code, name, category)
  SELECT p_org_id, 'communication', 'Communication', 'soft'
  WHERE NOT EXISTS (SELECT 1 FROM skills WHERE organization_id = p_org_id AND code = 'communication');

  INSERT INTO skills (organization_id, code, name, category)
  SELECT p_org_id, 'leadership', 'Leadership', 'soft'
  WHERE NOT EXISTS (SELECT 1 FROM skills WHERE organization_id = p_org_id AND code = 'leadership');

  INSERT INTO skills (organization_id, code, name, category)
  SELECT p_org_id, 'excel', 'Microsoft Excel', 'technical'
  WHERE NOT EXISTS (SELECT 1 FROM skills WHERE organization_id = p_org_id AND code = 'excel');

  INSERT INTO skills (organization_id, code, name, category)
  SELECT p_org_id, 'customer_service', 'Customer service', 'functional'
  WHERE NOT EXISTS (SELECT 1 FROM skills WHERE organization_id = p_org_id AND code = 'customer_service');
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_default_training_courses(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO training_courses (organization_id, code, name, provider, duration_hours, is_mandatory)
  SELECT p_org_id, 'onboarding', 'New hire onboarding', 'Internal', 8, true
  WHERE NOT EXISTS (SELECT 1 FROM training_courses WHERE organization_id = p_org_id AND code = 'onboarding');

  INSERT INTO training_courses (organization_id, code, name, provider, duration_hours)
  SELECT p_org_id, 'safety', 'Workplace safety', 'Internal', 4
  WHERE NOT EXISTS (SELECT 1 FROM training_courses WHERE organization_id = p_org_id AND code = 'safety');

  INSERT INTO training_courses (organization_id, code, name, provider, duration_hours)
  SELECT p_org_id, 'pos_basics', 'POS basics', 'Internal', 2
  WHERE NOT EXISTS (SELECT 1 FROM training_courses WHERE organization_id = p_org_id AND code = 'pos_basics');
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
    '[{"order": 1, "name": "Manager", "approver": "manager"},{"order": 2, "name": "HR", "approver": "hr"}]'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE organization_id = p_org_id AND code = 'leave_default');

  INSERT INTO workflow_definitions (organization_id, code, name, entity_type, steps)
  SELECT p_org_id, 'job_requisition_default', 'Job requisition approval', 'job_requisition',
    '[{"order": 1, "name": "HR", "approver": "hr"}]'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE organization_id = p_org_id AND code = 'job_requisition_default');

  INSERT INTO workflow_definitions (organization_id, code, name, entity_type, steps)
  SELECT p_org_id, 'payroll_default', 'Payroll approval', 'payroll_run',
    '[{"order": 1, "name": "HR", "approver": "hr"}]'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE organization_id = p_org_id AND code = 'payroll_default');

  INSERT INTO workflow_definitions (organization_id, code, name, entity_type, steps)
  SELECT p_org_id, 'performance_review_default', 'Performance review approval', 'performance_review',
    '[{"order": 1, "name": "Manager", "approver": "manager"},{"order": 2, "name": "HR", "approver": "hr"}]'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE organization_id = p_org_id AND code = 'performance_review_default');
END;
$$;

-- ---------------------------------------------------------------------------
-- Skills
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_skills(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(s) ORDER BY s.category, s.name)
    FROM (
      SELECT id, code, name, category, description, is_active
      FROM skills WHERE organization_id = p_org_id AND is_active = true
    ) s
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_skill(
  p_org_id UUID, p_code TEXT, p_name TEXT, p_category TEXT DEFAULT NULL, p_skill_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_skill_id IS NOT NULL THEN
    UPDATE skills SET name = p_name, category = p_category, is_active = true
    WHERE id = p_skill_id AND organization_id = p_org_id RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  INSERT INTO skills (organization_id, code, name, category)
  VALUES (p_org_id, lower(trim(p_code)), trim(p_name), NULLIF(trim(p_category), ''))
  ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_active = true
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_employee_skills(p_org_id UUID, p_employee_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_view_employee(p_employee_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.skill_name)
    FROM (
      SELECT es.id, es.skill_id, s.code AS skill_code, s.name AS skill_name, s.category,
        es.proficiency, es.years_experience, es.notes, es.assessed_at
      FROM employee_skills es
      JOIN skills s ON s.id = es.skill_id
      WHERE es.organization_id = p_org_id AND es.employee_id = p_employee_id
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_employee_skill(
  p_org_id UUID, p_employee_id UUID, p_skill_id UUID,
  p_proficiency skill_proficiency_level DEFAULT 'intermediate',
  p_years_experience NUMERIC DEFAULT NULL, p_notes TEXT DEFAULT NULL
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
  INSERT INTO employee_skills (organization_id, employee_id, skill_id, proficiency, years_experience, notes, assessed_at)
  VALUES (p_org_id, p_employee_id, p_skill_id, p_proficiency, p_years_experience, NULLIF(trim(p_notes), ''), current_date)
  ON CONFLICT (employee_id, skill_id) DO UPDATE SET
    proficiency = EXCLUDED.proficiency, years_experience = EXCLUDED.years_experience,
    notes = EXCLUDED.notes, assessed_at = current_date
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Goals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_performance_goals(
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
  FROM performance_goals pg
  JOIN employees e ON e.id = pg.employee_id
  WHERE pg.organization_id = p_org_id
    AND (p_employee_id IS NULL OR pg.employee_id = p_employee_id)
    AND (p_status IS NULL OR pg.status::text = p_status)
    AND (
      public.user_can_manage_hr(p_org_id)
      OR pg.employee_id = public.my_employee_id(p_org_id)
      OR e.manager_employee_id = public.my_employee_id(p_org_id)
    );

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT pg.id, pg.employee_id, e.name AS employee_name, pg.cycle_id, pg.title, pg.description,
      pg.target_date, pg.weight, pg.progress_pct, pg.status::text AS status, pg.created_at
    FROM performance_goals pg
    JOIN employees e ON e.id = pg.employee_id
    WHERE pg.organization_id = p_org_id
      AND (p_employee_id IS NULL OR pg.employee_id = p_employee_id)
      AND (p_status IS NULL OR pg.status::text = p_status)
      AND (
        public.user_can_manage_hr(p_org_id)
        OR pg.employee_id = public.my_employee_id(p_org_id)
        OR e.manager_employee_id = public.my_employee_id(p_org_id)
      )
    ORDER BY pg.target_date NULLS LAST, pg.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_performance_goal(
  p_org_id UUID, p_employee_id UUID, p_title TEXT, p_description TEXT DEFAULT NULL,
  p_target_date DATE DEFAULT NULL, p_weight NUMERIC DEFAULT 1, p_cycle_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO performance_goals (
    organization_id, employee_id, cycle_id, title, description, target_date, weight, status, created_by
  ) VALUES (
    p_org_id, p_employee_id, p_cycle_id, trim(p_title), NULLIF(trim(p_description), ''),
    p_target_date, COALESCE(p_weight, 1), 'active', auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM public.hr_write_audit_log(p_org_id, 'performance_goal', v_id, 'create', NULL, jsonb_build_object('employee_id', p_employee_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_goal_progress(p_goal_id UUID, p_progress_pct NUMERIC, p_status TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_goal performance_goals%ROWTYPE;
BEGIN
  SELECT * INTO v_goal FROM performance_goals WHERE id = p_goal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Goal not found'; END IF;

  IF NOT public.user_can_manage_hr(v_goal.organization_id)
     AND v_goal.employee_id <> public.my_employee_id(v_goal.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE performance_goals SET
    progress_pct = GREATEST(0, LEAST(100, COALESCE(p_progress_pct, progress_pct))),
    status = COALESCE(NULLIF(p_status, '')::performance_goal_status, status),
    updated_at = now()
  WHERE id = p_goal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_goals(p_org_id UUID, p_limit INT DEFAULT 20)
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
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.target_date NULLS LAST)
    FROM (
      SELECT id, title, description, target_date, weight, progress_pct, status::text AS status, created_at
      FROM performance_goals
      WHERE organization_id = p_org_id AND employee_id = v_emp_id AND status IN ('active', 'draft')
      ORDER BY target_date NULLS LAST
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
    ) x
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Review cycles
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_review_cycles(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.period_end DESC)
    FROM (
      SELECT rc.id, rc.name, rc.period_start, rc.period_end, rc.status::text AS status, rc.created_at,
        (SELECT COUNT(*)::int FROM performance_reviews pr WHERE pr.cycle_id = rc.id) AS review_count
      FROM review_cycles rc WHERE rc.organization_id = p_org_id
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_review_cycle(
  p_org_id UUID, p_name TEXT, p_period_start DATE, p_period_end DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO review_cycles (organization_id, name, period_start, period_end, status, created_by)
  VALUES (p_org_id, trim(p_name), p_period_start, p_period_end, 'draft', auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_review_cycle(p_cycle_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_cycle review_cycles%ROWTYPE; v_count INT := 0; v_emp RECORD;
  v_review_id UUID;
  v_criteria JSONB := '[
    {"code":"teamwork","name":"Teamwork","order":1},
    {"code":"communication","name":"Communication","order":2},
    {"code":"quality","name":"Quality of work","order":3},
    {"code":"productivity","name":"Productivity","order":4},
    {"code":"initiative","name":"Initiative","order":5}
  ]'::jsonb;
  v_crit JSONB;
BEGIN
  SELECT * INTO v_cycle FROM review_cycles WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review cycle not found'; END IF;
  IF NOT public.user_can_manage_hr(v_cycle.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE review_cycles SET status = 'active' WHERE id = p_cycle_id;

  FOR v_emp IN
    SELECT e.id, e.manager_employee_id FROM employees e
    WHERE e.organization_id = v_cycle.organization_id AND e.status = 'active'
  LOOP
    INSERT INTO performance_reviews (
      organization_id, cycle_id, employee_id, reviewer_employee_id, status
    ) VALUES (
      v_cycle.organization_id, p_cycle_id, v_emp.id, v_emp.manager_employee_id, 'self_review'
    )
    ON CONFLICT (cycle_id, employee_id) DO NOTHING
    RETURNING id INTO v_review_id;

    IF v_review_id IS NOT NULL THEN
      FOR v_crit IN SELECT * FROM jsonb_array_elements(v_criteria) LOOP
        INSERT INTO review_ratings (
          organization_id, review_id, criteria_code, criteria_name, sort_order
        ) VALUES (
          v_cycle.organization_id, v_review_id,
          v_crit->>'code', v_crit->>'name', (v_crit->>'order')::int
        ) ON CONFLICT (review_id, criteria_code) DO NOTHING;
      END LOOP;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_performance_reviews(
  p_org_id UUID, p_cycle_id UUID DEFAULT NULL, p_status TEXT DEFAULT NULL,
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
  FROM performance_reviews pr
  JOIN employees e ON e.id = pr.employee_id
  WHERE pr.organization_id = p_org_id
    AND (p_cycle_id IS NULL OR pr.cycle_id = p_cycle_id)
    AND (p_status IS NULL OR pr.status::text = p_status)
    AND (
      public.user_can_manage_hr(p_org_id)
      OR pr.employee_id = public.my_employee_id(p_org_id)
      OR e.manager_employee_id = public.my_employee_id(p_org_id)
    );

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT pr.id, pr.cycle_id, rc.name AS cycle_name, pr.employee_id, e.name AS employee_name,
      pr.reviewer_employee_id, rev.name AS reviewer_name, pr.status::text AS status,
      pr.overall_rating, pr.submitted_at, pr.approved_at
    FROM performance_reviews pr
    JOIN review_cycles rc ON rc.id = pr.cycle_id
    JOIN employees e ON e.id = pr.employee_id
    LEFT JOIN employees rev ON rev.id = pr.reviewer_employee_id
    WHERE pr.organization_id = p_org_id
      AND (p_cycle_id IS NULL OR pr.cycle_id = p_cycle_id)
      AND (p_status IS NULL OR pr.status::text = p_status)
      AND (
        public.user_can_manage_hr(p_org_id)
        OR pr.employee_id = public.my_employee_id(p_org_id)
        OR e.manager_employee_id = public.my_employee_id(p_org_id)
      )
    ORDER BY rc.period_end DESC, e.name
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_performance_review(p_review_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_review performance_reviews%ROWTYPE; v_ratings JSONB;
BEGIN
  SELECT * INTO v_review FROM performance_reviews WHERE id = p_review_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  IF NOT public.user_can_view_employee(v_review.employee_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.sort_order), '[]'::jsonb) INTO v_ratings
  FROM (
    SELECT criteria_code, criteria_name, self_rating, manager_rating, comments, sort_order
    FROM review_ratings WHERE review_id = p_review_id
  ) r;

  RETURN jsonb_build_object(
    'review', jsonb_build_object(
      'id', v_review.id, 'cycle_id', v_review.cycle_id, 'employee_id', v_review.employee_id,
      'reviewer_employee_id', v_review.reviewer_employee_id, 'status', v_review.status,
      'overall_rating', v_review.overall_rating, 'self_comments', v_review.self_comments,
      'manager_comments', v_review.manager_comments, 'submitted_at', v_review.submitted_at,
      'approved_at', v_review.approved_at
    ),
    'ratings', v_ratings,
    'can_manage', public.user_can_manage_hr(v_review.organization_id),
    'is_self', v_review.employee_id = public.my_employee_id(v_review.organization_id),
    'is_manager', v_review.reviewer_employee_id = public.my_employee_id(v_review.organization_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_performance_reviews(p_org_id UUID, p_limit INT DEFAULT 12)
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
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.period_end DESC)
    FROM (
      SELECT pr.id, pr.cycle_id, rc.name AS cycle_name, rc.period_start, rc.period_end,
        pr.status::text AS status, pr.overall_rating, pr.submitted_at, pr.approved_at
      FROM performance_reviews pr
      JOIN review_cycles rc ON rc.id = pr.cycle_id
      WHERE pr.organization_id = p_org_id AND pr.employee_id = v_emp_id
      ORDER BY rc.period_end DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 12), 50))
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_performance_review_self(
  p_review_id UUID, p_self_comments TEXT DEFAULT NULL, p_ratings JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_review performance_reviews%ROWTYPE; v_item JSONB;
BEGIN
  SELECT * INTO v_review FROM performance_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  IF v_review.employee_id <> public.my_employee_id(v_review.organization_id)
     AND NOT public.user_can_manage_hr(v_review.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_review.status NOT IN ('draft', 'self_review') THEN
    RAISE EXCEPTION 'Review is not open for self assessment';
  END IF;

  UPDATE performance_reviews SET
    self_comments = COALESCE(NULLIF(trim(p_self_comments), ''), self_comments),
    status = 'self_review', updated_at = now()
  WHERE id = p_review_id;

  IF p_ratings IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_ratings) LOOP
      UPDATE review_ratings SET self_rating = (v_item->>'rating')::numeric
      WHERE review_id = p_review_id AND criteria_code = v_item->>'criteria_code';
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_performance_review_manager(
  p_review_id UUID, p_manager_comments TEXT DEFAULT NULL,
  p_overall_rating NUMERIC DEFAULT NULL, p_ratings JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_review performance_reviews%ROWTYPE; v_item JSONB;
BEGIN
  SELECT * INTO v_review FROM performance_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;

  IF NOT public.user_can_manage_hr(v_review.organization_id)
     AND v_review.reviewer_employee_id <> public.my_employee_id(v_review.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_review.status NOT IN ('self_review', 'manager_review', 'submitted') THEN
    RAISE EXCEPTION 'Review is not open for manager assessment';
  END IF;

  UPDATE performance_reviews SET
    manager_comments = COALESCE(NULLIF(trim(p_manager_comments), ''), manager_comments),
    overall_rating = COALESCE(p_overall_rating, overall_rating),
    status = 'manager_review', updated_at = now()
  WHERE id = p_review_id;

  IF p_ratings IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_ratings) LOOP
      UPDATE review_ratings SET manager_rating = (v_item->>'rating')::numeric
      WHERE review_id = p_review_id AND criteria_code = v_item->>'criteria_code';
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_performance_review(p_review_id UUID, p_as_manager BOOLEAN DEFAULT false)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_review performance_reviews%ROWTYPE; v_def_id UUID;
BEGIN
  SELECT * INTO v_review FROM performance_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;

  IF NOT p_as_manager THEN
    IF v_review.employee_id <> public.my_employee_id(v_review.organization_id)
       AND NOT public.user_can_manage_hr(v_review.organization_id) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    UPDATE performance_reviews SET status = 'manager_review', submitted_at = now(), updated_at = now()
    WHERE id = p_review_id;
    RETURN p_review_id;
  END IF;

  IF NOT public.user_can_manage_hr(v_review.organization_id)
     AND v_review.reviewer_employee_id <> public.my_employee_id(v_review.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE performance_reviews SET status = 'submitted', submitted_at = now(), updated_at = now()
  WHERE id = p_review_id;

  PERFORM public.ensure_default_hr_workflows(v_review.organization_id);
  SELECT id INTO v_def_id FROM workflow_definitions
  WHERE organization_id = v_review.organization_id AND code = 'performance_review_default' LIMIT 1;

  IF v_def_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workflow_instances
    WHERE entity_type = 'performance_review' AND entity_id = p_review_id AND status = 'pending'
  ) THEN
    INSERT INTO workflow_instances (organization_id, definition_id, entity_type, entity_id, current_step, status)
    VALUES (v_review.organization_id, v_def_id, 'performance_review', p_review_id, 1, 'pending');
    INSERT INTO workflow_approvals (instance_id, step_order, status)
    SELECT wi.id, 1, 'pending' FROM workflow_instances wi
    WHERE wi.entity_type = 'performance_review' AND wi.entity_id = p_review_id AND wi.status = 'pending'
    ORDER BY wi.created_at DESC LIMIT 1;
  END IF;

  RETURN p_review_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_performance_review(p_review_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_review performance_reviews%ROWTYPE;
BEGIN
  SELECT * INTO v_review FROM performance_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  IF NOT public.user_can_manage_hr(v_review.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_review.status <> 'submitted' THEN RAISE EXCEPTION 'Review must be submitted first'; END IF;

  UPDATE performance_reviews SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_review_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Training
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_training_courses(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(c) ORDER BY c.name)
    FROM (
      SELECT id, code, name, provider, duration_hours, description, is_mandatory, is_active
      FROM training_courses WHERE organization_id = p_org_id AND is_active = true
    ) c
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_training_course(
  p_org_id UUID, p_code TEXT, p_name TEXT, p_provider TEXT DEFAULT NULL,
  p_duration_hours NUMERIC DEFAULT NULL, p_mandatory BOOLEAN DEFAULT false, p_course_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_course_id IS NOT NULL THEN
    UPDATE training_courses SET name = p_name, provider = p_provider, duration_hours = p_duration_hours,
      is_mandatory = COALESCE(p_mandatory, is_mandatory), is_active = true
    WHERE id = p_course_id AND organization_id = p_org_id RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  INSERT INTO training_courses (organization_id, code, name, provider, duration_hours, is_mandatory)
  VALUES (p_org_id, lower(trim(p_code)), trim(p_name), NULLIF(trim(p_provider), ''), p_duration_hours, COALESCE(p_mandatory, false))
  ON CONFLICT (organization_id, code) DO UPDATE SET
    name = EXCLUDED.name, provider = EXCLUDED.provider, duration_hours = EXCLUDED.duration_hours,
    is_mandatory = EXCLUDED.is_mandatory, is_active = true
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_employee_training(
  p_org_id UUID, p_employee_id UUID DEFAULT NULL, p_limit INT DEFAULT 25, p_offset INT DEFAULT 0
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
  FROM employee_training_records etr
  JOIN employees e ON e.id = etr.employee_id
  WHERE etr.organization_id = p_org_id
    AND (p_employee_id IS NULL OR etr.employee_id = p_employee_id)
    AND (
      public.user_can_manage_hr(p_org_id)
      OR etr.employee_id = public.my_employee_id(p_org_id)
      OR e.manager_employee_id = public.my_employee_id(p_org_id)
    );

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT etr.id, etr.employee_id, e.name AS employee_name, etr.course_id, tc.code AS course_code,
      tc.name AS course_name, etr.status::text AS status, etr.started_at, etr.completed_at,
      etr.score, etr.certificate_url
    FROM employee_training_records etr
    JOIN employees e ON e.id = etr.employee_id
    JOIN training_courses tc ON tc.id = etr.course_id
    WHERE etr.organization_id = p_org_id
      AND (p_employee_id IS NULL OR etr.employee_id = p_employee_id)
      AND (
        public.user_can_manage_hr(p_org_id)
        OR etr.employee_id = public.my_employee_id(p_org_id)
        OR e.manager_employee_id = public.my_employee_id(p_org_id)
      )
    ORDER BY etr.completed_at DESC NULLS LAST, etr.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_employee_training(
  p_org_id UUID, p_employee_id UUID, p_course_id UUID,
  p_status training_record_status DEFAULT 'planned',
  p_started_at DATE DEFAULT NULL, p_completed_at DATE DEFAULT NULL,
  p_score NUMERIC DEFAULT NULL, p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO employee_training_records (
    organization_id, employee_id, course_id, status, started_at, completed_at, score, notes
  ) VALUES (
    p_org_id, p_employee_id, p_course_id, p_status, p_started_at, p_completed_at, p_score,
    NULLIF(trim(p_notes), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_training(p_org_id UUID, p_limit INT DEFAULT 20)
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
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.completed_at DESC NULLS LAST)
    FROM (
      SELECT etr.id, tc.name AS course_name, tc.code AS course_code, etr.status::text AS status,
        etr.started_at, etr.completed_at, etr.score, tc.is_mandatory
      FROM employee_training_records etr
      JOIN training_courses tc ON tc.id = etr.course_id
      WHERE etr.organization_id = p_org_id AND etr.employee_id = v_emp_id
      ORDER BY etr.completed_at DESC NULLS LAST
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
    ) x
  ), '[]'::jsonb);
END;
$$;

-- Extend workflow approval for performance reviews
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
  v_review performance_reviews%ROWTYPE;
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
    IF NOT v_can_approve THEN v_can_approve := public.user_can_manage_hr(v_instance.organization_id); END IF;
  ELSIF (v_current_step->>'approver') = 'manager' AND p_entity_type = 'performance_review' THEN
    SELECT * INTO v_review FROM performance_reviews WHERE id = p_entity_id;
    v_can_approve := v_review.reviewer_employee_id IS NOT NULL
      AND v_review.reviewer_employee_id = public.my_employee_id(v_instance.organization_id);
    IF NOT v_can_approve THEN v_can_approve := public.user_can_manage_hr(v_instance.organization_id); END IF;
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
    ELSIF p_entity_type = 'payroll_run' THEN
      UPDATE payroll_runs SET status = 'cancelled' WHERE id = p_entity_id;
    ELSIF p_entity_type = 'performance_review' THEN
      UPDATE performance_reviews SET status = 'rejected' WHERE id = p_entity_id;
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
    ELSIF p_entity_type = 'payroll_run' THEN
      PERFORM public.approve_payroll_run(p_entity_id);
    ELSIF p_entity_type = 'performance_review' THEN
      PERFORM public.approve_performance_review(p_entity_id);
    END IF;
    RETURN jsonb_build_object('workflow', true, 'status', 'approved');
  END IF;

  UPDATE workflow_instances SET current_step = v_next_step WHERE id = v_instance.id;
  RETURN jsonb_build_object('workflow', true, 'status', 'pending', 'current_step', v_next_step);
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_skills(v_org);
    PERFORM public.ensure_default_training_courses(v_org);
    PERFORM public.ensure_default_hr_workflows(v_org);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_skills(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_skill(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_employee_skills(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_employee_skill(UUID, UUID, UUID, skill_proficiency_level, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_performance_goals(UUID, UUID, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_performance_goal(UUID, UUID, TEXT, TEXT, DATE, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_goal_progress(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_goals(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_review_cycles(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_review_cycle(UUID, TEXT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_review_cycle(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_performance_reviews(UUID, UUID, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_performance_review(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_performance_reviews(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_performance_review_self(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_performance_review_manager(UUID, TEXT, NUMERIC, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_performance_review(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_performance_review(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_training_courses(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_training_course(UUID, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_employee_training(UUID, UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_employee_training(UUID, UUID, UUID, training_record_status, DATE, DATE, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_training(UUID, INT) TO authenticated;

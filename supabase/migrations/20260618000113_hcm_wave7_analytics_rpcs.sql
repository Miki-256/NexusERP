-- HCM Wave 7: workforce analytics — headcount, turnover, absence, HR dashboard.

CREATE OR REPLACE FUNCTION public._hr_headcount_on_date(p_org_id UUID, p_as_of DATE)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM employees e
  LEFT JOIN employee_profiles ep ON ep.employee_id = e.id
  WHERE e.organization_id = p_org_id
    AND e.hire_date <= p_as_of
    AND (
      e.status <> 'terminated'
      OR COALESCE(ep.termination_date, e.updated_at::date) > p_as_of
    );
$$;

CREATE OR REPLACE FUNCTION public.get_hr_workforce_dashboard(
  p_org_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from DATE := COALESCE(p_from, date_trunc('month', current_date)::date);
  v_to DATE := COALESCE(p_to, current_date);
  v_active INT;
  v_on_leave INT;
  v_terminated INT;
  v_total INT;
  v_new_hires INT;
  v_departures INT;
  v_start_headcount INT;
  v_end_headcount INT;
  v_avg_headcount NUMERIC;
  v_turnover_pct NUMERIC;
  v_pending_leave INT;
  v_leave_days NUMERIC;
  v_working_days INT;
  v_absence_pct NUMERIC;
  v_avg_tenure NUMERIC;
  v_open_reqs INT;
  v_attendance_employees INT;
  v_attendance_pct NUMERIC;
  v_by_status JSONB;
  v_by_unit JSONB;
  v_by_employment JSONB;
  v_trend JSONB;
  v_leave_by_type JSONB;
  v_recent_hires JSONB;
  v_recent_departures JSONB;
  v_month DATE;
  v_i INT;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_to < v_from THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE e.status = 'active'),
    COUNT(*) FILTER (WHERE e.status = 'on_leave'),
    COUNT(*) FILTER (WHERE e.status = 'terminated'),
    COUNT(*)
  INTO v_active, v_on_leave, v_terminated, v_total
  FROM employees e WHERE e.organization_id = p_org_id;

  SELECT COUNT(*) INTO v_new_hires
  FROM employees e
  WHERE e.organization_id = p_org_id AND e.hire_date BETWEEN v_from AND v_to;

  SELECT COUNT(*) INTO v_departures
  FROM employees e
  LEFT JOIN employee_profiles ep ON ep.employee_id = e.id
  WHERE e.organization_id = p_org_id
    AND e.status = 'terminated'
    AND COALESCE(ep.termination_date, e.updated_at::date) BETWEEN v_from AND v_to;

  v_start_headcount := public._hr_headcount_on_date(p_org_id, v_from);
  v_end_headcount := public._hr_headcount_on_date(p_org_id, v_to);
  v_avg_headcount := GREATEST((v_start_headcount + v_end_headcount) / 2.0, 1);
  v_turnover_pct := ROUND((v_departures::numeric / v_avg_headcount) * 100, 2);

  SELECT COUNT(*) INTO v_pending_leave
  FROM leave_requests lr
  WHERE lr.organization_id = p_org_id AND lr.status = 'pending';

  SELECT COALESCE(SUM(
    COALESCE(lr.days_requested, public.hr_count_leave_days(p_org_id, lr.start_date, lr.end_date))
  ), 0) INTO v_leave_days
  FROM leave_requests lr
  WHERE lr.organization_id = p_org_id AND lr.status = 'approved'
    AND lr.start_date <= v_to AND lr.end_date >= v_from;

  v_working_days := GREATEST((v_to - v_from) + 1, 1);
  v_absence_pct := CASE WHEN v_active > 0
    THEN ROUND((v_leave_days / (v_active * v_working_days)) * 100, 2)
    ELSE 0 END;

  SELECT ROUND(AVG(
    EXTRACT(YEAR FROM age(current_date, e.hire_date)) * 12 +
    EXTRACT(MONTH FROM age(current_date, e.hire_date))
  ), 1) INTO v_avg_tenure
  FROM employees e
  WHERE e.organization_id = p_org_id AND e.status IN ('active', 'on_leave');

  SELECT COUNT(*) INTO v_open_reqs
  FROM job_requisitions jr
  WHERE jr.organization_id = p_org_id AND jr.status IN ('approved', 'posted');

  SELECT COUNT(DISTINCT ar.employee_id) INTO v_attendance_employees
  FROM attendance_records ar
  WHERE ar.organization_id = p_org_id
    AND ar.clock_in::date BETWEEN v_from AND v_to
    AND ar.status IN ('closed', 'adjusted');

  v_attendance_pct := CASE WHEN v_active > 0
    THEN ROUND((v_attendance_employees::numeric / v_active) * 100, 1)
    ELSE 0 END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'label', s.status::text, 'value', s.cnt
  ) ORDER BY s.status), '[]'::jsonb) INTO v_by_status
  FROM (
    SELECT e.status, COUNT(*)::int AS cnt
    FROM employees e WHERE e.organization_id = p_org_id
    GROUP BY e.status
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'label', COALESCE(ou.name, 'Unassigned'), 'value', u.cnt
  ) ORDER BY u.cnt DESC), '[]'::jsonb) INTO v_by_unit
  FROM (
    SELECT COALESCE(e.org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) AS unit_id,
      COUNT(*)::int AS cnt
    FROM employees e
    WHERE e.organization_id = p_org_id AND e.status IN ('active', 'on_leave')
    GROUP BY e.org_unit_id
  ) u
  LEFT JOIN org_units ou ON ou.id = NULLIF(u.unit_id, '00000000-0000-0000-0000-000000000000'::uuid);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'label', replace(t.employment_type::text, '_', ' '), 'value', t.cnt
  ) ORDER BY t.cnt DESC), '[]'::jsonb) INTO v_by_employment
  FROM (
    SELECT e.employment_type, COUNT(*)::int AS cnt
    FROM employees e
    WHERE e.organization_id = p_org_id AND e.status IN ('active', 'on_leave')
    GROUP BY e.employment_type
  ) t;

  v_trend := '[]'::jsonb;
  v_month := date_trunc('month', v_to)::date;
  FOR v_i IN 0..11 LOOP
    v_trend := v_trend || jsonb_build_array(jsonb_build_object(
      'month', to_char(v_month, 'YYYY-MM'),
      'count', public._hr_headcount_on_date(p_org_id, (v_month + interval '1 month' - interval '1 day')::date)
    ));
    v_month := (v_month - interval '1 month')::date;
  END LOOP;
  SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'month')), '[]'::jsonb) INTO v_trend
  FROM jsonb_array_elements(v_trend) elem;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'label', COALESCE(lt.name, 'Leave'), 'days', ROUND(l.days::numeric, 1)
  ) ORDER BY l.days DESC), '[]'::jsonb) INTO v_leave_by_type
  FROM (
    SELECT lr.leave_type_id,
      SUM(COALESCE(lr.days_requested, public.hr_count_leave_days(p_org_id, lr.start_date, lr.end_date))) AS days
    FROM leave_requests lr
    WHERE lr.organization_id = p_org_id AND lr.status = 'approved'
      AND lr.start_date <= v_to AND lr.end_date >= v_from
    GROUP BY lr.leave_type_id
  ) l
  LEFT JOIN leave_types lt ON lt.id = l.leave_type_id;

  SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY h.hire_date DESC), '[]'::jsonb) INTO v_recent_hires
  FROM (
    SELECT e.id, e.name, e.position, e.hire_date, e.employment_type::text AS employment_type
    FROM employees e
    WHERE e.organization_id = p_org_id AND e.hire_date BETWEEN v_from AND v_to
    ORDER BY e.hire_date DESC LIMIT 8
  ) h;

  SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.departure_date DESC), '[]'::jsonb) INTO v_recent_departures
  FROM (
    SELECT e.id, e.name, e.position,
      COALESCE(ep.termination_date, e.updated_at::date) AS departure_date
    FROM employees e
    LEFT JOIN employee_profiles ep ON ep.employee_id = e.id
    WHERE e.organization_id = p_org_id AND e.status = 'terminated'
      AND COALESCE(ep.termination_date, e.updated_at::date) BETWEEN v_from AND v_to
    ORDER BY COALESCE(ep.termination_date, e.updated_at::date) DESC LIMIT 8
  ) d;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'summary', jsonb_build_object(
      'active_headcount', v_active,
      'on_leave', v_on_leave,
      'terminated_total', v_terminated,
      'total_employees', v_total,
      'new_hires', v_new_hires,
      'departures', v_departures,
      'turnover_rate_pct', v_turnover_pct,
      'pending_leave_requests', v_pending_leave,
      'approved_leave_days', ROUND(v_leave_days, 1),
      'absence_rate_pct', v_absence_pct,
      'avg_tenure_months', COALESCE(v_avg_tenure, 0),
      'open_requisitions', v_open_reqs,
      'attendance_coverage_pct', v_attendance_pct
    ),
    'headcount_by_status', v_by_status,
    'headcount_by_org_unit', v_by_unit,
    'headcount_by_employment_type', v_by_employment,
    'headcount_trend', v_trend,
    'leave_by_type', v_leave_by_type,
    'recent_hires', v_recent_hires,
    'recent_departures', v_recent_departures,
    'can_manage', public.user_can_manage_hr(p_org_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._hr_headcount_on_date(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hr_workforce_dashboard(UUID, DATE, DATE) TO authenticated;

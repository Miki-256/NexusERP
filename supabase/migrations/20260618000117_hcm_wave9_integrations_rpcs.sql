-- HCM Wave 9: integration RPCs — exports, GL mappings, webhooks, enhanced payroll posting.

-- ---------------------------------------------------------------------------
-- CSV helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._hr_csv_escape(p_val TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_val IS NULL THEN ''
    WHEN p_val ~ '[",\n\r]' THEN '"' || replace(p_val, '"', '""') || '"'
    ELSE p_val
  END;
$$;

-- ---------------------------------------------------------------------------
-- Payroll GL mappings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_hr_gl_mappings(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO hr_payroll_gl_mappings (organization_id, mapping_key, gl_account_code, description)
  VALUES
    (p_org_id, 'payroll_expense', '6400', 'Payroll expense (gross earnings)'),
    (p_org_id, 'tax_payable', '2100', 'Payroll tax & statutory liabilities'),
    (p_org_id, 'deductions_payable', '2100', 'Employee deductions payable'),
    (p_org_id, 'net_pay_cash', '1000', 'Net pay — cash'),
    (p_org_id, 'net_pay_bank', '1010', 'Net pay — bank transfer'),
    (p_org_id, 'net_pay_mobile', '1020', 'Net pay — mobile money')
  ON CONFLICT (organization_id, mapping_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hr_gl_account_code(
  p_org_id UUID,
  p_mapping_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
BEGIN
  PERFORM public.ensure_default_hr_gl_mappings(p_org_id);
  SELECT gl_account_code INTO v_code
  FROM hr_payroll_gl_mappings
  WHERE organization_id = p_org_id AND mapping_key = p_mapping_key;
  RETURN COALESCE(v_code, '6400');
END;
$$;

CREATE OR REPLACE FUNCTION public.list_hr_payroll_gl_mappings(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  PERFORM public.ensure_default_hr_gl_mappings(p_org_id);
  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'mapping_key', m.mapping_key,
          'gl_account_code', m.gl_account_code,
          'description', m.description,
          'updated_at', m.updated_at
        )
        ORDER BY m.mapping_key
      )
      FROM hr_payroll_gl_mappings m
      WHERE m.organization_id = p_org_id
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_hr_payroll_gl_mapping(
  p_org_id UUID,
  p_mapping_key TEXT,
  p_gl_account_code TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_key TEXT := NULLIF(trim(p_mapping_key), '');
  v_code TEXT := NULLIF(trim(p_gl_account_code), '');
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_key IS NULL OR v_code IS NULL THEN RAISE EXCEPTION 'Mapping key and account code required'; END IF;

  INSERT INTO hr_payroll_gl_mappings (organization_id, mapping_key, gl_account_code, description, updated_at)
  VALUES (p_org_id, v_key, v_code, NULLIF(trim(p_description), ''), now())
  ON CONFLICT (organization_id, mapping_key) DO UPDATE SET
    gl_account_code = EXCLUDED.gl_account_code,
    description = COALESCE(EXCLUDED.description, hr_payroll_gl_mappings.description),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Extend pay component upsert with GL account code
CREATE OR REPLACE FUNCTION public.upsert_pay_component(
  p_org_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_component_type pay_component_type DEFAULT 'earning',
  p_calc_type pay_calc_type DEFAULT 'fixed',
  p_default_amount NUMERIC DEFAULT 0,
  p_default_rate NUMERIC DEFAULT 0,
  p_id UUID DEFAULT NULL,
  p_gl_account_code TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_code TEXT := lower(NULLIF(trim(p_code), ''));
  v_name TEXT := NULLIF(trim(p_name), '');
  v_gl TEXT := NULLIF(trim(p_gl_account_code), '');
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_name IS NULL OR v_code IS NULL THEN RAISE EXCEPTION 'Code and name required'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE pay_components SET
      name = v_name, component_type = COALESCE(p_component_type, component_type),
      calc_type = COALESCE(p_calc_type, calc_type),
      default_amount = COALESCE(p_default_amount, default_amount),
      default_rate = COALESCE(p_default_rate, default_rate),
      gl_account_code = COALESCE(v_gl, gl_account_code)
    WHERE id = p_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Component not found'; END IF;
    RETURN v_id;
  END IF;

  INSERT INTO pay_components (
    organization_id, code, name, component_type, calc_type,
    default_amount, default_rate, gl_account_code
  ) VALUES (
    p_org_id, v_code, v_name, p_component_type, p_calc_type,
    COALESCE(p_default_amount, 0), COALESCE(p_default_rate, 0), v_gl
  )
  ON CONFLICT (organization_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    component_type = EXCLUDED.component_type,
    calc_type = EXCLUDED.calc_type,
    default_amount = EXCLUDED.default_amount,
    default_rate = EXCLUDED.default_rate,
    gl_account_code = COALESCE(EXCLUDED.gl_account_code, pay_components.gl_account_code),
    is_active = true
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- HR data exports (CSV)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_hr_employees_csv(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_csv TEXT := '';
  v_count INT := 0;
  v_row RECORD;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  v_csv := 'employee_number,name,email,phone,position,employment_type,status,hire_date,base_salary,payment_method,org_unit';

  FOR v_row IN
    SELECT
      COALESCE(e.employee_number, '') AS employee_number,
      e.name,
      COALESCE(e.email, '') AS email,
      COALESCE(e.phone, '') AS phone,
      COALESCE(e.position, '') AS position,
      e.employment_type::TEXT,
      e.status::TEXT,
      e.hire_date::TEXT,
      COALESCE(e.base_salary, 0)::TEXT AS base_salary,
      e.payment_method::TEXT,
      COALESCE(ou.name, '') AS org_unit
    FROM employees e
    LEFT JOIN org_units ou ON ou.id = e.org_unit_id
    WHERE e.organization_id = p_org_id
    ORDER BY e.name
  LOOP
    v_csv := v_csv || E'\n' ||
      public._hr_csv_escape(v_row.employee_number) || ',' ||
      public._hr_csv_escape(v_row.name) || ',' ||
      public._hr_csv_escape(v_row.email) || ',' ||
      public._hr_csv_escape(v_row.phone) || ',' ||
      public._hr_csv_escape(v_row.position) || ',' ||
      public._hr_csv_escape(v_row.employment_type) || ',' ||
      public._hr_csv_escape(v_row.status) || ',' ||
      public._hr_csv_escape(v_row.hire_date) || ',' ||
      public._hr_csv_escape(v_row.base_salary) || ',' ||
      public._hr_csv_escape(v_row.payment_method) || ',' ||
      public._hr_csv_escape(v_row.org_unit);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'content', v_csv,
    'filename', 'hr_employees_' || to_char(now(), 'YYYYMMDD') || '.csv',
    'row_count', v_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.export_hr_leave_csv(
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
  v_csv TEXT := '';
  v_count INT := 0;
  v_from DATE := COALESCE(p_from, date_trunc('year', current_date)::DATE);
  v_to DATE := COALESCE(p_to, current_date);
  v_row RECORD;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  v_csv := 'employee_name,start_date,end_date,status,reason,created_at';

  FOR v_row IN
    SELECT
      e.name AS employee_name,
      lr.start_date::TEXT,
      lr.end_date::TEXT,
      lr.status::TEXT,
      COALESCE(lr.reason, '') AS reason,
      lr.created_at::TEXT
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    WHERE lr.organization_id = p_org_id
      AND lr.start_date <= v_to
      AND lr.end_date >= v_from
    ORDER BY lr.start_date DESC
  LOOP
    v_csv := v_csv || E'\n' ||
      public._hr_csv_escape(v_row.employee_name) || ',' ||
      public._hr_csv_escape(v_row.start_date) || ',' ||
      public._hr_csv_escape(v_row.end_date) || ',' ||
      public._hr_csv_escape(v_row.status) || ',' ||
      public._hr_csv_escape(v_row.reason) || ',' ||
      public._hr_csv_escape(v_row.created_at);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'content', v_csv,
    'filename', 'hr_leave_' || v_from::TEXT || '_to_' || v_to::TEXT || '.csv',
    'row_count', v_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.export_hr_payroll_csv(
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
  v_csv TEXT := '';
  v_count INT := 0;
  v_from DATE := COALESCE(p_from, date_trunc('year', current_date)::DATE);
  v_to DATE := COALESCE(p_to, current_date);
  v_row RECORD;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  v_csv := 'period_start,period_end,status,payment_method,total_gross,total_tax,total_deductions,total_net,posted_at';

  FOR v_row IN
    SELECT
      pr.period_start::TEXT,
      pr.period_end::TEXT,
      pr.status::TEXT,
      pr.payment_method::TEXT,
      pr.total_gross::TEXT,
      pr.total_tax::TEXT,
      pr.total_deductions::TEXT,
      pr.total_net::TEXT,
      COALESCE(pr.posted_at::TEXT, '') AS posted_at
    FROM payroll_runs pr
    WHERE pr.organization_id = p_org_id
      AND pr.period_end >= v_from
      AND pr.period_start <= v_to
    ORDER BY pr.period_end DESC
  LOOP
    v_csv := v_csv || E'\n' ||
      public._hr_csv_escape(v_row.period_start) || ',' ||
      public._hr_csv_escape(v_row.period_end) || ',' ||
      public._hr_csv_escape(v_row.status) || ',' ||
      public._hr_csv_escape(v_row.payment_method) || ',' ||
      public._hr_csv_escape(v_row.total_gross) || ',' ||
      public._hr_csv_escape(v_row.total_tax) || ',' ||
      public._hr_csv_escape(v_row.total_deductions) || ',' ||
      public._hr_csv_escape(v_row.total_net) || ',' ||
      public._hr_csv_escape(v_row.posted_at);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'content', v_csv,
    'filename', 'hr_payroll_' || v_from::TEXT || '_to_' || v_to::TEXT || '.csv',
    'row_count', v_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.export_hr_attendance_csv(
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
  v_csv TEXT := '';
  v_count INT := 0;
  v_from DATE := COALESCE(p_from, date_trunc('month', current_date)::DATE);
  v_to DATE := COALESCE(p_to, current_date);
  v_row RECORD;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  v_csv := 'employee_name,clock_in,clock_out,status,is_late,is_early_leave,overtime_minutes,store';

  FOR v_row IN
    SELECT
      e.name AS employee_name,
      ar.clock_in_at::TEXT,
      COALESCE(ar.clock_out_at::TEXT, '') AS clock_out,
      ar.status::TEXT,
      CASE WHEN ar.is_late THEN 'yes' ELSE 'no' END AS is_late,
      CASE WHEN ar.is_early_leave THEN 'yes' ELSE 'no' END AS is_early_leave,
      ar.overtime_minutes::TEXT,
      COALESCE(s.name, '') AS store
    FROM attendance_records ar
    JOIN employees e ON e.id = ar.employee_id
    LEFT JOIN stores s ON s.id = ar.store_id
    WHERE ar.organization_id = p_org_id
      AND ar.clock_in_at::DATE >= v_from
      AND ar.clock_in_at::DATE <= v_to
    ORDER BY ar.clock_in_at DESC
  LOOP
    v_csv := v_csv || E'\n' ||
      public._hr_csv_escape(v_row.employee_name) || ',' ||
      public._hr_csv_escape(v_row.clock_in) || ',' ||
      public._hr_csv_escape(v_row.clock_out) || ',' ||
      public._hr_csv_escape(v_row.status) || ',' ||
      public._hr_csv_escape(v_row.is_late) || ',' ||
      public._hr_csv_escape(v_row.is_early_leave) || ',' ||
      public._hr_csv_escape(v_row.overtime_minutes) || ',' ||
      public._hr_csv_escape(v_row.store);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'content', v_csv,
    'filename', 'hr_attendance_' || v_from::TEXT || '_to_' || v_to::TEXT || '.csv',
    'row_count', v_count
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Outbound HR webhooks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_hr_webhook_endpoints(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', w.id,
          'name', w.name,
          'url', w.url,
          'has_secret', (w.secret IS NOT NULL AND length(w.secret) > 0),
          'events', w.events,
          'is_active', w.is_active,
          'created_at', w.created_at,
          'updated_at', w.updated_at
        )
        ORDER BY w.created_at DESC
      )
      FROM hr_webhook_endpoints w
      WHERE w.organization_id = p_org_id
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_hr_webhook_endpoint(
  p_org_id UUID,
  p_name TEXT,
  p_url TEXT,
  p_events TEXT[] DEFAULT '{}',
  p_secret TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
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
  v_url TEXT := NULLIF(trim(p_url), '');
  v_secret TEXT := NULLIF(trim(p_secret), '');
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_name IS NULL OR v_url IS NULL THEN RAISE EXCEPTION 'Name and URL required'; END IF;
  IF v_url !~ '^https?://' THEN RAISE EXCEPTION 'URL must start with http:// or https://'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE hr_webhook_endpoints SET
      name = v_name,
      url = v_url,
      events = COALESCE(p_events, events),
      secret = CASE WHEN v_secret IS NOT NULL THEN v_secret ELSE secret END,
      is_active = COALESCE(p_is_active, is_active),
      updated_at = now()
    WHERE id = p_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Endpoint not found'; END IF;
    RETURN v_id;
  END IF;

  INSERT INTO hr_webhook_endpoints (organization_id, name, url, events, secret, is_active)
  VALUES (p_org_id, v_name, v_url, COALESCE(p_events, '{}'), v_secret, COALESCE(p_is_active, true))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_hr_webhook_endpoint(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM hr_webhook_endpoints WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Endpoint not found'; END IF;
  IF NOT public.user_can_manage_hr(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  DELETE FROM hr_webhook_endpoints WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_hr_webhook_deliveries(
  p_org_id UUID,
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
  v_total INT;
  v_items JSONB;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM hr_webhook_queue q
  WHERE q.organization_id = p_org_id;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      q.id,
      q.event_type,
      q.status,
      q.attempts,
      q.last_error,
      q.created_at,
      q.processed_at,
      e.name AS endpoint_name,
      e.url AS endpoint_url
    FROM hr_webhook_queue q
    JOIN hr_webhook_endpoints e ON e.id = q.endpoint_id
    WHERE q.organization_id = p_org_id
    ORDER BY q.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    OFFSET GREATEST(0, p_offset)
  ) t;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_hr_webhooks(
  p_org_id UUID,
  p_event_type TEXT,
  p_payload JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_ep RECORD;
  v_key TEXT;
BEGIN
  FOR v_ep IN
    SELECT id FROM hr_webhook_endpoints
    WHERE organization_id = p_org_id
      AND is_active = true
      AND (
        cardinality(events) = 0
        OR p_event_type = ANY(events)
      )
  LOOP
    v_key := CASE
      WHEN p_idempotency_key IS NOT NULL THEN p_idempotency_key || ':' || v_ep.id::TEXT
      ELSE NULL
    END;

    BEGIN
      INSERT INTO hr_webhook_queue (
        organization_id, endpoint_id, event_type, payload, idempotency_key
      ) VALUES (
        p_org_id, v_ep.id, p_event_type, COALESCE(p_payload, '{}'::jsonb), v_key
      );
      v_count := v_count + 1;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_hr_webhook_batch(p_limit INT DEFAULT 25)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
  v_ids UUID[];
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb),
         COALESCE(array_agg(t.queue_id), '{}')
    INTO v_items, v_ids
  FROM (
    SELECT
      q.id AS queue_id,
      q.organization_id,
      q.event_type,
      q.payload,
      q.attempts,
      e.id AS endpoint_id,
      e.url,
      e.secret,
      e.name AS endpoint_name
    FROM hr_webhook_queue q
    JOIN hr_webhook_endpoints e ON e.id = q.endpoint_id
    WHERE q.status = 'pending'
      AND e.is_active = true
      AND q.attempts < 5
    ORDER BY q.created_at
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE OF q SKIP LOCKED
  ) t;

  IF v_ids IS NOT NULL AND cardinality(v_ids) > 0 THEN
    UPDATE hr_webhook_queue SET attempts = attempts + 1
    WHERE id = ANY(v_ids);
  END IF;

  RETURN COALESCE(v_items, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_hr_webhook_delivery(
  p_queue_id UUID,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE hr_webhook_queue SET
    status = CASE WHEN p_success THEN 'sent' ELSE
      CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END
    END,
    last_error = CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error, 'Delivery failed'), 500) END,
    processed_at = CASE WHEN p_success OR attempts >= 5 THEN now() ELSE processed_at END
  WHERE id = p_queue_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Enhanced payroll posting with component-level GL + webhook
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_payroll_run(p_run_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run payroll_runs%ROWTYPE;
  v_entry_id UUID;
  v_pay_acct UUID;
  v_je_lines JSONB := '[]'::jsonb;
  v_detail_count INT := 0;
  v_agg RECORD;
  v_acct_id UUID;
  v_net_key TEXT;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  IF NOT public.user_can_manage_hr(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status = 'posted' THEN RETURN p_run_id; END IF;
  IF v_run.status NOT IN ('approved', 'draft') THEN
    RAISE EXCEPTION 'Payroll must be approved before posting (current: %)', v_run.status;
  END IF;

  PERFORM public.ensure_default_accounts(v_run.organization_id);
  PERFORM public.ensure_default_hr_gl_mappings(v_run.organization_id);

  v_net_key := CASE v_run.payment_method
    WHEN 'cash' THEN 'net_pay_cash'
    WHEN 'bank_transfer' THEN 'net_pay_bank'
    WHEN 'mobile_money' THEN 'net_pay_mobile'
    ELSE 'net_pay_bank'
  END;

  SELECT COUNT(*)::INT INTO v_detail_count
  FROM payslip_lines pl
  JOIN payslips ps ON ps.id = pl.payslip_id
  JOIN pay_components pc ON pc.id = pl.component_id
  WHERE ps.run_id = p_run_id
    AND pc.gl_account_code IS NOT NULL
    AND length(trim(pc.gl_account_code)) > 0;

  IF v_detail_count > 0 THEN
    FOR v_agg IN
      SELECT
        pc.gl_account_code,
        pl.component_type,
        SUM(pl.amount) AS total
      FROM payslip_lines pl
      JOIN payslips ps ON ps.id = pl.payslip_id
      JOIN pay_components pc ON pc.id = pl.component_id
      WHERE ps.run_id = p_run_id
        AND pc.gl_account_code IS NOT NULL
        AND length(trim(pc.gl_account_code)) > 0
      GROUP BY pc.gl_account_code, pl.component_type
    LOOP
      v_acct_id := public.account_id_by_code(v_run.organization_id, v_agg.gl_account_code);
      IF v_agg.component_type IN ('earning', 'employer_contribution') THEN
        v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
          'accountId', v_acct_id,
          'debit', v_agg.total, 'credit', 0,
          'description', 'Payroll ' || v_agg.gl_account_code
        ));
      ELSIF v_agg.component_type IN ('deduction', 'tax') THEN
        v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
          'accountId', v_acct_id,
          'debit', 0, 'credit', v_agg.total,
          'description', 'Payroll ' || v_agg.gl_account_code
        ));
      END IF;
    END LOOP;
  ELSE
    v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(
        v_run.organization_id, public.get_hr_gl_account_code(v_run.organization_id, 'payroll_expense')),
      'debit', v_run.total_gross, 'credit', 0, 'description', 'Payroll gross'));

    IF (v_run.total_tax + v_run.total_deductions) > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
        'accountId', public.account_id_by_code(
          v_run.organization_id, public.get_hr_gl_account_code(v_run.organization_id, 'tax_payable')),
        'debit', 0, 'credit', v_run.total_tax + v_run.total_deductions, 'description', 'Payroll tax & deductions'));
    END IF;
  END IF;

  v_pay_acct := public.account_id_by_code(
    v_run.organization_id, public.get_hr_gl_account_code(v_run.organization_id, v_net_key));

  v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
    'accountId', v_pay_acct,
    'debit', 0, 'credit', v_run.total_net, 'description', 'Net pay'));

  v_entry_id := public.post_journal_entry(
    v_run.organization_id, 'GEN', v_run.period_end,
    'Payroll ' || v_run.period_start || ' to ' || v_run.period_end,
    'payroll', p_run_id, v_je_lines
  );

  UPDATE payroll_runs SET
    status = 'posted', journal_entry_id = v_entry_id, posted_at = now()
  WHERE id = p_run_id;

  PERFORM public.hr_write_audit_log(v_run.organization_id, 'payroll_run', p_run_id, 'posted', NULL,
    jsonb_build_object('total_net', v_run.total_net, 'journal_entry_id', v_entry_id));

  PERFORM public.enqueue_notification_event(
    v_run.organization_id, 'hr.payroll_completed', 'payroll_run', p_run_id,
    jsonb_build_object(
      'period_start', v_run.period_start, 'period_end', v_run.period_end,
      'total_net', v_run.total_net
    ),
    'payroll_run:' || p_run_id::text
  );

  PERFORM public.enqueue_hr_webhooks(
    v_run.organization_id,
    'hr.payroll_posted',
    jsonb_build_object(
      'run_id', p_run_id,
      'period_start', v_run.period_start,
      'period_end', v_run.period_end,
      'total_gross', v_run.total_gross,
      'total_tax', v_run.total_tax,
      'total_deductions', v_run.total_deductions,
      'total_net', v_run.total_net,
      'journal_entry_id', v_entry_id,
      'posted_at', now()
    ),
    'hr.payroll_posted:' || p_run_id::text
  );

  RETURN p_run_id;
END;
$$;

-- Patch offboarding to enqueue outbound webhooks (preserves Wave 8 behavior)
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

  PERFORM public.enqueue_hr_webhooks(
    v_emp.organization_id,
    'hr.offboarding_started',
    jsonb_build_object(
      'employee_id', p_employee_id,
      'employee_name', v_emp.name,
      'last_working_date', v_last,
      'tasks_created', v_sort,
      'notes', p_notes
    ),
    'hr.offboarding_started:' || p_employee_id::text
  );

  RETURN jsonb_build_object('employee_id', p_employee_id, 'tasks_created', v_sort, 'last_working_date', v_last);
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.list_hr_payroll_gl_mappings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_hr_payroll_gl_mapping(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_hr_employees_csv(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_hr_leave_csv(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_hr_payroll_csv(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_hr_attendance_csv(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_hr_webhook_endpoints(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_hr_webhook_endpoint(UUID, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_hr_webhook_endpoint(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_hr_webhook_deliveries(UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_pay_component(UUID, TEXT, TEXT, pay_component_type, pay_calc_type, NUMERIC, NUMERIC, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_hr_webhook_batch(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_hr_webhook_delivery(UUID, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_hr_webhooks(UUID, TEXT, JSONB, TEXT) TO service_role;

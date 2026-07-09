-- HCM Wave 4: payroll calculation engine, approval workflow, payslips, bank export.

-- ---------------------------------------------------------------------------
-- Defaults
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_pay_components(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO pay_components (organization_id, code, name, component_type, calc_type, default_amount, sort_order)
  SELECT p_org_id, 'transport', 'Transport allowance', 'earning', 'fixed', 0, 10
  WHERE NOT EXISTS (SELECT 1 FROM pay_components WHERE organization_id = p_org_id AND code = 'transport');

  INSERT INTO pay_components (organization_id, code, name, component_type, calc_type, default_amount, sort_order)
  SELECT p_org_id, 'housing', 'Housing allowance', 'earning', 'fixed', 0, 11
  WHERE NOT EXISTS (SELECT 1 FROM pay_components WHERE organization_id = p_org_id AND code = 'housing');

  INSERT INTO pay_components (organization_id, code, name, component_type, calc_type, default_rate, sort_order, gl_account_code)
  SELECT p_org_id, 'pension', 'Pension contribution', 'deduction', 'percent_base', 0.05, 20, '2100'
  WHERE NOT EXISTS (SELECT 1 FROM pay_components WHERE organization_id = p_org_id AND code = 'pension');

  INSERT INTO pay_components (organization_id, code, name, component_type, calc_type, default_rate, sort_order, gl_account_code)
  SELECT p_org_id, 'income_tax', 'Income tax', 'tax', 'percent_gross', 0.15, 30, '2100'
  WHERE NOT EXISTS (SELECT 1 FROM pay_components WHERE organization_id = p_org_id AND code = 'income_tax');
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
END;
$$;

CREATE OR REPLACE FUNCTION public._calc_pay_component_amount(
  p_calc_type pay_calc_type,
  p_base_salary NUMERIC,
  p_gross NUMERIC,
  p_amount NUMERIC,
  p_rate NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_calc_type
    WHEN 'fixed' THEN COALESCE(p_amount, 0)
    WHEN 'percent_base' THEN ROUND(COALESCE(p_base_salary, 0) * COALESCE(p_rate, 0), 2)
    WHEN 'percent_gross' THEN ROUND(COALESCE(p_gross, 0) * COALESCE(p_rate, 0), 2)
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_employee_payroll(
  p_org_id UUID,
  p_employee_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_comp RECORD;
  v_amount NUMERIC;
  v_gross NUMERIC := 0;
  v_allowances NUMERIC := 0;
  v_deductions NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_lines JSONB := '[]'::jsonb;
  v_gross_for_tax NUMERIC;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

  PERFORM public.ensure_default_pay_components(p_org_id);

  v_gross := COALESCE(v_emp.base_salary, 0);
  v_gross_for_tax := v_gross;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'component_code', 'base_salary', 'component_name', 'Base salary',
    'component_type', 'earning', 'amount', v_gross
  ));

  FOR v_comp IN
    SELECT pc.*, epc.amount_override, epc.rate_override, epc.is_active AS emp_active
    FROM pay_components pc
    LEFT JOIN employee_pay_components epc ON epc.component_id = pc.id AND epc.employee_id = p_employee_id
    WHERE pc.organization_id = p_org_id AND pc.is_active = true
    ORDER BY pc.sort_order
  LOOP
    IF v_comp.emp_active = false THEN CONTINUE; END IF;

    v_amount := public._calc_pay_component_amount(
      v_comp.calc_type, v_emp.base_salary, v_gross_for_tax,
      COALESCE(v_comp.amount_override, v_comp.default_amount),
      COALESCE(v_comp.rate_override, v_comp.default_rate)
    );

    IF v_amount = 0 THEN CONTINUE; END IF;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'component_id', v_comp.id, 'component_code', v_comp.code,
      'component_name', v_comp.name, 'component_type', v_comp.component_type, 'amount', v_amount
    ));

    IF v_comp.component_type = 'earning' THEN
      v_allowances := v_allowances + v_amount;
      v_gross_for_tax := v_gross_for_tax + v_amount;
    ELSIF v_comp.component_type = 'deduction' THEN
      v_deductions := v_deductions + v_amount;
    ELSIF v_comp.component_type = 'tax' THEN
      v_tax := v_tax + v_amount;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id,
    'employee_name', v_emp.name,
    'gross', v_gross,
    'allowances', v_allowances,
    'deductions', v_deductions,
    'tax', v_tax,
    'net', v_gross + v_allowances - v_deductions - v_tax,
    'lines', v_lines
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_payroll_preview(
  p_org_id UUID,
  p_employee_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp RECORD;
  v_items JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  FOR v_emp IN
    SELECT id FROM employees
    WHERE organization_id = p_org_id AND status = 'active'
      AND (p_employee_ids IS NULL OR id = ANY(p_employee_ids))
    ORDER BY name
  LOOP
    v_items := v_items || jsonb_build_array(public.calculate_employee_payroll(p_org_id, v_emp.id));
  END LOOP;

  RETURN v_items;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_pay_components(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  PERFORM public.ensure_default_pay_components(p_org_id);
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(pc) ORDER BY pc.sort_order, pc.name), '[]'::jsonb)
    FROM pay_components pc WHERE pc.organization_id = p_org_id AND pc.is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_pay_component(
  p_org_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_component_type pay_component_type DEFAULT 'earning',
  p_calc_type pay_calc_type DEFAULT 'fixed',
  p_default_amount NUMERIC DEFAULT 0,
  p_default_rate NUMERIC DEFAULT 0,
  p_id UUID DEFAULT NULL
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
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_name IS NULL OR v_code IS NULL THEN RAISE EXCEPTION 'Code and name required'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE pay_components SET
      name = v_name, component_type = COALESCE(p_component_type, component_type),
      calc_type = COALESCE(p_calc_type, calc_type),
      default_amount = COALESCE(p_default_amount, default_amount),
      default_rate = COALESCE(p_default_rate, default_rate)
    WHERE id = p_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO pay_components (
      organization_id, code, name, component_type, calc_type, default_amount, default_rate
    ) VALUES (
      p_org_id, v_code, v_name, COALESCE(p_component_type, 'earning'),
      COALESCE(p_calc_type, 'fixed'), COALESCE(p_default_amount, 0), COALESCE(p_default_rate, 0)
    )
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Payroll run lifecycle
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_payroll_draft(
  p_org_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_payment_method payment_method DEFAULT 'bank_transfer',
  p_employee_ids UUID[] DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_emp RECORD;
  v_calc JSONB;
  v_payslip_id UUID;
  v_line JSONB;
  v_sum_gross NUMERIC := 0;
  v_sum_ded NUMERIC := 0;
  v_sum_tax NUMERIC := 0;
  v_sum_net NUMERIC := 0;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_period_end < p_period_start THEN RAISE EXCEPTION 'Invalid period'; END IF;

  INSERT INTO payroll_runs (
    organization_id, period_start, period_end, payment_method, status, created_by, notes
  ) VALUES (
    p_org_id, p_period_start, p_period_end, p_payment_method, 'draft', auth.uid(),
    NULLIF(trim(p_notes), '')
  )
  RETURNING id INTO v_run_id;

  FOR v_emp IN
    SELECT id FROM employees
    WHERE organization_id = p_org_id AND status = 'active'
      AND (p_employee_ids IS NULL OR id = ANY(p_employee_ids))
  LOOP
    v_calc := public.calculate_employee_payroll(p_org_id, v_emp.id);
    IF (v_calc->>'net')::NUMERIC <= 0 AND (v_calc->>'gross')::NUMERIC <= 0 THEN CONTINUE; END IF;

    INSERT INTO payslips (organization_id, run_id, employee_id, gross, allowances, deductions, tax, net)
    VALUES (
      p_org_id, v_run_id, v_emp.id,
      (v_calc->>'gross')::NUMERIC, (v_calc->>'allowances')::NUMERIC,
      (v_calc->>'deductions')::NUMERIC, (v_calc->>'tax')::NUMERIC, (v_calc->>'net')::NUMERIC
    )
    RETURNING id INTO v_payslip_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(v_calc->'lines') LOOP
      INSERT INTO payslip_lines (
        organization_id, payslip_id, component_id, component_code, component_name, component_type, amount
      ) VALUES (
        p_org_id, v_payslip_id, NULLIF(v_line->>'component_id', '')::UUID,
        v_line->>'component_code', v_line->>'component_name',
        (v_line->>'component_type')::pay_component_type, (v_line->>'amount')::NUMERIC
      );
    END LOOP;

    v_sum_gross := v_sum_gross + (v_calc->>'gross')::NUMERIC + (v_calc->>'allowances')::NUMERIC;
    v_sum_ded := v_sum_ded + (v_calc->>'deductions')::NUMERIC;
    v_sum_tax := v_sum_tax + (v_calc->>'tax')::NUMERIC;
    v_sum_net := v_sum_net + (v_calc->>'net')::NUMERIC;
  END LOOP;

  UPDATE payroll_runs SET
    total_gross = v_sum_gross, total_deductions = v_sum_ded,
    total_tax = v_sum_tax, total_net = v_sum_net
  WHERE id = v_run_id;

  PERFORM public.hr_write_audit_log(p_org_id, 'payroll_run', v_run_id, 'draft_created', NULL,
    jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end));

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_payroll_run(p_run_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run payroll_runs%ROWTYPE;
  v_wf_id UUID;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  IF NOT public.user_can_manage_hr(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'Only draft runs can be submitted'; END IF;

  UPDATE payroll_runs SET status = 'pending_approval' WHERE id = p_run_id;

  PERFORM public.ensure_default_hr_workflows(v_run.organization_id);
  v_wf_id := public._start_workflow(v_run.organization_id, 'payroll_run', p_run_id, 'payroll_default');

  RETURN p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_payroll_run(p_run_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run payroll_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  IF NOT public.user_can_manage_hr(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status NOT IN ('pending_approval', 'draft') THEN
    RAISE EXCEPTION 'Run cannot be approved in status %', v_run.status;
  END IF;

  UPDATE payroll_runs SET
    status = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = p_run_id;
END;
$$;

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
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  IF NOT public.user_can_manage_hr(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status = 'posted' THEN RETURN p_run_id; END IF;
  IF v_run.status NOT IN ('approved', 'draft') THEN
    RAISE EXCEPTION 'Payroll must be approved before posting (current: %)', v_run.status;
  END IF;

  PERFORM public.ensure_default_accounts(v_run.organization_id);

  v_pay_acct := CASE v_run.payment_method
    WHEN 'cash' THEN public.account_id_by_code(v_run.organization_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(v_run.organization_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(v_run.organization_id, '1020')
    ELSE public.account_id_by_code(v_run.organization_id, '1010')
  END;

  v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
    'accountId', public.account_id_by_code(v_run.organization_id, '6400'),
    'debit', v_run.total_gross, 'credit', 0, 'description', 'Payroll gross'));

  IF (v_run.total_tax + v_run.total_deductions) > 0 THEN
    v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_run.organization_id, '2100'),
      'debit', 0, 'credit', v_run.total_tax + v_run.total_deductions, 'description', 'Payroll tax & deductions'));
  END IF;

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

  RETURN p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_payroll_run(p_run_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run payroll_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  IF NOT public.user_can_manage_hr(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status = 'posted' THEN RAISE EXCEPTION 'Cannot cancel a posted payroll run'; END IF;
  UPDATE payroll_runs SET status = 'cancelled' WHERE id = p_run_id;
END;
$$;

-- Backward-compatible: calculate + create + post in one step
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
  v_line JSONB;
  v_emp_id UUID;
BEGIN
  IF NOT public.user_can_manage_hr(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  -- Manual lines path (legacy UI fallback)
  IF p_lines IS NOT NULL AND jsonb_array_length(p_lines) > 0 THEN
  INSERT INTO payroll_runs (organization_id, period_start, period_end, payment_method, status, created_by)
  VALUES (p_org_id, p_period_start, p_period_end, p_payment_method, 'draft', auth.uid())
  RETURNING id INTO v_run_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_emp_id := (v_line->>'employeeId')::UUID;
    IF NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = v_emp_id AND e.organization_id = p_org_id) THEN
      RAISE EXCEPTION 'Invalid employee in payroll lines';
    END IF;
    INSERT INTO payslips (organization_id, run_id, employee_id, gross, allowances, deductions, tax, net)
    VALUES (
      p_org_id, v_run_id, v_emp_id,
      COALESCE((v_line->>'gross')::NUMERIC, 0), COALESCE((v_line->>'allowances')::NUMERIC, 0),
      COALESCE((v_line->>'deductions')::NUMERIC, 0), COALESCE((v_line->>'tax')::NUMERIC, 0),
      COALESCE((v_line->>'gross')::NUMERIC, 0) + COALESCE((v_line->>'allowances')::NUMERIC, 0)
        - COALESCE((v_line->>'deductions')::NUMERIC, 0) - COALESCE((v_line->>'tax')::NUMERIC, 0)
    );
  END LOOP;

  UPDATE payroll_runs pr SET
    total_gross = (SELECT COALESCE(SUM(gross + allowances), 0) FROM payslips WHERE run_id = v_run_id),
    total_deductions = (SELECT COALESCE(SUM(deductions), 0) FROM payslips WHERE run_id = v_run_id),
    total_tax = (SELECT COALESCE(SUM(tax), 0) FROM payslips WHERE run_id = v_run_id),
    total_net = (SELECT COALESCE(SUM(net), 0) FROM payslips WHERE run_id = v_run_id)
  WHERE pr.id = v_run_id;

  PERFORM public.approve_payroll_run(v_run_id);
  RETURN public.post_payroll_run(v_run_id);
  END IF;

  v_run_id := public.create_payroll_draft(p_org_id, p_period_start, p_period_end, p_payment_method, NULL, NULL);
  PERFORM public.approve_payroll_run(v_run_id);
  RETURN public.post_payroll_run(v_run_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_payroll_run_detail(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run payroll_runs%ROWTYPE;
  v_payslips JSONB;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;

  IF NOT public.user_can_manage_hr(v_run.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM payslips ps
       WHERE ps.run_id = p_run_id AND ps.employee_id = public.my_employee_id(v_run.organization_id)
     ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ps.id, 'employee_id', ps.employee_id, 'employee_name', e.name,
    'gross', ps.gross, 'allowances', ps.allowances, 'deductions', ps.deductions,
    'tax', ps.tax, 'net', ps.net,
    'lines', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'component_name', pl.component_name, 'component_type', pl.component_type, 'amount', pl.amount
      ) ORDER BY pl.component_type, pl.component_name), '[]'::jsonb)
      FROM payslip_lines pl WHERE pl.payslip_id = ps.id
    )
  ) ORDER BY e.name), '[]'::jsonb) INTO v_payslips
  FROM payslips ps
  JOIN employees e ON e.id = ps.employee_id
  WHERE ps.run_id = p_run_id
    AND (
      public.user_can_manage_hr(v_run.organization_id)
      OR ps.employee_id = public.my_employee_id(v_run.organization_id)
    );

  RETURN jsonb_build_object(
    'run', jsonb_build_object(
      'id', v_run.id, 'period_start', v_run.period_start, 'period_end', v_run.period_end,
      'status', v_run.status, 'payment_method', v_run.payment_method,
      'total_gross', v_run.total_gross, 'total_deductions', v_run.total_deductions,
      'total_tax', v_run.total_tax, 'total_net', v_run.total_net,
      'approved_at', v_run.approved_at, 'posted_at', v_run.posted_at, 'notes', v_run.notes
    ),
    'payslips', v_payslips,
    'can_manage', public.user_can_manage_hr(v_run.organization_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_payslips(p_org_id UUID, p_limit INT DEFAULT 12)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id UUID;
BEGIN
  IF NOT public.user_has_hr_app_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_emp_id := public.my_employee_id(p_org_id);
  IF v_emp_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.period_end DESC), '[]'::jsonb)
    FROM (
      SELECT ps.id, ps.run_id, pr.period_start, pr.period_end, pr.status AS run_status,
        ps.gross, ps.allowances, ps.deductions, ps.tax, ps.net, ps.created_at
      FROM payslips ps
      JOIN payroll_runs pr ON pr.id = ps.run_id
      WHERE ps.organization_id = p_org_id AND ps.employee_id = v_emp_id
        AND pr.status = 'posted'
      ORDER BY pr.period_end DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 12), 50))
    ) x
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.export_payroll_bank_file(p_run_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run payroll_runs%ROWTYPE;
  v_csv TEXT := 'employee_name,bank_account,net_amount,payment_method' || E'\n';
  v_row RECORD;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  IF NOT public.user_can_manage_hr(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status <> 'posted' THEN RAISE EXCEPTION 'Payroll must be posted before bank export'; END IF;

  FOR v_row IN
    SELECT e.name, COALESCE(ep.bank_account_number, '') AS bank_account, ps.net
    FROM payslips ps
    JOIN employees e ON e.id = ps.employee_id
    LEFT JOIN employee_profiles ep ON ep.employee_id = e.id
    WHERE ps.run_id = p_run_id
    ORDER BY e.name
  LOOP
    v_csv := v_csv || format('%s,%s,%s,%s', v_row.name, v_row.bank_account, v_row.net, v_run.payment_method) || E'\n';
  END LOOP;

  RETURN v_csv;
END;
$$;

-- Extend workflow approval for payroll runs
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
    PERFORM public.ensure_default_pay_components(v_org);
    PERFORM public.ensure_default_hr_workflows(v_org);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_payroll_preview(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pay_components(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_pay_component(UUID, TEXT, TEXT, pay_component_type, pay_calc_type, NUMERIC, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_payroll_draft(UUID, DATE, DATE, payment_method, UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_payroll_run(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payroll_run(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_payroll_run(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_payroll_run(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_run_detail(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_payslips(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_payroll_bank_file(UUID) TO authenticated;

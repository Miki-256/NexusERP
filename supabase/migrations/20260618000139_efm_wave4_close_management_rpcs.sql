-- EFM Wave 4 — Close management RPCs (requires 00138 schema)

-- ---------------------------------------------------------------------------
-- Subledger lock guard (AR/AP/POS writes during close prep)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_subledgers_open_for_date(p_org_id UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT fp.name INTO v_name
  FROM fiscal_periods fp
  WHERE fp.organization_id = p_org_id
    AND p_date BETWEEN fp.start_date AND fp.end_date
    AND fp.subledgers_locked = true
    AND fp.status = 'open'::fiscal_period_status
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'Subledgers are locked for close preparation (%). Complete or cancel the close checklist first.', v_name;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Default checklist templates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_close_checklist(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO close_checklist_templates (
    organization_id, task_code, label, module, description, is_blocking, sort_order
  ) VALUES
    (p_org_id, 'unposted_sales', 'Unposted POS sales', 'pos',
     'Completed sales in this period without a ledger entry', true, 10),
    (p_org_id, 'ledger_queue', 'Ledger post queue', 'pos',
     'Sales waiting in the async ledger posting queue', true, 20),
    (p_org_id, 'draft_journals', 'Draft journal entries', 'gl',
     'Manual journal drafts dated in this period', true, 30),
    (p_org_id, 'unreconciled_bank', 'Unreconciled bank lines', 'bank',
     'Bank statement lines through period end not yet reconciled', true, 40),
    (p_org_id, 'pending_payment_runs', 'Pending AP payment runs', 'ap',
     'Payment runs still in draft or approved status', true, 50),
    (p_org_id, 'trial_balance', 'Trial balance', 'gl',
     'Debits must equal credits as of period end', true, 60),
    (p_org_id, 'subledgers_lock', 'Lock subledgers', 'close',
     'Freeze AR/AP/POS postings for this period before GL close', true, 70),
    (p_org_id, 'draft_ar_invoices', 'Draft AR invoices', 'ar',
     'Customer invoices still in draft for this period', false, 80),
    (p_org_id, 'draft_ap_bills', 'Draft AP bills', 'ap',
     'Vendor bills still in draft for this period', false, 90)
  ON CONFLICT (organization_id, task_code) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_close_checklist(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Auto-scan a single close task
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._scan_close_task(
  p_org_id UUID,
  p_period fiscal_periods,
  p_task_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_debit NUMERIC := 0;
  v_credit NUMERIC := 0;
  v_diff NUMERIC := 0;
  v_status TEXT := 'passing';
  v_metric_label TEXT;
BEGIN
  CASE p_task_code
    WHEN 'unposted_sales' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM sales s
      WHERE s.organization_id = p_org_id
        AND s.status = 'completed'
        AND s.created_at::date BETWEEN p_period.start_date AND p_period.end_date
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.organization_id = s.organization_id
            AND je.source_type = 'sale' AND je.source_id = s.id
        );
      v_metric_label := 'unposted sales';
      IF v_count > 0 THEN v_status := 'blocked'; END IF;

    WHEN 'ledger_queue' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM sale_ledger_post_queue q
      JOIN sales s ON s.id = q.sale_id
      WHERE q.organization_id = p_org_id
        AND s.created_at::date BETWEEN p_period.start_date AND p_period.end_date;
      v_metric_label := 'queued sales';
      IF v_count > 0 THEN v_status := 'blocked'; END IF;

    WHEN 'draft_journals' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM journal_entries je
      WHERE je.organization_id = p_org_id
        AND je.entry_status = 'draft'::journal_entry_status
        AND je.entry_date BETWEEN p_period.start_date AND p_period.end_date;
      v_metric_label := 'draft entries';
      IF v_count > 0 THEN v_status := 'blocked'; END IF;

    WHEN 'unreconciled_bank' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM bank_statement_lines bsl
      JOIN bank_statements bs ON bs.id = bsl.statement_id
      JOIN bank_accounts ba ON ba.id = bs.bank_account_id
      WHERE ba.organization_id = p_org_id
        AND bsl.line_date <= p_period.end_date
        AND bsl.reconciled = false;
      v_metric_label := 'unreconciled lines';
      IF v_count > 0 THEN v_status := 'blocked'; END IF;

    WHEN 'pending_payment_runs' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM ap_payment_runs pr
      WHERE pr.organization_id = p_org_id
        AND pr.status IN ('draft', 'approved')
        AND pr.run_date <= p_period.end_date;
      v_metric_label := 'pending runs';
      IF v_count > 0 THEN v_status := 'blocked'; END IF;

    WHEN 'trial_balance' THEN
      SELECT COALESCE(SUM(tb.debit), 0), COALESCE(SUM(tb.credit), 0)
      INTO v_debit, v_credit
      FROM public.trial_balance(p_org_id, p_period.end_date) tb;
      v_diff := abs(v_debit - v_credit);
      v_count := CASE WHEN v_diff > 0.01 THEN 1 ELSE 0 END;
      v_metric_label := 'debit/credit variance';
      IF v_count > 0 THEN
        v_status := 'blocked';
      ELSE
        v_count := 0;
      END IF;
      RETURN jsonb_build_object(
        'status', v_status,
        'metric_value', v_diff,
        'metric_label', v_metric_label,
        'details', jsonb_build_object('total_debit', v_debit, 'total_credit', v_credit)
      );

    WHEN 'subledgers_lock' THEN
      IF p_period.subledgers_locked THEN
        v_status := 'complete';
        v_count := 0;
        v_metric_label := 'locked';
      ELSE
        v_status := 'blocked';
        v_count := 1;
        v_metric_label := 'not locked';
      END IF;

    WHEN 'draft_ar_invoices' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM customer_invoices ci
      WHERE ci.organization_id = p_org_id
        AND ci.status = 'draft'::invoice_status
        AND ci.invoice_date BETWEEN p_period.start_date AND p_period.end_date;
      v_metric_label := 'draft invoices';
      IF v_count > 0 THEN v_status := 'blocked'; ELSE v_status := 'passing'; END IF;

    WHEN 'draft_ap_bills' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM vendor_bills vb
      WHERE vb.organization_id = p_org_id
        AND vb.status = 'draft'::bill_status
        AND vb.bill_date BETWEEN p_period.start_date AND p_period.end_date;
      v_metric_label := 'draft bills';
      IF v_count > 0 THEN v_status := 'blocked'; ELSE v_status := 'passing'; END IF;

    ELSE
      v_status := 'pending';
      v_metric_label := 'unknown';
  END CASE;

  RETURN jsonb_build_object(
    'status', v_status,
    'metric_value', v_count,
    'metric_label', v_metric_label,
    'details', '{}'::jsonb
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Refresh run progress from scans
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._refresh_period_close_run(p_run_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run period_close_runs%ROWTYPE;
  v_period fiscal_periods%ROWTYPE;
  v_task RECORD;
  v_scan JSONB;
  v_blocking INT := 0;
  v_blocking_done INT := 0;
  v_progress INT := 0;
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_run FROM period_close_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Close run not found';
  END IF;
  IF NOT public.user_can_manage(v_run.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_run.status IN ('closed', 'cancelled') THEN
    RETURN;
  END IF;

  SELECT * INTO v_period FROM fiscal_periods WHERE id = v_run.period_id;

  FOR v_task IN
    SELECT * FROM period_close_tasks WHERE run_id = p_run_id ORDER BY task_code
  LOOP
    IF v_task.status = 'waived' THEN
      IF v_task.is_blocking THEN
        v_blocking := v_blocking + 1;
        v_blocking_done := v_blocking_done + 1;
      END IF;
      CONTINUE;
    END IF;

    IF v_task.task_code = 'subledgers_lock' AND v_period.subledgers_locked THEN
      UPDATE period_close_tasks
      SET status = 'complete', metric_value = 0, metric_label = 'locked',
          completed_at = COALESCE(completed_at, now()), updated_at = now()
      WHERE id = v_task.id;
      IF v_task.is_blocking THEN
        v_blocking := v_blocking + 1;
        v_blocking_done := v_blocking_done + 1;
      END IF;
      CONTINUE;
    END IF;

    v_scan := public._scan_close_task(v_run.organization_id, v_period, v_task.task_code);

    UPDATE period_close_tasks
    SET status = v_scan->>'status',
        metric_value = (v_scan->>'metric_value')::NUMERIC,
        metric_label = v_scan->>'metric_label',
        details = COALESCE(v_scan->'details', '{}'::jsonb),
        completed_at = CASE
          WHEN v_scan->>'status' IN ('passing', 'complete') THEN COALESCE(completed_at, now())
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = v_task.id;

    IF v_task.is_blocking THEN
      v_blocking := v_blocking + 1;
      IF v_scan->>'status' IN ('passing', 'complete', 'waived') THEN
        v_blocking_done := v_blocking_done + 1;
      END IF;
    END IF;
  END LOOP;

  IF v_blocking > 0 THEN
    v_progress := LEAST(100, GREATEST(0, round((v_blocking_done::NUMERIC / v_blocking) * 100)));
  ELSE
    v_progress := 100;
  END IF;

  v_new_status := CASE WHEN v_blocking_done = v_blocking AND v_blocking > 0 THEN 'ready' ELSE 'in_progress' END;

  UPDATE period_close_runs
  SET progress_pct = v_progress,
      status = v_new_status,
      completed_at = CASE WHEN v_new_status = 'ready' THEN COALESCE(completed_at, now()) ELSE NULL END
  WHERE id = p_run_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Start close checklist for a period
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_period_close(p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period fiscal_periods%ROWTYPE;
  v_run_id UUID;
  v_tpl RECORD;
BEGIN
  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiscal period not found'; END IF;
  IF NOT public.user_can_manage(v_period.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_period.status = 'closed'::fiscal_period_status THEN
    RAISE EXCEPTION 'Period is already closed';
  END IF;

  PERFORM public.ensure_default_close_checklist(v_period.organization_id);

  SELECT id INTO v_run_id FROM period_close_runs WHERE period_id = p_period_id;
  IF v_run_id IS NULL THEN
    INSERT INTO period_close_runs (organization_id, period_id, started_by)
    VALUES (v_period.organization_id, p_period_id, auth.uid())
    RETURNING id INTO v_run_id;

    FOR v_tpl IN
      SELECT * FROM close_checklist_templates
      WHERE organization_id = v_period.organization_id AND is_active = true
      ORDER BY sort_order, task_code
    LOOP
      INSERT INTO period_close_tasks (
        run_id, organization_id, task_code, label, module, is_blocking
      ) VALUES (
        v_run_id, v_period.organization_id, v_tpl.task_code, v_tpl.label, v_tpl.module, v_tpl.is_blocking
      );
    END LOOP;

    UPDATE fiscal_periods SET close_run_id = v_run_id WHERE id = p_period_id;
  END IF;

  PERFORM public._refresh_period_close_run(v_run_id);
  RETURN public.get_period_close_status(p_period_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_period_close(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Get close status for a period
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_period_close_status(p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period fiscal_periods%ROWTYPE;
  v_run period_close_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiscal period not found'; END IF;
  IF NOT public.user_has_org_access(v_period.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT * INTO v_run FROM period_close_runs WHERE period_id = p_period_id;

  RETURN jsonb_build_object(
    'period_id', p_period_id,
    'period_name', v_period.name,
    'period_status', v_period.status,
    'subledgers_locked', v_period.subledgers_locked,
    'subledgers_locked_at', v_period.subledgers_locked_at,
    'run', CASE WHEN v_run.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_run.id,
      'status', v_run.status,
      'progress_pct', v_run.progress_pct,
      'started_at', v_run.started_at,
      'completed_at', v_run.completed_at,
      'subledgers_locked_at', v_run.subledgers_locked_at
    ) END,
    'tasks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'task_code', t.task_code,
          'label', t.label,
          'module', t.module,
          'is_blocking', t.is_blocking,
          'status', t.status,
          'metric_value', t.metric_value,
          'metric_label', t.metric_label,
          'details', t.details,
          'waive_note', t.waive_note,
          'waived_at', t.waived_at
        ) ORDER BY (
          SELECT sort_order FROM close_checklist_templates cct
          WHERE cct.organization_id = t.organization_id AND cct.task_code = t.task_code
        ), t.task_code
      )
      FROM period_close_tasks t
      WHERE t.run_id = v_run.id
    ), '[]'::jsonb),
    'blockers', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'task_code', t.task_code,
          'label', t.label,
          'metric_value', t.metric_value,
          'metric_label', t.metric_label
        )
      )
      FROM period_close_tasks t
      WHERE t.run_id = v_run.id
        AND t.is_blocking = true
        AND t.status = 'blocked'
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_period_close_status(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Preflight / refresh
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_period_close_preflight(p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
BEGIN
  SELECT (public.start_period_close(p_period_id)->'run'->>'id')::UUID INTO v_run_id;
  IF v_run_id IS NULL THEN
    SELECT id INTO v_run_id FROM period_close_runs WHERE period_id = p_period_id;
  END IF;
  IF v_run_id IS NOT NULL THEN
    PERFORM public._refresh_period_close_run(v_run_id);
  END IF;
  RETURN public.get_period_close_status(p_period_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_period_close_preflight(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_period_close_run(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
BEGIN
  PERFORM public._refresh_period_close_run(p_run_id);
  SELECT period_id INTO v_period_id FROM period_close_runs WHERE id = p_run_id;
  RETURN public.get_period_close_status(v_period_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.refresh_period_close_run(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Waive a blocking task (manager discretion)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.waive_period_close_task(
  p_run_id UUID,
  p_task_code TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run period_close_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM period_close_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Close run not found'; END IF;
  IF NOT public.user_can_manage(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'Close run is no longer active';
  END IF;
  IF p_task_code IN ('trial_balance', 'subledgers_lock') THEN
    RAISE EXCEPTION 'Task % cannot be waived', p_task_code;
  END IF;

  UPDATE period_close_tasks
  SET status = 'waived',
      waived_by = auth.uid(),
      waived_at = now(),
      waive_note = NULLIF(trim(p_note), ''),
      updated_at = now()
  WHERE run_id = p_run_id AND task_code = p_task_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found on this close run';
  END IF;

  PERFORM public._refresh_period_close_run(p_run_id);
  RETURN public.get_period_close_status(v_run.period_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.waive_period_close_task(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Lock subledgers for close prep
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_period_subledgers(p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period fiscal_periods%ROWTYPE;
  v_run_id UUID;
BEGIN
  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiscal period not found'; END IF;
  IF NOT public.user_can_manage(v_period.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_period.status = 'closed'::fiscal_period_status THEN
    RAISE EXCEPTION 'Period is already closed';
  END IF;

  UPDATE fiscal_periods
  SET subledgers_locked = true,
      subledgers_locked_at = now()
  WHERE id = p_period_id;

  SELECT id INTO v_run_id FROM period_close_runs WHERE period_id = p_period_id;
  IF v_run_id IS NOT NULL THEN
    UPDATE period_close_runs
    SET subledgers_locked_at = now(),
        subledgers_locked_by = auth.uid()
    WHERE id = v_run_id;
    PERFORM public._refresh_period_close_run(v_run_id);
  END IF;

  RETURN public.get_period_close_status(p_period_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.lock_period_subledgers(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- list_fiscal_periods — include close metadata
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_fiscal_periods(p_org_id UUID, p_year INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM current_date)::INT);
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'year', v_year,
    'lock_date', (SELECT accounting_lock_date FROM organizations WHERE id = p_org_id),
    'periods', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', fp.id,
          'period_no', fp.period_no,
          'name', fp.name,
          'start_date', fp.start_date,
          'end_date', fp.end_date,
          'status', fp.status,
          'closed_at', fp.closed_at,
          'closing_entry_id', fp.closing_entry_id,
          'subledgers_locked', fp.subledgers_locked,
          'subledgers_locked_at', fp.subledgers_locked_at,
          'close_run_id', fp.close_run_id,
          'close_run_status', pcr.status,
          'close_progress_pct', pcr.progress_pct
        ) ORDER BY fp.period_no
      )
      FROM fiscal_periods fp
      JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
      LEFT JOIN period_close_runs pcr ON pcr.id = fp.close_run_id
      WHERE fp.organization_id = p_org_id AND fy.year = v_year
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_fiscal_periods(UUID, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- close_fiscal_period — enforce checklist when a close run exists
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_fiscal_period(p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period fiscal_periods%ROWTYPE;
  v_run period_close_runs%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_re_acct UUID;
  v_row RECORD;
  v_income_total NUMERIC := 0;
  v_expense_total NUMERIC := 0;
  v_entry_id UUID;
  v_net NUMERIC;
  v_blockers INT;
BEGIN
  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period not found';
  END IF;
  IF NOT public.user_can_manage(v_period.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_period.status = 'closed'::fiscal_period_status THEN
    RETURN jsonb_build_object('already_closed', true, 'period_id', p_period_id);
  END IF;

  SELECT * INTO v_run FROM period_close_runs WHERE period_id = p_period_id;
  IF v_run.id IS NOT NULL AND v_run.status NOT IN ('ready', 'closed') THEN
    PERFORM public._refresh_period_close_run(v_run.id);
    SELECT * INTO v_run FROM period_close_runs WHERE id = v_run.id;
    IF v_run.status <> 'ready' THEN
      SELECT COUNT(*)::INT INTO v_blockers
      FROM period_close_tasks
      WHERE run_id = v_run.id AND is_blocking = true AND status = 'blocked';
      RAISE EXCEPTION 'Close checklist incomplete (% blocking item(s)). Run preflight and resolve blockers first.', v_blockers;
    END IF;
  END IF;

  PERFORM public.ensure_default_accounts(v_period.organization_id);
  v_re_acct := public.account_id_by_code(v_period.organization_id, '3900');

  FOR v_row IN
    SELECT a.id AS account_id, a.code,
      COALESCE(SUM(jel.credit - jel.debit), 0) AS net_income
    FROM accounts a
    JOIN journal_entry_lines jel ON jel.account_id = a.id
    JOIN journal_entries je ON je.id = jel.entry_id
    WHERE a.organization_id = v_period.organization_id
      AND a.type = 'income'::account_type
      AND je.entry_date BETWEEN v_period.start_date AND v_period.end_date
      AND public._je_is_posted(je.entry_status)
    GROUP BY a.id, a.code
    HAVING COALESCE(SUM(jel.credit - jel.debit), 0) <> 0
  LOOP
    IF v_row.net_income > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_row.account_id,
        'debit', v_row.net_income, 'credit', 0,
        'description', 'Close revenue — ' || v_period.name));
      v_income_total := v_income_total + v_row.net_income;
    ELSIF v_row.net_income < 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_row.account_id,
        'debit', 0, 'credit', abs(v_row.net_income),
        'description', 'Close revenue — ' || v_period.name));
      v_income_total := v_income_total + v_row.net_income;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT a.id AS account_id, a.code,
      COALESCE(SUM(jel.debit - jel.credit), 0) AS net_expense
    FROM accounts a
    JOIN journal_entry_lines jel ON jel.account_id = a.id
    JOIN journal_entries je ON je.id = jel.entry_id
    WHERE a.organization_id = v_period.organization_id
      AND a.type = 'expense'::account_type
      AND je.entry_date BETWEEN v_period.start_date AND v_period.end_date
      AND public._je_is_posted(je.entry_status)
    GROUP BY a.id, a.code
    HAVING COALESCE(SUM(jel.debit - jel.credit), 0) <> 0
  LOOP
    IF v_row.net_expense > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_row.account_id,
        'debit', 0, 'credit', v_row.net_expense,
        'description', 'Close expense — ' || v_period.name));
      v_expense_total := v_expense_total + v_row.net_expense;
    ELSIF v_row.net_expense < 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_row.account_id,
        'debit', abs(v_row.net_expense), 'credit', 0,
        'description', 'Close expense — ' || v_period.name));
      v_expense_total := v_expense_total + v_row.net_expense;
    END IF;
  END LOOP;

  v_net := v_income_total - v_expense_total;

  IF abs(v_net) > 0.01 THEN
    IF v_net > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_re_acct,
        'debit', 0, 'credit', v_net,
        'description', 'Net income to retained earnings'));
    ELSE
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_re_acct,
        'debit', abs(v_net), 'credit', 0,
        'description', 'Net loss to retained earnings'));
    END IF;
  END IF;

  IF jsonb_array_length(v_lines) > 0 THEN
    v_entry_id := public._post_journal_entry_balanced(
      v_period.organization_id, 'GEN', v_period.end_date,
      'Period close — ' || v_period.name,
      'period_close', p_period_id, v_lines, auth.uid(), 'posted'::journal_entry_status
    );
  END IF;

  UPDATE fiscal_periods
  SET status = 'closed'::fiscal_period_status,
      closed_at = now(),
      closed_by = auth.uid(),
      closing_entry_id = v_entry_id,
      subledgers_locked = false,
      subledgers_locked_at = NULL
  WHERE id = p_period_id;

  IF v_run.id IS NOT NULL THEN
    UPDATE period_close_runs
    SET status = 'closed', completed_at = now(), progress_pct = 100
    WHERE id = v_run.id;
  END IF;

  PERFORM public._refresh_accounting_lock_date(v_period.organization_id);

  RETURN jsonb_build_object(
    'period_id', p_period_id,
    'closing_entry_id', v_entry_id,
    'net_transferred', v_net,
    'lock_date', (SELECT accounting_lock_date FROM organizations WHERE id = v_period.organization_id)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.close_fiscal_period(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- reopen_fiscal_period — reset close run + subledger lock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_fiscal_period(p_period_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period fiscal_periods%ROWTYPE;
  v_latest_closed UUID;
  v_closing_id UUID;
  v_run_id UUID;
BEGIN
  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period not found';
  END IF;
  IF NOT public.user_can_manage(v_period.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_period.status <> 'closed'::fiscal_period_status THEN
    RAISE EXCEPTION 'Period is not closed';
  END IF;

  SELECT fp.id INTO v_latest_closed
  FROM fiscal_periods fp
  WHERE fp.organization_id = v_period.organization_id
    AND fp.status = 'closed'::fiscal_period_status
  ORDER BY fp.end_date DESC
  LIMIT 1;

  IF v_latest_closed IS DISTINCT FROM p_period_id THEN
    RAISE EXCEPTION 'Only the most recently closed period can be reopened';
  END IF;

  v_closing_id := v_period.closing_entry_id;

  IF v_closing_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.id = v_closing_id
        AND je.organization_id = v_period.organization_id
        AND je.source_type = 'period_close'
        AND je.source_id = p_period_id
    ) THEN
      RAISE EXCEPTION 'Closing journal entry mismatch — cannot reopen safely';
    END IF;
  END IF;

  UPDATE fiscal_periods
  SET status = 'open'::fiscal_period_status,
      closed_at = NULL,
      closed_by = NULL,
      closing_entry_id = NULL,
      subledgers_locked = false,
      subledgers_locked_at = NULL
  WHERE id = p_period_id;

  IF v_closing_id IS NOT NULL THEN
    DELETE FROM journal_entry_lines WHERE entry_id = v_closing_id;
    DELETE FROM journal_entries WHERE id = v_closing_id;
  END IF;

  SELECT id INTO v_run_id FROM period_close_runs WHERE period_id = p_period_id;
  IF v_run_id IS NOT NULL THEN
    DELETE FROM period_close_runs WHERE id = v_run_id;
    UPDATE fiscal_periods SET close_run_id = NULL WHERE id = p_period_id;
  END IF;

  PERFORM public._refresh_accounting_lock_date(v_period.organization_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.reopen_fiscal_period(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Subledger lock on AR/AP entry points
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_customer_invoice(p_invoice_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_entry_id UUID;
  v_net NUMERIC;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_inv.status <> 'draft' THEN RAISE EXCEPTION 'Invoice is not draft'; END IF;

  PERFORM public._assert_subledgers_open_for_date(v_inv.organization_id, v_inv.invoice_date);
  PERFORM public._assert_customer_credit_limit(v_inv.organization_id, v_inv.customer_id, v_inv.total);

  PERFORM public.ensure_default_accounts(v_inv.organization_id);
  v_net := v_inv.subtotal;

  v_entry_id := public.post_journal_entry(
    v_inv.organization_id, 'INV', v_inv.invoice_date,
    'Invoice ' || v_inv.invoice_no, 'invoice', p_invoice_id,
    jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '1100'),
        'debit', v_inv.total, 'credit', 0, 'description', 'Accounts receivable'),
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '4000'),
        'debit', 0, 'credit', v_net, 'description', 'Sales revenue'),
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '2100'),
        'debit', 0, 'credit', v_inv.tax_amount, 'description', 'Tax payable')
    )
  );

  UPDATE customer_invoices
  SET status = 'posted', journal_entry_id = v_entry_id, collection_status = 'open'
  WHERE id = p_invoice_id;

  RETURN v_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_vendor_bill(
  p_org_id UUID,
  p_vendor_id UUID,
  p_bill_no TEXT DEFAULT NULL,
  p_bill_date DATE DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_memo TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill_id UUID;
  v_line JSONB;
  v_total NUMERIC := 0;
  v_line_amt NUMERIC;
  v_hash TEXT;
  v_terms INT;
  v_due DATE;
  v_bill_date DATE := COALESCE(p_bill_date, current_date);
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  PERFORM public._assert_subledgers_open_for_date(p_org_id, v_bill_date);
  IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = p_vendor_id AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'Vendor not found';
  END IF;
  IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one line is required';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_amt := COALESCE((v_line->>'amount')::NUMERIC, 0);
    IF v_line_amt <= 0 THEN RAISE EXCEPTION 'Line amount must be positive'; END IF;
    v_total := v_total + v_line_amt;
  END LOOP;

  v_hash := public._vendor_bill_duplicate_hash(p_vendor_id, v_bill_date, v_total, p_bill_no);

  IF EXISTS (
    SELECT 1 FROM vendor_bills
    WHERE organization_id = p_org_id AND duplicate_hash = v_hash AND status <> 'draft'::bill_status
  ) THEN
    RAISE EXCEPTION 'Duplicate vendor bill detected for this vendor, date, and amount';
  END IF;

  SELECT payment_terms_days INTO v_terms FROM vendors WHERE id = p_vendor_id;
  v_due := COALESCE(p_due_date, v_bill_date + COALESCE(v_terms, 30));

  INSERT INTO vendor_bills (
    organization_id, vendor_id, bill_no, bill_date, due_date, amount, status,
    match_status, duplicate_hash, memo, source_type
  ) VALUES (
    p_org_id, p_vendor_id, NULLIF(trim(p_bill_no), ''), v_bill_date, v_due,
    v_total, 'draft'::bill_status, 'standalone', v_hash, NULLIF(trim(p_memo), ''), 'manual'
  ) RETURNING id INTO v_bill_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO vendor_bill_lines (bill_id, organization_id, description, amount, account_id)
    VALUES (
      v_bill_id, p_org_id,
      COALESCE(v_line->>'description', 'Line item'),
      (v_line->>'amount')::NUMERIC,
      NULLIF(v_line->>'accountId', '')::UUID
    );
  END LOOP;

  RETURN v_bill_id;
END;
$$;

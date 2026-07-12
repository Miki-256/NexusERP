-- EFM Wave 14 — Financial security RPCs (requires 00158 schema)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._je_entry_total(p_entry_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(jel.debit), 0)
  FROM journal_entry_lines jel
  WHERE jel.entry_id = p_entry_id;
$$;

CREATE OR REPLACE FUNCTION public._financial_dual_approval_required(
  p_org_id UUID,
  p_entity_type TEXT,
  p_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_entity_type = 'journal_entry' THEN
    IF NOT COALESCE(v_org.je_dual_approval_enabled, false) THEN RETURN false; END IF;
    IF v_org.je_dual_approval_threshold IS NULL THEN RETURN true; END IF;
    RETURN COALESCE(p_amount, 0) >= v_org.je_dual_approval_threshold;
  ELSIF p_entity_type = 'payment_run' THEN
    IF NOT COALESCE(v_org.ap_dual_approval_enabled, false) THEN RETURN false; END IF;
    IF v_org.ap_dual_approval_threshold IS NULL THEN RETURN true; END IF;
    RETURN COALESCE(p_amount, 0) >= v_org.ap_dual_approval_threshold;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public._assert_sod_no_conflict(
  p_org_id UUID,
  p_action_create TEXT,
  p_action_approve TEXT,
  p_creator_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule sod_conflict_rules%ROWTYPE;
  v_enforced BOOLEAN;
BEGIN
  SELECT COALESCE(sod_enforcement_enabled, true) INTO v_enforced
  FROM organizations WHERE id = p_org_id;

  IF NOT COALESCE(v_enforced, true) THEN RETURN; END IF;
  IF p_creator_id IS NULL OR auth.uid() IS NULL THEN RETURN; END IF;
  IF p_creator_id <> auth.uid() THEN RETURN; END IF;

  SELECT * INTO v_rule
  FROM sod_conflict_rules
  WHERE organization_id = p_org_id
    AND action_create = p_action_create
    AND action_approve = p_action_approve
    AND is_active = true
    AND block_same_user = true
  LIMIT 1;

  IF FOUND AND v_rule.severity = 'block' THEN
    RAISE EXCEPTION 'Segregation of duties violation: creator cannot perform %', p_action_approve;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._financial_approval_steps_json(
  p_entity_type TEXT,
  p_entity_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'step_order', s.step_order,
      'approver_id', s.approver_id,
      'approved_at', s.approved_at,
      'notes', s.notes
    ) ORDER BY s.step_order
  ), '[]'::jsonb)
  FROM financial_approval_steps s
  WHERE s.entity_type = p_entity_type AND s.entity_id = p_entity_id;
$$;

-- ---------------------------------------------------------------------------
-- Financial security settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_financial_security_settings(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;

  RETURN jsonb_build_object(
    'je_requires_approval', COALESCE(v_org.je_requires_approval, false),
    'je_dual_approval_enabled', COALESCE(v_org.je_dual_approval_enabled, false),
    'je_dual_approval_threshold', v_org.je_dual_approval_threshold,
    'ap_dual_approval_enabled', COALESCE(v_org.ap_dual_approval_enabled, false),
    'ap_dual_approval_threshold', v_org.ap_dual_approval_threshold,
    'sod_enforcement_enabled', COALESCE(v_org.sod_enforcement_enabled, true)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_financial_security_settings(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_financial_security_settings(
  p_org_id UUID,
  p_je_requires_approval BOOLEAN DEFAULT NULL,
  p_je_dual_approval_enabled BOOLEAN DEFAULT NULL,
  p_je_dual_approval_threshold NUMERIC DEFAULT NULL,
  p_ap_dual_approval_enabled BOOLEAN DEFAULT NULL,
  p_ap_dual_approval_threshold NUMERIC DEFAULT NULL,
  p_sod_enforcement_enabled BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE organizations SET
    je_requires_approval = COALESCE(p_je_requires_approval, je_requires_approval),
    je_dual_approval_enabled = COALESCE(p_je_dual_approval_enabled, je_dual_approval_enabled),
    je_dual_approval_threshold = CASE
      WHEN p_je_dual_approval_threshold IS NOT NULL THEN NULLIF(p_je_dual_approval_threshold, 0)
      ELSE je_dual_approval_threshold
    END,
    ap_dual_approval_enabled = COALESCE(p_ap_dual_approval_enabled, ap_dual_approval_enabled),
    ap_dual_approval_threshold = COALESCE(p_ap_dual_approval_threshold, ap_dual_approval_threshold),
    sod_enforcement_enabled = COALESCE(p_sod_enforcement_enabled, sod_enforcement_enabled)
  WHERE id = p_org_id;

  RETURN public.get_financial_security_settings(p_org_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_financial_security_settings(UUID, BOOLEAN, BOOLEAN, NUMERIC, BOOLEAN, NUMERIC, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- SoD rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_sod_rules(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO sod_conflict_rules (organization_id, name, action_create, action_approve)
  SELECT p_org_id, 'Creator cannot approve journal entry', 'journal_entry.create', 'journal_entry.approve'
  WHERE NOT EXISTS (
    SELECT 1 FROM sod_conflict_rules
    WHERE organization_id = p_org_id AND action_create = 'journal_entry.create'
      AND action_approve = 'journal_entry.approve'
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO sod_conflict_rules (organization_id, name, action_create, action_approve)
  SELECT p_org_id, 'Creator cannot approve payment run', 'payment_run.create', 'payment_run.approve'
  WHERE NOT EXISTS (
    SELECT 1 FROM sod_conflict_rules
    WHERE organization_id = p_org_id AND action_create = 'payment_run.create'
      AND action_approve = 'payment_run.approve'
  );

  INSERT INTO sod_conflict_rules (organization_id, name, action_create, action_approve)
  SELECT p_org_id, 'Creator cannot execute payment run', 'payment_run.create', 'payment_run.execute'
  WHERE NOT EXISTS (
    SELECT 1 FROM sod_conflict_rules
    WHERE organization_id = p_org_id AND action_create = 'payment_run.create'
      AND action_approve = 'payment_run.execute'
  );

  INSERT INTO sod_conflict_rules (organization_id, name, action_create, action_approve)
  SELECT p_org_id, 'Approver cannot execute same payment run', 'payment_run.approve', 'payment_run.execute'
  WHERE NOT EXISTS (
    SELECT 1 FROM sod_conflict_rules
    WHERE organization_id = p_org_id AND action_create = 'payment_run.approve'
      AND action_approve = 'payment_run.execute'
  );

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_sod_rules(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_sod_conflict_rules(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'action_create', r.action_create,
        'action_approve', r.action_approve,
        'block_same_user', r.block_same_user,
        'severity', r.severity,
        'is_active', r.is_active
      ) ORDER BY r.name
    )
    FROM sod_conflict_rules r
    WHERE r.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_sod_conflict_rules(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_sod_conflict_rule(
  p_org_id UUID,
  p_rule_id UUID,
  p_name TEXT,
  p_action_create TEXT,
  p_action_approve TEXT,
  p_is_active BOOLEAN DEFAULT true,
  p_severity TEXT DEFAULT 'block'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_rule_id IS NOT NULL THEN
    UPDATE sod_conflict_rules SET
      name = trim(p_name),
      action_create = p_action_create,
      action_approve = p_action_approve,
      is_active = COALESCE(p_is_active, true),
      severity = COALESCE(p_severity, 'block')
    WHERE id = p_rule_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO sod_conflict_rules (
      organization_id, name, action_create, action_approve, is_active, severity
    ) VALUES (
      p_org_id, trim(p_name), p_action_create, p_action_approve,
      COALESCE(p_is_active, true), COALESCE(p_severity, 'block')
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_sod_conflict_rule(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Journal entry approval — SoD + dual approval
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_journal_entry(p_entry_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_entry journal_entries%ROWTYPE;
  v_journal_code TEXT;
  v_total NUMERIC;
  v_dual BOOLEAN;
  v_steps INT;
  v_next_step INT;
  v_lines JSONB;
BEGIN
  SELECT * INTO v_entry FROM journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal entry not found'; END IF;
  IF NOT public.user_can_manage(v_entry.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_entry.entry_status <> 'draft'::journal_entry_status THEN
    RAISE EXCEPTION 'Only draft entries can be approved';
  END IF;

  PERFORM public._assert_sod_no_conflict(
    v_entry.organization_id, 'journal_entry.create', 'journal_entry.approve', v_entry.created_by
  );

  IF EXISTS (
    SELECT 1 FROM financial_approval_steps
    WHERE entity_type = 'journal_entry' AND entity_id = p_entry_id AND approver_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You have already approved this journal entry';
  END IF;

  v_total := public._je_entry_total(p_entry_id);
  v_dual := public._financial_dual_approval_required(v_entry.organization_id, 'journal_entry', v_total);

  SELECT COUNT(*)::INT INTO v_steps
  FROM financial_approval_steps
  WHERE entity_type = 'journal_entry' AND entity_id = p_entry_id;

  v_next_step := v_steps + 1;

  IF v_dual AND v_steps < 1 THEN
    INSERT INTO financial_approval_steps (
      organization_id, entity_type, entity_id, step_order, approver_id
    ) VALUES (
      v_entry.organization_id, 'journal_entry', p_entry_id, 1, auth.uid()
    );

    IF EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = '_log_journal_entry_audit'
    ) THEN
      PERFORM public._log_journal_entry_audit(
        v_entry.organization_id, p_entry_id, 'first_approval',
        jsonb_build_object('step', 1, 'approver_id', auth.uid())
      );
    END IF;

    RETURN p_entry_id;
  END IF;

  IF v_dual THEN
    INSERT INTO financial_approval_steps (
      organization_id, entity_type, entity_id, step_order, approver_id
    ) VALUES (
      v_entry.organization_id, 'journal_entry', p_entry_id, v_next_step, auth.uid()
    );
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'accountId', jel.account_id,
      'debit', jel.debit,
      'credit', jel.credit,
      'description', jel.description,
      'storeId', jel.store_id,
      'projectId', jel.project_id,
      'departmentId', jel.department_id
    )
  ), '[]'::jsonb)
  INTO v_lines
  FROM journal_entry_lines jel
  WHERE jel.entry_id = p_entry_id;

  PERFORM public._assert_accounting_date_open(v_entry.organization_id, v_entry.entry_date);

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_assert_accounts_postable') THEN
    PERFORM public._assert_accounts_postable(v_lines);
  END IF;

  UPDATE journal_entries
  SET entry_status = 'posted'::journal_entry_status
  WHERE id = p_entry_id;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_log_journal_entry_audit') THEN
    PERFORM public._log_journal_entry_audit(v_entry.organization_id, p_entry_id, 'approved', '{}'::jsonb);
  END IF;

  SELECT code INTO v_journal_code FROM journals WHERE id = v_entry.journal_id;

  PERFORM public.enqueue_notification_event(
    v_entry.organization_id,
    'accounting.journal_posted',
    'journal_entry',
    p_entry_id,
    jsonb_build_object(
      'journal_code', COALESCE(v_journal_code, ''),
      'memo', COALESCE(v_entry.memo, ''),
      'entry_date', v_entry.entry_date,
      'source_type', COALESCE(v_entry.source_type, ''),
      'dual_approval', v_dual
    ),
    'journal_posted:' || p_entry_id::text
  );

  RETURN p_entry_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_journal_entry(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Payment run approval — SoD + dual approval
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_payment_run(p_run_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run ap_payment_runs%ROWTYPE;
  v_dual BOOLEAN;
  v_steps INT;
BEGIN
  SELECT * INTO v_run FROM ap_payment_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment run not found'; END IF;
  IF NOT public.user_can_manage(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'Only draft runs can be approved'; END IF;

  PERFORM public._assert_sod_no_conflict(
    v_run.organization_id, 'payment_run.create', 'payment_run.approve', v_run.created_by
  );

  IF EXISTS (
    SELECT 1 FROM financial_approval_steps
    WHERE entity_type = 'payment_run' AND entity_id = p_run_id AND approver_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You have already approved this payment run';
  END IF;

  v_dual := public._financial_dual_approval_required(
    v_run.organization_id, 'payment_run', v_run.total_amount
  );

  SELECT COUNT(*)::INT INTO v_steps
  FROM financial_approval_steps
  WHERE entity_type = 'payment_run' AND entity_id = p_run_id;

  IF v_dual AND v_steps < 1 THEN
    INSERT INTO financial_approval_steps (
      organization_id, entity_type, entity_id, step_order, approver_id
    ) VALUES (
      v_run.organization_id, 'payment_run', p_run_id, 1, auth.uid()
    );

    UPDATE ap_payment_runs SET approval_count = 1 WHERE id = p_run_id;
    RETURN p_run_id;
  END IF;

  INSERT INTO financial_approval_steps (
    organization_id, entity_type, entity_id, step_order, approver_id
  ) VALUES (
    v_run.organization_id, 'payment_run', p_run_id,
    GREATEST(v_steps, 0) + 1, auth.uid()
  );

  UPDATE ap_payment_runs
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(),
      approval_count = GREATEST(v_steps, 0) + 1
  WHERE id = p_run_id;

  RETURN p_run_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_payment_run(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.execute_payment_run(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run ap_payment_runs%ROWTYPE;
  v_line RECORD;
  v_paid INT := 0;
BEGIN
  SELECT * INTO v_run FROM ap_payment_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment run not found'; END IF;
  IF NOT public.user_can_manage(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status <> 'approved' THEN RAISE EXCEPTION 'Payment run must be approved'; END IF;

  PERFORM public._assert_sod_no_conflict(
    v_run.organization_id, 'payment_run.create', 'payment_run.execute', v_run.created_by
  );

  IF v_run.approved_by IS NOT NULL AND v_run.approved_by = auth.uid() THEN
    PERFORM public._assert_sod_no_conflict(
      v_run.organization_id, 'payment_run.approve', 'payment_run.execute', v_run.approved_by
    );
  END IF;

  FOR v_line IN SELECT * FROM ap_payment_run_lines WHERE run_id = p_run_id LOOP
    PERFORM public.pay_vendor_bill(
      v_line.bill_id, v_run.payment_method, v_line.amount, v_run.run_date,
      'Payment run ' || p_run_id::text, p_run_id, 0
    );
    v_paid := v_paid + 1;
  END LOOP;

  UPDATE ap_payment_runs SET status = 'executed', executed_at = now() WHERE id = p_run_id;

  RETURN jsonb_build_object('run_id', p_run_id, 'bills_paid', v_paid);
END;
$$;
GRANT EXECUTE ON FUNCTION public.execute_payment_run(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Extended draft list with approval metadata
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_journal_entry_drafts(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', je.id,
        'entry_date', je.entry_date,
        'memo', je.memo,
        'source_type', je.source_type,
        'created_at', je.created_at,
        'created_by', je.created_by,
        'journal_code', j.code,
        'total_debit', public._je_entry_total(je.id),
        'approval_steps', public._financial_approval_steps_json('journal_entry', je.id),
        'dual_approval_required', public._financial_dual_approval_required(
          p_org_id, 'journal_entry', public._je_entry_total(je.id)
        ),
        'approvals_received', (
          SELECT COUNT(*)::INT FROM financial_approval_steps
          WHERE entity_type = 'journal_entry' AND entity_id = je.id
        ),
        'lines', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', jel.id,
              'debit', jel.debit,
              'credit', jel.credit,
              'description', jel.description,
              'account_code', a.code,
              'account_name', a.name
            ) ORDER BY a.code
          )
          FROM journal_entry_lines jel
          JOIN accounts a ON a.id = jel.account_id
          WHERE jel.entry_id = je.id
        ), '[]'::jsonb)
      ) ORDER BY je.created_at DESC
    )
    FROM journal_entries je
    JOIN journals j ON j.id = je.journal_id
    WHERE je.organization_id = p_org_id
      AND je.entry_status = 'draft'::journal_entry_status
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_journal_entry_drafts(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Extended payment runs list
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_payment_runs(p_org_id UUID, p_limit INT DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'run_date') DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', r.id,
        'run_date', r.run_date,
        'payment_method', r.payment_method,
        'status', r.status,
        'total_amount', r.total_amount,
        'memo', r.memo,
        'created_by', r.created_by,
        'approved_by', r.approved_by,
        'approved_at', r.approved_at,
        'executed_at', r.executed_at,
        'approval_count', r.approval_count,
        'dual_approval_required', public._financial_dual_approval_required(
          p_org_id, 'payment_run', r.total_amount
        ),
        'approval_steps', public._financial_approval_steps_json('payment_run', r.id),
        'line_count', (SELECT COUNT(*)::INT FROM ap_payment_run_lines l WHERE l.run_id = r.id),
        'created_at', r.created_at
      ) AS row
      FROM ap_payment_runs r
      WHERE r.organization_id = p_org_id
      ORDER BY r.run_date DESC, r.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
    ) sub
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_payment_runs(UUID, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Unified pending approvals queue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_pending_financial_approvals(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'journal_entries', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', je.id,
          'entity_type', 'journal_entry',
          'reference', j.code || ' — ' || COALESCE(je.memo, je.entry_date::text),
          'amount', public._je_entry_total(je.id),
          'date', je.entry_date,
          'dual_approval_required', public._financial_dual_approval_required(
            p_org_id, 'journal_entry', public._je_entry_total(je.id)
          ),
          'approvals_received', (
            SELECT COUNT(*)::INT FROM financial_approval_steps
            WHERE entity_type = 'journal_entry' AND entity_id = je.id
          ),
          'approval_steps', public._financial_approval_steps_json('journal_entry', je.id),
          'created_by', je.created_by
        ) ORDER BY je.created_at DESC
      )
      FROM journal_entries je
      JOIN journals j ON j.id = je.journal_id
      WHERE je.organization_id = p_org_id
        AND je.entry_status = 'draft'::journal_entry_status
    ), '[]'::jsonb),
    'payment_runs', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'entity_type', 'payment_run',
          'reference', COALESCE(r.memo, 'Payment run ' || r.run_date::text),
          'amount', r.total_amount,
          'date', r.run_date,
          'dual_approval_required', public._financial_dual_approval_required(
            p_org_id, 'payment_run', r.total_amount
          ),
          'approvals_received', r.approval_count,
          'approval_steps', public._financial_approval_steps_json('payment_run', r.id),
          'created_by', r.created_by,
          'status', r.status
        ) ORDER BY r.created_at DESC
      )
      FROM ap_payment_runs r
      WHERE r.organization_id = p_org_id AND r.status = 'draft'
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_pending_financial_approvals(UUID) TO authenticated;

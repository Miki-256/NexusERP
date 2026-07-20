-- Tenant health scores + governed offboarding (Support L6).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS offboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboard_reason TEXT,
  ADD COLUMN IF NOT EXISTS offboarded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_offboarded
  ON public.organizations (offboarded_at)
  WHERE offboarded_at IS NOT NULL;

-- Allow offboard in dual-control approvals
ALTER TABLE public.platform_admin_approvals
  DROP CONSTRAINT IF EXISTS platform_admin_approvals_action_type_check;

ALTER TABLE public.platform_admin_approvals
  ADD CONSTRAINT platform_admin_approvals_action_type_check
  CHECK (action_type IN ('org.suspend', 'org.export', 'org.offboard'));

UPDATE platform_settings
SET value = jsonb_set(
  jsonb_set(
    COALESCE(value, '{}'::jsonb),
    '{actions}',
    COALESCE(value->'actions', '[]'::jsonb) || '["org.offboard"]'::jsonb,
    true
  ),
  '{enabled}',
  COALESCE(value->'enabled', 'true'::jsonb),
  true
),
updated_at = now()
WHERE key = 'dual_control'
  AND NOT (COALESCE(value->'actions', '[]'::jsonb) ? 'org.offboard');

CREATE OR REPLACE FUNCTION public.admin_get_org_health(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_score INT := 100;
  v_factors JSONB := '[]'::jsonb;
  v_ledger_pending INT := 0;
  v_ledger_failed INT := 0;
  v_unposted INT := 0;
  v_webhook_pending INT := 0;
  v_last_sale TIMESTAMPTZ;
  v_members INT := 0;
  v_grade TEXT;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  SELECT COUNT(*)::INT INTO v_members
  FROM organization_members
  WHERE organization_id = p_org_id AND is_active = true;

  IF to_regclass('public.sale_ledger_post_queue') IS NOT NULL THEN
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(attempts, 0) = 0 OR last_error IS NULL)::INT,
      COUNT(*) FILTER (WHERE last_error IS NOT NULL OR COALESCE(attempts, 0) > 0)::INT
    INTO v_ledger_pending, v_ledger_failed
    FROM sale_ledger_post_queue
    WHERE organization_id = p_org_id;
    -- pending total includes failed; keep simple counts
    SELECT COUNT(*)::INT INTO v_ledger_pending
    FROM sale_ledger_post_queue WHERE organization_id = p_org_id;
    SELECT COUNT(*)::INT INTO v_ledger_failed
    FROM sale_ledger_post_queue
    WHERE organization_id = p_org_id AND last_error IS NOT NULL;
  END IF;

  IF to_regclass('public.payment_webhook_queue') IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_webhook_pending
    FROM payment_webhook_queue
    WHERE organization_id = p_org_id AND processed_at IS NULL;
  END IF;

  SELECT COUNT(*)::INT INTO v_unposted
  FROM sales s
  WHERE s.organization_id = p_org_id
    AND s.status = 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM payments p
      WHERE p.sale_id = s.id AND p.status = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.organization_id = s.organization_id
        AND je.source_type = 'sale' AND je.source_id = s.id
    );

  SELECT MAX(created_at) INTO v_last_sale
  FROM sales
  WHERE organization_id = p_org_id AND status = 'completed';

  IF v_org.offboarded_at IS NOT NULL THEN
    v_score := 0;
    v_factors := v_factors || jsonb_build_array(jsonb_build_object(
      'code', 'offboarded', 'impact', -100, 'detail', 'Organization offboarded'
    ));
  ELSE
    IF v_org.status = 'suspended' THEN
      v_score := v_score - 40;
      v_factors := v_factors || jsonb_build_array(jsonb_build_object(
        'code', 'suspended', 'impact', -40, 'detail', 'Tenant is suspended'
      ));
    ELSIF v_org.status = 'pending' THEN
      v_score := v_score - 10;
      v_factors := v_factors || jsonb_build_array(jsonb_build_object(
        'code', 'pending', 'impact', -10, 'detail', 'Tenant awaiting approval'
      ));
    END IF;

    IF v_ledger_failed > 0 THEN
      v_score := v_score - LEAST(25, 10 + v_ledger_failed * 2);
      v_factors := v_factors || jsonb_build_array(jsonb_build_object(
        'code', 'ledger_failed', 'impact', -LEAST(25, 10 + v_ledger_failed * 2),
        'detail', format('%s failed ledger queue rows', v_ledger_failed)
      ));
    ELSIF v_ledger_pending > 20 THEN
      v_score := v_score - 10;
      v_factors := v_factors || jsonb_build_array(jsonb_build_object(
        'code', 'ledger_backlog', 'impact', -10,
        'detail', format('%s pending ledger posts', v_ledger_pending)
      ));
    ELSIF v_ledger_pending > 0 THEN
      v_score := v_score - 4;
      v_factors := v_factors || jsonb_build_array(jsonb_build_object(
        'code', 'ledger_pending', 'impact', -4,
        'detail', format('%s pending ledger posts', v_ledger_pending)
      ));
    END IF;

    IF v_unposted > 50 THEN
      v_score := v_score - 15;
      v_factors := v_factors || jsonb_build_array(jsonb_build_object(
        'code', 'unposted_high', 'impact', -15,
        'detail', format('%s unposted completed sales', v_unposted)
      ));
    ELSIF v_unposted > 10 THEN
      v_score := v_score - 8;
      v_factors := v_factors || jsonb_build_array(jsonb_build_object(
        'code', 'unposted', 'impact', -8,
        'detail', format('%s unposted completed sales', v_unposted)
      ));
    END IF;

    IF v_webhook_pending > 10 THEN
      v_score := v_score - 8;
      v_factors := v_factors || jsonb_build_array(jsonb_build_object(
        'code', 'webhook_backlog', 'impact', -8,
        'detail', format('%s pending payment webhooks', v_webhook_pending)
      ));
    ELSIF v_webhook_pending > 0 THEN
      v_score := v_score - 3;
      v_factors := v_factors || jsonb_build_array(jsonb_build_object(
        'code', 'webhook_pending', 'impact', -3,
        'detail', format('%s pending payment webhooks', v_webhook_pending)
      ));
    END IF;

    IF v_org.status = 'active' THEN
      IF v_last_sale IS NULL THEN
        v_score := v_score - 15;
        v_factors := v_factors || jsonb_build_array(jsonb_build_object(
          'code', 'no_sales', 'impact', -15, 'detail', 'No completed sales recorded'
        ));
      ELSIF v_last_sale < now() - interval '90 days' THEN
        v_score := v_score - 20;
        v_factors := v_factors || jsonb_build_array(jsonb_build_object(
          'code', 'inactive_90d', 'impact', -20, 'detail', 'No sales in 90+ days'
        ));
      ELSIF v_last_sale < now() - interval '30 days' THEN
        v_score := v_score - 10;
        v_factors := v_factors || jsonb_build_array(jsonb_build_object(
          'code', 'inactive_30d', 'impact', -10, 'detail', 'No sales in 30+ days'
        ));
      END IF;
    END IF;

    IF v_members = 0 THEN
      v_score := v_score - 15;
      v_factors := v_factors || jsonb_build_array(jsonb_build_object(
        'code', 'no_members', 'impact', -15, 'detail', 'No active members'
      ));
    END IF;
  END IF;

  v_score := GREATEST(0, LEAST(100, v_score));
  v_grade := CASE
    WHEN v_org.offboarded_at IS NOT NULL THEN 'offboarded'
    WHEN v_score >= 80 THEN 'healthy'
    WHEN v_score >= 50 THEN 'watch'
    ELSE 'critical'
  END;

  RETURN jsonb_build_object(
    'organization_id', p_org_id,
    'score', v_score,
    'grade', v_grade,
    'factors', v_factors,
    'signals', jsonb_build_object(
      'status', v_org.status,
      'offboarded_at', v_org.offboarded_at,
      'active_members', v_members,
      'ledger_queue_pending', v_ledger_pending,
      'ledger_queue_failed', v_ledger_failed,
      'unposted_sales', v_unposted,
      'webhook_pending', v_webhook_pending,
      'last_sale_at', v_last_sale
    ),
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_org_health(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_organizations_health()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'created_at') DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'status', o.status,
          'plan', o.plan,
          'currency', o.currency,
          'member_count', (
            SELECT COUNT(*) FROM organization_members m
            WHERE m.organization_id = o.id AND m.is_active = true
          ),
          'created_at', o.created_at,
          'offboarded_at', o.offboarded_at,
          'health', public.admin_get_org_health(o.id)
        ) AS row_data
        FROM organizations o
      ) x
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_organizations_health() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_offboard_organization(
  p_org_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason TEXT := trim(COALESCE(p_reason, ''));
  v_org public.organizations%ROWTYPE;
  v_members INT := 0;
  v_sessions INT := 0;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF char_length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Offboard reason must be at least 8 characters';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF v_org.offboarded_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_offboarded', true, 'organization_id', p_org_id);
  END IF;

  UPDATE organizations
  SET
    status = 'suspended',
    offboarded_at = now(),
    offboard_reason = v_reason,
    offboarded_by = auth.uid(),
    updated_at = now()
  WHERE id = p_org_id;

  UPDATE organization_members
  SET is_active = false
  WHERE organization_id = p_org_id
    AND is_active = true;
  GET DIAGNOSTICS v_members = ROW_COUNT;

  IF to_regclass('public.platform_support_sessions') IS NOT NULL THEN
    UPDATE platform_support_sessions s
    SET ended_at = now()
    WHERE s.organization_id = p_org_id
      AND s.ended_at IS NULL;
    GET DIAGNOSTICS v_sessions = ROW_COUNT;
  END IF;

  UPDATE platform_admin_approvals
  SET status = 'cancelled'
  WHERE organization_id = p_org_id
    AND status = 'pending';

  PERFORM public.log_platform_audit(
    'org.offboard',
    'organization',
    p_org_id,
    p_org_id,
    jsonb_build_object(
      'reason', v_reason,
      'members_deactivated', v_members,
      'support_sessions_ended', v_sessions
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', p_org_id,
    'members_deactivated', v_members,
    'support_sessions_ended', v_sessions,
    'offboarded_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_offboard_organization(UUID, TEXT) TO authenticated;

-- Patch dual-control request/execute/review for org.offboard
CREATE OR REPLACE FUNCTION public.admin_execute_approval_action(p_approval_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_admin_approvals%ROWTYPE;
  v_old public.org_status;
  v_offboard JSONB;
BEGIN
  SELECT * INTO v_row
  FROM platform_admin_approvals
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found';
  END IF;

  IF v_row.action_type = 'org.suspend' THEN
    IF v_row.status <> 'approved' AND v_row.status <> 'pending' THEN
      RAISE EXCEPTION 'Approval is not executable';
    END IF;

    SELECT status INTO v_old FROM organizations WHERE id = v_row.organization_id;
    UPDATE organizations
    SET status = 'suspended', updated_at = now()
    WHERE id = v_row.organization_id;

    UPDATE platform_admin_approvals
    SET status = 'executed', executed_at = now()
    WHERE id = p_approval_id;

    PERFORM public.log_platform_audit(
      'org.suspend',
      'organization',
      v_row.organization_id,
      v_row.organization_id,
      jsonb_build_object(
        'from', v_old,
        'to', 'suspended',
        'approval_id', p_approval_id,
        'dual_control', true,
        'reason', v_row.reason
      )
    );

    RETURN jsonb_build_object('ok', true, 'status', 'executed', 'action_type', 'org.suspend');
  END IF;

  IF v_row.action_type = 'org.export' THEN
    IF v_row.status <> 'approved' THEN
      RAISE EXCEPTION 'Export approval is not ready';
    END IF;

    UPDATE platform_admin_approvals
    SET status = 'executed', executed_at = now()
    WHERE id = p_approval_id;

    PERFORM public.log_platform_audit(
      'org.export',
      'organization',
      v_row.organization_id,
      v_row.organization_id,
      jsonb_build_object(
        'approval_id', p_approval_id,
        'dual_control', true,
        'reason', v_row.reason
      )
    );

    RETURN jsonb_build_object('ok', true, 'status', 'executed', 'action_type', 'org.export');
  END IF;

  IF v_row.action_type = 'org.offboard' THEN
    IF v_row.status <> 'approved' AND v_row.status <> 'pending' THEN
      RAISE EXCEPTION 'Approval is not executable';
    END IF;

    v_offboard := public.admin_offboard_organization(v_row.organization_id, v_row.reason);

    UPDATE platform_admin_approvals
    SET status = 'executed', executed_at = now()
    WHERE id = p_approval_id;

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'executed',
      'action_type', 'org.offboard',
      'result', v_offboard
    );
  END IF;

  RAISE EXCEPTION 'Unsupported action type';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_execute_approval_action(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_request_sensitive_action(
  p_action TEXT,
  p_org_id UUID,
  p_reason TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason TEXT := trim(COALESCE(p_reason, ''));
  v_org public.organizations%ROWTYPE;
  v_id UUID;
  v_requires BOOLEAN;
  v_offboard JSONB;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_action NOT IN ('org.suspend', 'org.export', 'org.offboard') THEN
    RAISE EXCEPTION 'Unsupported sensitive action';
  END IF;

  IF char_length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Reason must be at least 8 characters';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF p_action = 'org.offboard' AND v_org.offboarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Organization is already offboarded';
  END IF;

  PERFORM public.admin_expire_stale_approvals();

  v_requires := public.admin_dual_control_required(p_action);

  IF NOT v_requires THEN
    IF p_action = 'org.suspend' THEN
      PERFORM public.admin_set_org_status(p_org_id, 'suspended');
      RETURN jsonb_build_object(
        'ok', true,
        'status', 'executed',
        'dual_control', false,
        'organization_id', p_org_id
      );
    END IF;

    IF p_action = 'org.offboard' THEN
      v_offboard := public.admin_offboard_organization(p_org_id, v_reason);
      RETURN jsonb_build_object(
        'ok', true,
        'status', 'executed',
        'dual_control', false,
        'organization_id', p_org_id,
        'result', v_offboard
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'executed',
      'dual_control', false,
      'organization_id', p_org_id,
      'download_path', '/api/admin/organizations/' || p_org_id::text || '/export'
    );
  END IF;

  UPDATE platform_admin_approvals
  SET status = 'cancelled'
  WHERE organization_id = p_org_id
    AND action_type = p_action
    AND requested_by = auth.uid()
    AND status = 'pending';

  INSERT INTO platform_admin_approvals (
    action_type, organization_id, payload, reason, requested_by
  ) VALUES (
    p_action, p_org_id, COALESCE(p_payload, '{}'::jsonb), v_reason, auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.log_platform_audit(
    'governance.approval_requested',
    'platform_admin_approvals',
    v_id,
    p_org_id,
    jsonb_build_object('action_type', p_action, 'reason', v_reason)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'pending',
    'dual_control', true,
    'approval_id', v_id,
    'organization_id', p_org_id,
    'organization_name', v_org.name,
    'action_type', p_action,
    'expires_at', now() + interval '24 hours'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_approval(
  p_approval_id UUID,
  p_approve BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_admin_approvals%ROWTYPE;
  v_exec JSONB;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.admin_expire_stale_approvals();

  SELECT * INTO v_row
  FROM platform_admin_approvals
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Approval is not pending';
  END IF;

  IF v_row.expires_at < now() THEN
    UPDATE platform_admin_approvals SET status = 'expired' WHERE id = p_approval_id;
    RAISE EXCEPTION 'Approval has expired';
  END IF;

  IF v_row.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'A different admin must review this request (dual control)';
  END IF;

  IF NOT p_approve THEN
    UPDATE platform_admin_approvals
    SET
      status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = NULLIF(trim(COALESCE(p_note, '')), '')
    WHERE id = p_approval_id;

    PERFORM public.log_platform_audit(
      'governance.approval_rejected',
      'platform_admin_approvals',
      p_approval_id,
      v_row.organization_id,
      jsonb_build_object('action_type', v_row.action_type, 'note', p_note)
    );

    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  UPDATE platform_admin_approvals
  SET
    status = 'approved',
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_note = NULLIF(trim(COALESCE(p_note, '')), '')
  WHERE id = p_approval_id;

  PERFORM public.log_platform_audit(
    'governance.approval_approved',
    'platform_admin_approvals',
    p_approval_id,
    v_row.organization_id,
    jsonb_build_object('action_type', v_row.action_type, 'note', p_note)
  );

  IF v_row.action_type IN ('org.suspend', 'org.offboard') THEN
    v_exec := public.admin_execute_approval_action(p_approval_id);
    RETURN jsonb_build_object('ok', true, 'status', 'executed', 'result', v_exec);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'approved',
    'approval_id', p_approval_id,
    'organization_id', v_row.organization_id,
    'download_path',
      '/api/admin/organizations/' || v_row.organization_id::text || '/export?approval_id=' || p_approval_id::text
  );
END;
$$;

-- Include offboard fields in org detail
CREATE OR REPLACE FUNCTION public.admin_get_organization_detail(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  RETURN jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'status', v_org.status,
      'plan', v_org.plan,
      'currency', v_org.currency,
      'timezone', v_org.timezone,
      'tax_rate', v_org.tax_rate,
      'created_at', v_org.created_at,
      'updated_at', v_org.updated_at,
      'offboarded_at', v_org.offboarded_at,
      'offboard_reason', v_org.offboard_reason,
      'offboarded_by', v_org.offboarded_by
    ),
    'members', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'member_id', m.id,
            'user_id', m.user_id,
            'email', u.email,
            'role', m.role,
            'is_active', m.is_active,
            'joined_at', m.created_at
          )
          ORDER BY m.created_at
        )
        FROM organization_members m
        JOIN auth.users u ON u.id = m.user_id
        WHERE m.organization_id = p_org_id
      ),
      '[]'::jsonb
    ),
    'stores', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'store_id', s.id,
            'name', s.name,
            'created_at', s.created_at
          )
          ORDER BY s.created_at
        )
        FROM stores s
        WHERE s.organization_id = p_org_id
      ),
      '[]'::jsonb
    ),
    'status_history', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', l.id,
            'action', l.action,
            'actor_email', l.actor_email,
            'payload', l.payload,
            'created_at', l.created_at
          )
          ORDER BY l.created_at DESC
        )
        FROM (
          SELECT *
          FROM platform_audit_logs
          WHERE organization_id = p_org_id
            AND action LIKE 'org.%'
          ORDER BY created_at DESC
          LIMIT 30
        ) l
      ),
      '[]'::jsonb
    ),
    'support_notes', public.admin_list_org_support_notes(p_org_id),
    'stats', jsonb_build_object(
      'sales_count', (SELECT COUNT(*) FROM sales WHERE organization_id = p_org_id AND status = 'completed'),
      'sales_total', (SELECT COALESCE(SUM(total), 0) FROM sales WHERE organization_id = p_org_id AND status = 'completed')
    ),
    'health', public.admin_get_org_health(p_org_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_organization_detail(UUID) TO authenticated;

-- Governance L5: dual-control approvals for sensitive actions + richer audit filters.

CREATE TABLE IF NOT EXISTS public.platform_admin_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL
    CHECK (action_type IN ('org.suspend', 'org.export')),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'executed', 'expired')),
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  executed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_approvals_reason_len CHECK (char_length(trim(reason)) >= 8)
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_approvals_status
  ON public.platform_admin_approvals (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_admin_approvals_org
  ON public.platform_admin_approvals (organization_id, requested_at DESC);

ALTER TABLE public.platform_admin_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_admin_approvals_select ON public.platform_admin_approvals;
CREATE POLICY platform_admin_approvals_select ON public.platform_admin_approvals
  FOR SELECT USING (public.platform_admin_can_read());

INSERT INTO platform_settings (key, value)
VALUES (
  'dual_control',
  jsonb_build_object(
    'enabled', true,
    'actions', jsonb_build_array('org.suspend', 'org.export'),
    'solo_admin_bypass', true
  )
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_dual_control_required(p_action TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings JSONB;
  v_enabled BOOLEAN;
  v_actions JSONB;
  v_solo_bypass BOOLEAN;
  v_write_admins INT;
BEGIN
  SELECT value INTO v_settings
  FROM platform_settings
  WHERE key = 'dual_control';

  IF v_settings IS NULL THEN
    RETURN false;
  END IF;

  v_enabled := COALESCE((v_settings->>'enabled')::boolean, false);
  IF NOT v_enabled THEN
    RETURN false;
  END IF;

  v_actions := COALESCE(v_settings->'actions', '[]'::jsonb);
  IF NOT (v_actions ? p_action) THEN
    RETURN false;
  END IF;

  v_solo_bypass := COALESCE((v_settings->>'solo_admin_bypass')::boolean, true);
  IF v_solo_bypass THEN
    SELECT COUNT(*)::INT INTO v_write_admins
    FROM platform_admins
    WHERE role IN ('super_admin', 'support');
    IF v_write_admins <= 1 THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dual_control_required(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_expire_stale_approvals()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE platform_admin_approvals
  SET status = 'expired'
  WHERE status IN ('pending', 'approved')
    AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_expire_stale_approvals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_expire_stale_approvals() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_execute_approval_action(p_approval_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_admin_approvals%ROWTYPE;
  v_old public.org_status;
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
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_action NOT IN ('org.suspend', 'org.export') THEN
    RAISE EXCEPTION 'Unsupported sensitive action';
  END IF;

  IF char_length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Reason must be at least 8 characters';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
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

    -- Export without dual control: return a synthetic approved marker (client downloads normally).
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'executed',
      'dual_control', false,
      'organization_id', p_org_id,
      'download_path', '/api/admin/organizations/' || p_org_id::text || '/export'
    );
  END IF;

  -- Deduplicate pending requests for same action/org by same requester.
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

GRANT EXECUTE ON FUNCTION public.admin_request_sensitive_action(TEXT, UUID, TEXT, JSONB) TO authenticated;

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

  IF v_row.action_type = 'org.suspend' THEN
    v_exec := public.admin_execute_approval_action(p_approval_id);
    RETURN jsonb_build_object('ok', true, 'status', 'executed', 'result', v_exec);
  END IF;

  -- Export: leave approved for download.
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

GRANT EXECUTE ON FUNCTION public.admin_review_approval(UUID, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_cancel_approval(p_approval_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_admin_approvals%ROWTYPE;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_row FROM platform_admin_approvals WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending approvals can be cancelled';
  END IF;

  IF v_row.requested_by <> auth.uid() AND NOT public.platform_admin_can_manage_admins() THEN
    RAISE EXCEPTION 'Only the requester or a super admin can cancel';
  END IF;

  UPDATE platform_admin_approvals SET status = 'cancelled' WHERE id = p_approval_id;

  PERFORM public.log_platform_audit(
    'governance.approval_cancelled',
    'platform_admin_approvals',
    p_approval_id,
    v_row.organization_id,
    jsonb_build_object('action_type', v_row.action_type)
  );

  RETURN jsonb_build_object('ok', true, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cancel_approval(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_approvals(
  p_status TEXT DEFAULT 'pending',
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.admin_expire_stale_approvals();

  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'requested_at') DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', a.id,
          'action_type', a.action_type,
          'organization_id', a.organization_id,
          'organization_name', o.name,
          'payload', a.payload,
          'reason', a.reason,
          'status', a.status,
          'requested_by', a.requested_by,
          'requested_by_email', ru.email,
          'requested_at', a.requested_at,
          'reviewed_by', a.reviewed_by,
          'reviewed_by_email', vu.email,
          'reviewed_at', a.reviewed_at,
          'review_note', a.review_note,
          'executed_at', a.executed_at,
          'expires_at', a.expires_at,
          'can_review', (
            a.status = 'pending'
            AND a.requested_by <> auth.uid()
            AND public.platform_admin_can_write()
          ),
          'can_cancel', (
            a.status = 'pending'
            AND (
              a.requested_by = auth.uid()
              OR public.platform_admin_can_manage_admins()
            )
          ),
          'download_path', CASE
            WHEN a.action_type = 'org.export' AND a.status = 'approved'
              THEN '/api/admin/organizations/' || a.organization_id::text || '/export?approval_id=' || a.id::text
            ELSE NULL
          END
        ) AS row_data
        FROM platform_admin_approvals a
        JOIN organizations o ON o.id = a.organization_id
        JOIN auth.users ru ON ru.id = a.requested_by
        LEFT JOIN auth.users vu ON vu.id = a.reviewed_by
        WHERE (p_status IS NULL OR p_status = 'all' OR a.status = p_status)
        ORDER BY a.requested_at DESC
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
      ) x
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_approvals(TEXT, INT) TO authenticated;

-- Block direct suspend when dual control is required.
CREATE OR REPLACE FUNCTION public.admin_set_org_status(p_org_id UUID, p_status org_status)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old org_status;
  v_action TEXT;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_status = 'suspended' AND public.admin_dual_control_required('org.suspend') THEN
    RAISE EXCEPTION 'Dual control required for suspend. Use Approvals (admin_request_sensitive_action).';
  END IF;

  SELECT status INTO v_old FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  UPDATE organizations SET status = p_status, updated_at = now() WHERE id = p_org_id;

  v_action := CASE p_status
    WHEN 'active' THEN 'org.approve'
    WHEN 'suspended' THEN 'org.suspend'
    WHEN 'pending' THEN 'org.reactivate'
    ELSE 'org.status_change'
  END;

  PERFORM public.log_platform_audit(
    v_action,
    'organization',
    p_org_id,
    p_org_id,
    jsonb_build_object('from', v_old, 'to', p_status)
  );
END;
$$;

-- Export with optional dual-control approval (preserves phase D payload).
DROP FUNCTION IF EXISTS public.admin_export_organization(UUID);
DROP FUNCTION IF EXISTS public.admin_export_organization(UUID, UUID);

CREATE OR REPLACE FUNCTION public.admin_export_organization(
  p_org_id UUID,
  p_approval_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_row public.platform_admin_approvals%ROWTYPE;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.admin_expire_stale_approvals();

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF public.admin_dual_control_required('org.export') THEN
    IF p_approval_id IS NULL THEN
      RAISE EXCEPTION 'Dual control required for export. Request approval first.';
    END IF;

    SELECT * INTO v_row
    FROM platform_admin_approvals
    WHERE id = p_approval_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_row.organization_id <> p_org_id
       OR v_row.action_type <> 'org.export'
       OR v_row.status <> 'approved'
       OR v_row.expires_at < now() THEN
      RAISE EXCEPTION 'Valid approved export request required';
    END IF;

    PERFORM public.admin_execute_approval_action(p_approval_id);
  ELSE
    PERFORM public.log_platform_audit(
      'org.export',
      'organization',
      p_org_id,
      p_org_id,
      jsonb_build_object('name', v_org.name, 'dual_control', false)
    );
  END IF;

  RETURN jsonb_build_object(
    'exported_at', now(),
    'schema_version', 'phase_d_1',
    'organization', to_jsonb(v_org),
    'stores', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM stores s WHERE s.organization_id = p_org_id), '[]'::jsonb),
    'registers', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM registers r WHERE r.organization_id = p_org_id), '[]'::jsonb),
    'members', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'member', to_jsonb(m),
            'email', u.email
          )
        )
        FROM organization_members m
        JOIN auth.users u ON u.id = m.user_id
        WHERE m.organization_id = p_org_id
      ),
      '[]'::jsonb
    ),
    'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM categories c WHERE c.organization_id = p_org_id), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM products p WHERE p.organization_id = p_org_id), '[]'::jsonb),
    'product_variants', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM product_variants v WHERE v.organization_id = p_org_id), '[]'::jsonb),
    'customers', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM customers c WHERE c.organization_id = p_org_id), '[]'::jsonb),
    'sales_summary', jsonb_build_object(
      'total_count', (SELECT COUNT(*) FROM sales WHERE organization_id = p_org_id),
      'completed_count', (SELECT COUNT(*) FROM sales WHERE organization_id = p_org_id AND status = 'completed'),
      'completed_total', (SELECT COALESCE(SUM(total), 0) FROM sales WHERE organization_id = p_org_id AND status = 'completed')
    ),
    'recent_sales', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(s))
        FROM (
          SELECT * FROM sales
          WHERE organization_id = p_org_id
          ORDER BY created_at DESC
          LIMIT 100
        ) s
      ),
      '[]'::jsonb
    ),
    'support_notes', public.admin_list_org_support_notes(p_org_id),
    'plan_usage', public.admin_get_org_plan_usage(p_org_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_organization(UUID, UUID) TO authenticated;

-- Richer audit filters
DROP FUNCTION IF EXISTS public.admin_list_platform_audit_logs(INT, INT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.admin_list_platform_audit_logs(
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0,
  p_organization_id UUID DEFAULT NULL,
  p_action TEXT DEFAULT NULL,
  p_actor_email TEXT DEFAULT NULL,
  p_action_prefix TEXT DEFAULT NULL,
  p_since TIMESTAMPTZ DEFAULT NULL,
  p_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_total BIGINT;
  v_email TEXT := lower(trim(COALESCE(p_actor_email, '')));
  v_prefix TEXT := NULLIF(trim(COALESCE(p_action_prefix, '')), '');
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM platform_audit_logs l
  WHERE (p_organization_id IS NULL OR l.organization_id = p_organization_id)
    AND (p_action IS NULL OR l.action = p_action)
    AND (v_prefix IS NULL OR l.action LIKE v_prefix || '%')
    AND (v_email = '' OR lower(COALESCE(l.actor_email, '')) LIKE '%' || v_email || '%')
    AND (p_since IS NULL OR l.created_at >= p_since)
    AND (p_until IS NULL OR l.created_at <= p_until);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'actor_user_id', x.actor_user_id,
        'actor_email', x.actor_email,
        'action', x.action,
        'entity_type', x.entity_type,
        'entity_id', x.entity_id,
        'organization_id', x.organization_id,
        'payload', x.payload,
        'created_at', x.created_at
      )
      ORDER BY x.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_rows
  FROM (
    SELECT l.*
    FROM platform_audit_logs l
    WHERE (p_organization_id IS NULL OR l.organization_id = p_organization_id)
      AND (p_action IS NULL OR l.action = p_action)
      AND (v_prefix IS NULL OR l.action LIKE v_prefix || '%')
      AND (v_email = '' OR lower(COALESCE(l.actor_email, '')) LIKE '%' || v_email || '%')
      AND (p_since IS NULL OR l.created_at >= p_since)
      AND (p_until IS NULL OR l.created_at <= p_until)
    ORDER BY l.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    OFFSET GREATEST(0, p_offset)
  ) x;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_platform_audit_logs(
  INT, INT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO authenticated;

-- Include dual_control in settings get/set
CREATE OR REPLACE FUNCTION public.admin_get_platform_settings()
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

  RETURN (
    SELECT jsonb_object_agg(key, value)
    FROM platform_settings
    WHERE key IN ('broadcast_banner', 'maintenance_mode', 'dual_control')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_platform_settings(p_settings JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_banner JSONB;
  v_maintenance JSONB;
  v_dual JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_banner := p_settings->'broadcast_banner';
  v_maintenance := p_settings->'maintenance_mode';
  v_dual := p_settings->'dual_control';

  IF v_banner IS NOT NULL THEN
    IF NOT public.platform_admin_can_write() THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    INSERT INTO platform_settings (key, value, updated_at, updated_by)
    VALUES ('broadcast_banner', v_banner, now(), auth.uid())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
    PERFORM public.log_platform_audit('settings.broadcast', 'platform_settings', NULL, NULL, v_banner);
  END IF;

  IF v_maintenance IS NOT NULL THEN
    IF NOT public.platform_admin_can_manage_admins() THEN
      RAISE EXCEPTION 'Only super admins can change maintenance mode';
    END IF;
    INSERT INTO platform_settings (key, value, updated_at, updated_by)
    VALUES ('maintenance_mode', v_maintenance, now(), auth.uid())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
    PERFORM public.log_platform_audit('settings.maintenance', 'platform_settings', NULL, NULL, v_maintenance);
  END IF;

  IF v_dual IS NOT NULL THEN
    IF NOT public.platform_admin_can_manage_admins() THEN
      RAISE EXCEPTION 'Only super admins can change dual-control settings';
    END IF;
    INSERT INTO platform_settings (key, value, updated_at, updated_by)
    VALUES (
      'dual_control',
      jsonb_build_object(
        'enabled', COALESCE((v_dual->>'enabled')::boolean, true),
        'actions', COALESCE(v_dual->'actions', jsonb_build_array('org.suspend', 'org.export')),
        'solo_admin_bypass', COALESCE((v_dual->>'solo_admin_bypass')::boolean, true)
      ),
      now(),
      auth.uid()
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
    PERFORM public.log_platform_audit('settings.dual_control', 'platform_settings', NULL, NULL, v_dual);
  END IF;
END;
$$;

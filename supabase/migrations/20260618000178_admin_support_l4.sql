-- Support L4: audited temporary tenant workspace access + per-org ops inspector.

CREATE TABLE IF NOT EXISTS public.platform_support_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES public.organization_members(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  membership_was_created BOOLEAN NOT NULL DEFAULT false,
  prior_is_active BOOLEAN,
  prior_role public.member_role,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_support_sessions_reason_len CHECK (char_length(trim(reason)) >= 8)
);

CREATE INDEX IF NOT EXISTS idx_platform_support_sessions_admin_active
  ON public.platform_support_sessions (admin_user_id, ended_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_platform_support_sessions_org
  ON public.platform_support_sessions (organization_id, started_at DESC);

ALTER TABLE public.platform_support_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_support_sessions_select ON public.platform_support_sessions;
CREATE POLICY platform_support_sessions_select ON public.platform_support_sessions
  FOR SELECT USING (public.platform_admin_can_read());

CREATE OR REPLACE FUNCTION public.admin_expire_stale_support_sessions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_support_sessions%ROWTYPE;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT *
    FROM platform_support_sessions
    WHERE ended_at IS NULL
      AND expires_at < now()
  LOOP
    IF v_row.membership_id IS NOT NULL THEN
      IF v_row.membership_was_created THEN
        UPDATE organization_members
        SET is_active = false
        WHERE id = v_row.membership_id;
      ELSIF v_row.prior_is_active IS NOT NULL THEN
        UPDATE organization_members
        SET
          is_active = v_row.prior_is_active,
          role = COALESCE(v_row.prior_role, role)
        WHERE id = v_row.membership_id;
      END IF;
    END IF;

    UPDATE platform_support_sessions
    SET ended_at = now()
    WHERE id = v_row.id;

    PERFORM public.log_platform_audit(
      'support.session_expired',
      'platform_support_sessions',
      v_row.id,
      v_row.organization_id,
      jsonb_build_object('admin_user_id', v_row.admin_user_id, 'reason', v_row.reason)
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_expire_stale_support_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_expire_stale_support_sessions() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_end_support_session(p_session_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_support_sessions%ROWTYPE;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.admin_expire_stale_support_sessions();

  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM platform_support_sessions
    WHERE id = p_session_id
      AND admin_user_id = auth.uid()
      AND ended_at IS NULL;
  ELSE
    SELECT * INTO v_row
    FROM platform_support_sessions
    WHERE admin_user_id = auth.uid()
      AND ended_at IS NULL
      AND expires_at > now()
    ORDER BY started_at DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'ended', false);
  END IF;

  IF v_row.membership_id IS NOT NULL THEN
    IF v_row.membership_was_created THEN
      UPDATE organization_members
      SET is_active = false
      WHERE id = v_row.membership_id;
    ELSIF v_row.prior_is_active IS NOT NULL THEN
      UPDATE organization_members
      SET
        is_active = v_row.prior_is_active,
        role = COALESCE(v_row.prior_role, role)
      WHERE id = v_row.membership_id;
    END IF;
  END IF;

  UPDATE platform_support_sessions
  SET ended_at = now()
  WHERE id = v_row.id;

  PERFORM public.log_platform_audit(
    'support.session_ended',
    'platform_support_sessions',
    v_row.id,
    v_row.organization_id,
    jsonb_build_object('reason', v_row.reason)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'ended', true,
    'session_id', v_row.id,
    'organization_id', v_row.organization_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_end_support_session(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_start_support_session(
  p_org_id UUID,
  p_reason TEXT,
  p_duration_minutes INT DEFAULT 240
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_member public.organization_members%ROWTYPE;
  v_session_id UUID;
  v_reason TEXT := trim(COALESCE(p_reason, ''));
  v_duration INT := GREATEST(LEAST(COALESCE(p_duration_minutes, 240), 480), 30);
  v_created BOOLEAN := false;
  v_prior_active BOOLEAN;
  v_prior_role public.member_role;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF char_length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Support reason must be at least 8 characters';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF v_org.status = 'suspended' THEN
    RAISE EXCEPTION 'Cannot open a support session for a suspended organization';
  END IF;

  -- One active session per admin.
  PERFORM public.admin_end_support_session(NULL);
  PERFORM public.admin_expire_stale_support_sessions();

  SELECT * INTO v_member
  FROM organization_members
  WHERE organization_id = p_org_id
    AND user_id = auth.uid();

  IF FOUND THEN
    v_prior_active := v_member.is_active;
    v_prior_role := v_member.role;
    UPDATE organization_members
    SET
      is_active = true,
      role = CASE
        WHEN role = 'owner' THEN role
        ELSE 'manager'::public.member_role
      END
    WHERE id = v_member.id
    RETURNING * INTO v_member;
  ELSE
    INSERT INTO organization_members (organization_id, user_id, role, is_active)
    VALUES (p_org_id, auth.uid(), 'manager', true)
    RETURNING * INTO v_member;
    v_created := true;
    v_prior_active := false;
    v_prior_role := NULL;
  END IF;

  INSERT INTO platform_support_sessions (
    organization_id,
    admin_user_id,
    membership_id,
    reason,
    expires_at,
    membership_was_created,
    prior_is_active,
    prior_role
  ) VALUES (
    p_org_id,
    auth.uid(),
    v_member.id,
    v_reason,
    now() + make_interval(mins => v_duration),
    v_created,
    v_prior_active,
    v_prior_role
  )
  RETURNING id INTO v_session_id;

  PERFORM public.log_platform_audit(
    'support.session_started',
    'platform_support_sessions',
    v_session_id,
    p_org_id,
    jsonb_build_object(
      'reason', v_reason,
      'duration_minutes', v_duration,
      'membership_was_created', v_created,
      'organization_name', v_org.name
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session_id,
    'organization_id', p_org_id,
    'organization_name', v_org.name,
    'membership_id', v_member.id,
    'role', v_member.role,
    'expires_at', (now() + make_interval(mins => v_duration)),
    'reason', v_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_start_support_session(UUID, TEXT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_active_support_session()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_support_sessions%ROWTYPE;
  v_org_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.admin_expire_stale_support_sessions();

  SELECT s.* INTO v_row
  FROM platform_support_sessions s
  WHERE s.admin_user_id = auth.uid()
    AND s.ended_at IS NULL
    AND s.expires_at > now()
  ORDER BY s.started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_org_name FROM organizations WHERE id = v_row.organization_id;

  RETURN jsonb_build_object(
    'session_id', v_row.id,
    'organization_id', v_row.organization_id,
    'organization_name', v_org_name,
    'reason', v_row.reason,
    'started_at', v_row.started_at,
    'expires_at', v_row.expires_at,
    'membership_id', v_row.membership_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_active_support_session() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_org_ops_detail(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_ledger JSONB := '[]'::jsonb;
  v_webhooks JSONB := '[]'::jsonb;
  v_unposted JSONB := '[]'::jsonb;
  v_counts JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF to_regclass('public.sale_ledger_post_queue') IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'sale_id', q.sale_id,
          'attempts', q.attempts,
          'last_error', q.last_error,
          'enqueued_at', q.enqueued_at,
          'receipt_no', s.receipt_no,
          'total', s.total,
          'created_at', s.created_at
        )
        ORDER BY q.enqueued_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_ledger
    FROM (
      SELECT *
      FROM sale_ledger_post_queue
      WHERE organization_id = p_org_id
      ORDER BY enqueued_at ASC
      LIMIT 100
    ) q
    LEFT JOIN sales s ON s.id = q.sale_id;
  END IF;

  IF to_regclass('public.payment_webhook_queue') IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', w.id,
          'reference', w.reference,
          'provider', w.provider,
          'amount', w.amount,
          'created_at', w.created_at
        )
        ORDER BY w.created_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_webhooks
    FROM (
      SELECT *
      FROM payment_webhook_queue
      WHERE organization_id = p_org_id
        AND processed_at IS NULL
      ORDER BY created_at ASC
      LIMIT 50
    ) w;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'sale_id', s.id,
        'receipt_no', s.receipt_no,
        'total', s.total,
        'created_at', s.created_at
      )
      ORDER BY s.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_unposted
  FROM (
    SELECT s.id, s.receipt_no, s.total, s.created_at
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
      )
    ORDER BY s.created_at ASC
    LIMIT 50
  ) s;

  v_counts := jsonb_build_object(
    'ledger_queue', COALESCE(jsonb_array_length(v_ledger), 0),
    'webhook_queue', COALESCE(jsonb_array_length(v_webhooks), 0),
    'unposted_sales', (
      SELECT COUNT(*)::INT
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
        )
    )
  );

  RETURN jsonb_build_object(
    'organization_id', v_org.id,
    'organization_name', v_org.name,
    'organization_status', v_org.status,
    'counts', v_counts,
    'ledger_queue', v_ledger,
    'webhook_queue', v_webhooks,
    'unposted_sales', v_unposted,
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_org_ops_detail(UUID) TO authenticated;

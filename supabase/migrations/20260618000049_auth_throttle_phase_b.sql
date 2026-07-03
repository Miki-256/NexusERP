-- Phase B: Auth throttle admin — policies, lockout management, alert queue.

INSERT INTO public.platform_settings (key, value)
VALUES (
  'security_alerts',
  jsonb_build_object(
    'enabled', false,
    'webhook_url', '',
    'notify_slack', true
  )
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.security_alert_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  lockout_type TEXT NOT NULL,
  identifier TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  delivery_status TEXT,
  delivery_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_security_alert_queue_pending
  ON public.security_alert_queue (created_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.security_alert_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS security_alert_queue_deny ON public.security_alert_queue;
CREATE POLICY security_alert_queue_deny ON public.security_alert_queue
  FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public._enqueue_security_alert(
  p_alert_type TEXT,
  p_lockout_type TEXT,
  p_identifier TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.security_alert_queue (alert_type, lockout_type, identifier, payload)
  VALUES (p_alert_type, p_lockout_type, p_identifier, COALESCE(p_payload, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_auth_failure(
  p_lockout_type TEXT,
  p_identifier TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identifier TEXT;
  v_limits RECORD;
  v_attempts INT;
  v_locked_until TIMESTAMPTZ;
  v_window_started TIMESTAMPTZ;
  v_was_locked BOOLEAN;
BEGIN
  v_identifier := NULLIF(trim(lower(p_identifier)), '');
  IF v_identifier IS NULL THEN
    RETURN jsonb_build_object('locked', false);
  END IF;

  SELECT locked_until IS NOT NULL AND locked_until > now()
  INTO v_was_locked
  FROM public.auth_lockouts
  WHERE lockout_type = p_lockout_type AND identifier = v_identifier;

  SELECT * INTO v_limits FROM public._auth_limits_for_type(p_lockout_type);
  v_window_started := now();

  INSERT INTO public.auth_lockouts AS al (
    lockout_type, identifier, failed_attempts, locked_until, window_started_at, last_attempt_at, metadata
  )
  VALUES (
    p_lockout_type,
    v_identifier,
    1,
    NULL,
    v_window_started,
    now(),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (lockout_type, identifier) DO UPDATE SET
    failed_attempts = CASE
      WHEN al.window_started_at + (v_limits.window_minutes || ' minutes')::interval <= now() THEN 1
      ELSE al.failed_attempts + 1
    END,
    window_started_at = CASE
      WHEN al.window_started_at + (v_limits.window_minutes || ' minutes')::interval <= now() THEN now()
      ELSE al.window_started_at
    END,
    last_attempt_at = now(),
    metadata = COALESCE(p_metadata, '{}'::jsonb)
  RETURNING failed_attempts, window_started_at INTO v_attempts, v_window_started;

  IF v_attempts >= v_limits.max_attempts THEN
    v_locked_until := now() + (v_limits.lockout_minutes || ' minutes')::interval;
    UPDATE public.auth_lockouts
    SET locked_until = v_locked_until
    WHERE lockout_type = p_lockout_type AND identifier = v_identifier;

    IF NOT COALESCE(v_was_locked, false) AND v_attempts = v_limits.max_attempts THEN
      IF p_lockout_type IN ('login_email', 'login_ip') THEN
        PERFORM public._enqueue_security_alert(
          'login_blocked',
          p_lockout_type,
          v_identifier,
          jsonb_build_object(
            'email', p_email,
            'ip_address', p_ip_address,
            'failed_attempts', v_attempts,
            'locked_until', v_locked_until
          )
        );
      ELSIF p_lockout_type = 'pos_manager_pin_register' THEN
        PERFORM public._enqueue_security_alert(
          'pos_manager_pin_locked',
          p_lockout_type,
          v_identifier,
          jsonb_build_object(
            'register_id', v_identifier,
            'failed_attempts', v_attempts,
            'locked_until', v_locked_until,
            'metadata', COALESCE(p_metadata, '{}'::jsonb)
          )
        );
      END IF;
    END IF;

    IF p_lockout_type IN ('login_email', 'login_ip') THEN
      PERFORM public.log_security_event(
        'login_blocked',
        p_email,
        NULL,
        p_ip_address,
        NULL,
        jsonb_build_object(
          'lockout_type', p_lockout_type,
          'identifier', v_identifier,
          'failed_attempts', v_attempts,
          'locked_until', v_locked_until
        )
      );
    END IF;
  ELSIF p_lockout_type IN ('login_email', 'login_ip') THEN
    PERFORM public.log_security_event(
      'login_failed',
      p_email,
      NULL,
      p_ip_address,
      NULL,
      jsonb_build_object('lockout_type', p_lockout_type, 'failed_attempts', v_attempts)
    );
  END IF;

  RETURN jsonb_build_object(
    'locked', v_locked_until IS NOT NULL,
    'locked_until', v_locked_until,
    'failed_attempts', v_attempts,
    'attempts_remaining', GREATEST(0, v_limits.max_attempts - v_attempts)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_auth_policies()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_auth_policies%ROWTYPE;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_row FROM public.platform_auth_policies WHERE id = 'default';
  IF NOT FOUND THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'max_login_failures_email', v_row.max_login_failures_email,
    'login_lockout_minutes', v_row.login_lockout_minutes,
    'login_failure_window_minutes', v_row.login_failure_window_minutes,
    'max_login_failures_ip', v_row.max_login_failures_ip,
    'max_pin_failures', v_row.max_pin_failures,
    'pin_lockout_minutes', v_row.pin_lockout_minutes,
    'max_manager_pin_failures_register', v_row.max_manager_pin_failures_register,
    'updated_at', v_row.updated_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_auth_policies TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_auth_policies(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_auth_policies%ROWTYPE;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.platform_auth_policies
  SET
    max_login_failures_email = GREATEST(1, LEAST(100, COALESCE((p_payload->>'max_login_failures_email')::INT, max_login_failures_email))),
    login_lockout_minutes = GREATEST(1, LEAST(1440, COALESCE((p_payload->>'login_lockout_minutes')::INT, login_lockout_minutes))),
    login_failure_window_minutes = GREATEST(1, LEAST(1440, COALESCE((p_payload->>'login_failure_window_minutes')::INT, login_failure_window_minutes))),
    max_login_failures_ip = GREATEST(1, LEAST(1000, COALESCE((p_payload->>'max_login_failures_ip')::INT, max_login_failures_ip))),
    max_pin_failures = GREATEST(1, LEAST(100, COALESCE((p_payload->>'max_pin_failures')::INT, max_pin_failures))),
    pin_lockout_minutes = GREATEST(1, LEAST(1440, COALESCE((p_payload->>'pin_lockout_minutes')::INT, pin_lockout_minutes))),
    max_manager_pin_failures_register = GREATEST(1, LEAST(100, COALESCE((p_payload->>'max_manager_pin_failures_register')::INT, max_manager_pin_failures_register))),
    updated_at = now()
  WHERE id = 'default'
  RETURNING * INTO v_row;

  PERFORM public.log_platform_audit(
    'security.auth_policies_update',
    'platform_auth_policies',
    NULL,
    NULL,
    p_payload
  );

  RETURN jsonb_build_object(
    'max_login_failures_email', v_row.max_login_failures_email,
    'login_lockout_minutes', v_row.login_lockout_minutes,
    'login_failure_window_minutes', v_row.login_failure_window_minutes,
    'max_login_failures_ip', v_row.max_login_failures_ip,
    'max_pin_failures', v_row.max_pin_failures,
    'pin_lockout_minutes', v_row.pin_lockout_minutes,
    'max_manager_pin_failures_register', v_row.max_manager_pin_failures_register,
    'updated_at', v_row.updated_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_auth_policies TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_auth_security_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT value INTO v_value
  FROM public.platform_settings
  WHERE key = 'security_alerts';

  RETURN COALESCE(
    v_value,
    jsonb_build_object('enabled', false, 'webhook_url', '', 'notify_slack', true)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_auth_security_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_auth_security_settings(p_settings JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next JSONB;
  v_url TEXT;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_url := NULLIF(trim(p_settings->>'webhook_url'), '');
  IF (p_settings->>'enabled')::BOOLEAN = true AND v_url IS NULL THEN
    RAISE EXCEPTION 'Webhook URL is required when alerts are enabled';
  END IF;

  v_next := jsonb_build_object(
    'enabled', COALESCE((p_settings->>'enabled')::BOOLEAN, false),
    'webhook_url', COALESCE(v_url, ''),
    'notify_slack', COALESCE((p_settings->>'notify_slack')::BOOLEAN, true)
  );

  INSERT INTO public.platform_settings (key, value, updated_at, updated_by)
  VALUES ('security_alerts', v_next, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();

  PERFORM public.log_platform_audit(
    'security.alert_settings_update',
    'platform_settings',
    NULL,
    NULL,
    jsonb_build_object('enabled', v_next->'enabled', 'notify_slack', v_next->'notify_slack')
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_auth_security_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_auth_lockouts(
  p_limit INT DEFAULT 50,
  p_active_only BOOLEAN DEFAULT true
)
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
      SELECT jsonb_agg(
        jsonb_build_object(
          'lockout_type', al.lockout_type,
          'identifier', al.identifier,
          'failed_attempts', al.failed_attempts,
          'locked_until', al.locked_until,
          'last_attempt_at', al.last_attempt_at,
          'is_active', al.locked_until IS NOT NULL AND al.locked_until > now(),
          'metadata', al.metadata
        )
        ORDER BY al.last_attempt_at DESC
      )
      FROM (
        SELECT *
        FROM public.auth_lockouts al
        WHERE NOT p_active_only
          OR (al.locked_until IS NOT NULL AND al.locked_until > now())
        ORDER BY al.last_attempt_at DESC
        LIMIT GREATEST(1, LEAST(p_limit, 200))
      ) al
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_auth_lockouts TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unlock_auth_lockout(
  p_lockout_type TEXT,
  p_identifier TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identifier TEXT;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_identifier := NULLIF(trim(lower(p_identifier)), '');
  IF v_identifier IS NULL OR p_lockout_type IS NULL OR length(trim(p_lockout_type)) = 0 THEN
    RAISE EXCEPTION 'Invalid lockout';
  END IF;

  DELETE FROM public.auth_lockouts
  WHERE lockout_type = p_lockout_type AND identifier = v_identifier;

  PERFORM public.log_platform_audit(
    'security.unlock_lockout',
    'auth_lockouts',
    NULL,
    NULL,
    jsonb_build_object('lockout_type', p_lockout_type, 'identifier', v_identifier)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_unlock_auth_lockout TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_claim_security_alerts(p_limit INT DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  WITH picked AS (
    SELECT id
    FROM public.security_alert_queue
    WHERE processed_at IS NULL
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.security_alert_queue q
    SET processed_at = now(), delivery_status = 'processing'
    FROM picked
    WHERE q.id = picked.id
    RETURNING q.*
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'alert_type', u.alert_type,
        'lockout_type', u.lockout_type,
        'identifier', u.identifier,
        'payload', u.payload,
        'created_at', u.created_at
      )
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM updated u;

  RETURN v_rows;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_claim_security_alerts TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_complete_security_alert(
  p_alert_id UUID,
  p_status TEXT,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.security_alert_queue
  SET
    delivery_status = p_status,
    delivery_error = NULLIF(trim(p_error), '')
  WHERE id = p_alert_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_complete_security_alert TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_security_alert_settings_internal()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.platform_settings WHERE key = 'security_alerts'),
    jsonb_build_object('enabled', false, 'webhook_url', '', 'notify_slack', true)
  );
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_security_alert_settings_internal TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_claim_security_alerts TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_complete_security_alert TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_security_alert_settings_internal TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_security_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - interval '24 hours';
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'stats', jsonb_build_object(
      'failed_logins_24h', (
        SELECT COUNT(*) FROM platform_security_events
        WHERE event_type = 'login_failed' AND created_at >= v_since
      ),
      'login_blocked_24h', (
        SELECT COUNT(*) FROM platform_security_events
        WHERE event_type = 'login_blocked' AND created_at >= v_since
      ),
      'active_lockouts', (
        SELECT COUNT(*) FROM public.auth_lockouts
        WHERE locked_until IS NOT NULL AND locked_until > now()
      ),
      'suspended_orgs', (SELECT COUNT(*) FROM organizations WHERE status = 'suspended'),
      'pending_orgs', (SELECT COUNT(*) FROM organizations WHERE status = 'pending'),
      'disabled_users', (SELECT COUNT(*) FROM user_security_flags WHERE is_disabled = true),
      'admin_actions_24h', (
        SELECT COUNT(*) FROM platform_audit_logs WHERE created_at >= v_since
      )
    ),
    'suspended_organizations', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'status', o.status,
            'created_at', o.created_at
          )
          ORDER BY o.updated_at DESC
        )
        FROM organizations o
        WHERE o.status = 'suspended'
        LIMIT 20
      ),
      '[]'::jsonb
    ),
    'recent_security_events', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'event_type', e.event_type,
            'email', e.email,
            'ip_address', e.ip_address,
            'created_at', e.created_at
          )
          ORDER BY e.created_at DESC
        )
        FROM (
          SELECT * FROM platform_security_events
          ORDER BY created_at DESC
          LIMIT 15
        ) e
      ),
      '[]'::jsonb
    ),
    'recent_admin_actions', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', l.id,
            'action', l.action,
            'actor_email', l.actor_email,
            'created_at', l.created_at
          )
          ORDER BY l.created_at DESC
        )
        FROM (
          SELECT * FROM platform_audit_logs
          ORDER BY created_at DESC
          LIMIT 15
        ) l
      ),
      '[]'::jsonb
    )
  );
END;
$$;

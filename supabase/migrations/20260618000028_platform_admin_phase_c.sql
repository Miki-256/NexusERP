-- Phase C: Security dashboard, security events, access debugger, user flags.

CREATE TABLE IF NOT EXISTS platform_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  email TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_created ON platform_security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON platform_security_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_email ON platform_security_events(lower(email), created_at DESC);

ALTER TABLE platform_security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_security_events_select ON platform_security_events;
CREATE POLICY platform_security_events_select ON platform_security_events FOR SELECT
  USING (public.platform_admin_can_read());

CREATE TABLE IF NOT EXISTS user_security_flags (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_disabled BOOLEAN NOT NULL DEFAULT false,
  disabled_reason TEXT,
  disabled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  disabled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_security_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_security_flags_select ON user_security_flags;
CREATE POLICY user_security_flags_select ON user_security_flags FOR SELECT
  USING (public.platform_admin_can_read());

-- Server-side insert for failed login logging (no auth required; rate-limit at app layer).
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_event_type TEXT,
  p_email TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_event_type NOT IN ('login_failed', 'login_success') THEN
    IF auth.uid() IS NULL OR NOT public.platform_admin_can_read() THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  INSERT INTO platform_security_events (
    event_type, email, user_id, ip_address, user_agent, metadata
  ) VALUES (
    p_event_type,
    NULLIF(trim(p_email), ''),
    p_user_id,
    NULLIF(trim(p_ip_address), ''),
    NULLIF(trim(p_user_agent), ''),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_security_event TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.admin_list_security_events(
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0,
  p_event_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_rows JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM platform_security_events e
  WHERE p_event_type IS NULL OR e.event_type = p_event_type;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'event_type', x.event_type,
        'email', x.email,
        'user_id', x.user_id,
        'ip_address', x.ip_address,
        'metadata', x.metadata,
        'created_at', x.created_at
      )
      ORDER BY x.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_rows
  FROM (
    SELECT e.*
    FROM platform_security_events e
    WHERE p_event_type IS NULL OR e.event_type = p_event_type
    ORDER BY e.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) x;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_security_events TO authenticated;

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
GRANT EXECUTE ON FUNCTION public.admin_get_security_dashboard TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_user_security(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_flags user_security_flags%ROWTYPE;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_user FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT * INTO v_flags FROM user_security_flags WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'user_id', v_user.id,
    'email', v_user.email,
    'is_disabled', COALESCE(v_flags.is_disabled, false),
    'disabled_reason', v_flags.disabled_reason,
    'disabled_at', v_flags.disabled_at,
    'banned_until', v_user.banned_until
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_user_security TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_disabled(
  p_user_id UUID,
  p_disabled BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_manage_admins() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  INSERT INTO user_security_flags (user_id, is_disabled, disabled_reason, disabled_by, disabled_at, updated_at)
  VALUES (
    p_user_id,
    p_disabled,
    NULLIF(trim(p_reason), ''),
    auth.uid(),
    CASE WHEN p_disabled THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    is_disabled = EXCLUDED.is_disabled,
    disabled_reason = EXCLUDED.disabled_reason,
    disabled_by = EXCLUDED.disabled_by,
    disabled_at = EXCLUDED.disabled_at,
    updated_at = now();

  PERFORM public.log_platform_audit(
    CASE WHEN p_disabled THEN 'security.user_disable' ELSE 'security.user_enable' END,
    'user',
    p_user_id,
    NULL,
    jsonb_build_object('reason', NULLIF(trim(p_reason), ''))
  );

  PERFORM public.log_security_event(
    CASE WHEN p_disabled THEN 'user_disabled' ELSE 'user_enabled' END,
    (SELECT email::text FROM auth.users WHERE id = p_user_id),
    p_user_id,
    NULL,
    NULL,
    jsonb_build_object('reason', NULLIF(trim(p_reason), ''))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_user_disabled TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_debug_user_access(
  p_user_id UUID,
  p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_flags user_security_flags%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_member organization_members%ROWTYPE;
  v_checks JSONB := '[]'::jsonb;
  v_can_access BOOLEAN := false;
  v_summary TEXT;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_user FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'can_access', false,
      'summary', 'User account does not exist.',
      'checks', jsonb_build_array(jsonb_build_object('label', 'User exists', 'pass', false))
    );
  END IF;

  SELECT * INTO v_flags FROM user_security_flags WHERE user_id = p_user_id;

  v_checks := v_checks || jsonb_build_object(
    'label', 'User exists',
    'pass', true,
    'detail', v_user.email
  );

  v_checks := v_checks || jsonb_build_object(
    'label', 'Account not platform-disabled',
    'pass', NOT COALESCE(v_flags.is_disabled, false),
    'detail', COALESCE(v_flags.disabled_reason, 'OK')
  );

  v_checks := v_checks || jsonb_build_object(
    'label', 'Auth ban not active',
    'pass', v_user.banned_until IS NULL OR v_user.banned_until < now(),
    'detail', COALESCE(v_user.banned_until::text, 'No ban')
  );

  v_checks := v_checks || jsonb_build_object(
    'label', 'Email confirmed',
    'pass', v_user.email_confirmed_at IS NOT NULL,
    'detail', COALESCE(v_user.email_confirmed_at::text, 'Not confirmed')
  );

  IF p_organization_id IS NULL THEN
    SELECT m.organization_id INTO p_organization_id
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_user_id AND m.is_active = true
    ORDER BY m.created_at
    LIMIT 1;
  END IF;

  IF p_organization_id IS NULL THEN
    v_checks := v_checks || jsonb_build_object(
      'label', 'Organization membership',
      'pass', false,
      'detail', 'User belongs to no organization'
    );
    v_summary := 'No organization membership found.';
  ELSE
    SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;
    SELECT * INTO v_member
    FROM organization_members
    WHERE user_id = p_user_id AND organization_id = p_organization_id;

    v_checks := v_checks || jsonb_build_object(
      'label', 'Organization exists',
      'pass', FOUND,
      'detail', COALESCE(v_org.name, 'Not found')
    );

    IF v_org.id IS NOT NULL THEN
      v_checks := v_checks || jsonb_build_object(
        'label', 'Organization status is active',
        'pass', v_org.status = 'active',
        'detail', v_org.status::text
      );
    END IF;

    v_checks := v_checks || jsonb_build_object(
      'label', 'User is org member',
      'pass', v_member.id IS NOT NULL,
      'detail', CASE WHEN v_member.id IS NULL THEN 'Not a member' ELSE v_member.role::text END
    );

    IF v_member.id IS NOT NULL THEN
      v_checks := v_checks || jsonb_build_object(
        'label', 'Membership is active',
        'pass', v_member.is_active = true,
        'detail', CASE WHEN v_member.is_active THEN 'Active' ELSE 'Inactive' END
      );
    END IF;
  END IF;

  SELECT bool_and((c->>'pass')::boolean) INTO v_can_access
  FROM jsonb_array_elements(v_checks) c;

  v_summary := CASE
    WHEN v_can_access THEN 'User should be able to access this organization.'
    ELSE 'One or more access checks failed — see details below.'
  END;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'organization_id', p_organization_id,
    'can_access', COALESCE(v_can_access, false),
    'summary', v_summary,
    'checks', v_checks
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_debug_user_access TO authenticated;

CREATE OR REPLACE FUNCTION public.user_access_blocked()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_security_flags f
    WHERE f.user_id = auth.uid() AND f.is_disabled = true
  )
  OR EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND u.banned_until IS NOT NULL
      AND u.banned_until > now()
  );
$$;
GRANT EXECUTE ON FUNCTION public.user_access_blocked TO authenticated;

-- Extend user profile with security flag
CREATE OR REPLACE FUNCTION public.admin_get_user_profile(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base JSONB;
  v_security JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'email_confirmed_at', u.email_confirmed_at
    ),
    'is_platform_admin', EXISTS (SELECT 1 FROM platform_admins WHERE user_id = p_user_id),
    'platform_admin_role', (SELECT role FROM platform_admins WHERE user_id = p_user_id),
    'memberships', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'organization_id', o.id,
            'organization_name', o.name,
            'organization_status', o.status,
            'member_id', m.id,
            'role', m.role,
            'is_active', m.is_active,
            'joined_at', m.created_at
          )
          ORDER BY m.created_at
        ),
        '[]'::jsonb
      )
      FROM organization_members m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = p_user_id
    )
  ) INTO v_base
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_security := public.admin_get_user_security(p_user_id);

  RETURN v_base || jsonb_build_object(
    'security', v_security
  );
END;
$$;

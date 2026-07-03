-- Phase A: Enterprise auth throttling — login email/IP lockouts + manager PIN register lockout.

CREATE TABLE IF NOT EXISTS public.platform_auth_policies (
  id TEXT PRIMARY KEY DEFAULT 'default',
  max_login_failures_email INT NOT NULL DEFAULT 5,
  login_lockout_minutes INT NOT NULL DEFAULT 15,
  login_failure_window_minutes INT NOT NULL DEFAULT 15,
  max_login_failures_ip INT NOT NULL DEFAULT 30,
  max_pin_failures INT NOT NULL DEFAULT 5,
  pin_lockout_minutes INT NOT NULL DEFAULT 15,
  max_manager_pin_failures_register INT NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_auth_policies_email_max CHECK (max_login_failures_email > 0),
  CONSTRAINT platform_auth_policies_ip_max CHECK (max_login_failures_ip > 0)
);

INSERT INTO public.platform_auth_policies (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_auth_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_auth_policies_deny ON public.platform_auth_policies;
CREATE POLICY platform_auth_policies_deny ON public.platform_auth_policies
  FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.auth_lockouts (
  lockout_type TEXT NOT NULL,
  identifier TEXT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (lockout_type, identifier)
);

CREATE INDEX IF NOT EXISTS idx_auth_lockouts_locked
  ON public.auth_lockouts (locked_until)
  WHERE locked_until IS NOT NULL;

ALTER TABLE public.auth_lockouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_lockouts_deny ON public.auth_lockouts;
CREATE POLICY auth_lockouts_deny ON public.auth_lockouts
  FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public._default_auth_policy()
RETURNS public.platform_auth_policies
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.platform_auth_policies p
  WHERE p.id = 'default';
$$;

CREATE OR REPLACE FUNCTION public._auth_limits_for_type(p_lockout_type TEXT)
RETURNS TABLE (
  max_attempts INT,
  window_minutes INT,
  lockout_minutes INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy public.platform_auth_policies%ROWTYPE;
BEGIN
  SELECT * INTO v_policy FROM public._default_auth_policy();
  IF NOT FOUND THEN
    max_attempts := 100;
    window_minutes := 15;
    lockout_minutes := 15;
    RETURN NEXT;
    RETURN;
  END IF;

  CASE p_lockout_type
    WHEN 'login_email' THEN
      max_attempts := v_policy.max_login_failures_email;
      window_minutes := v_policy.login_failure_window_minutes;
      lockout_minutes := v_policy.login_lockout_minutes;
    WHEN 'login_ip' THEN
      max_attempts := v_policy.max_login_failures_ip;
      window_minutes := v_policy.login_failure_window_minutes;
      lockout_minutes := v_policy.login_lockout_minutes;
    WHEN 'pos_manager_pin_register' THEN
      max_attempts := v_policy.max_manager_pin_failures_register;
      window_minutes := v_policy.pin_lockout_minutes;
      lockout_minutes := v_policy.pin_lockout_minutes;
    ELSE
      max_attempts := 100;
      window_minutes := 15;
      lockout_minutes := 15;
  END CASE;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_auth_throttle(
  p_lockout_type TEXT,
  p_identifier TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identifier TEXT;
  v_limits RECORD;
  v_row public.auth_lockouts%ROWTYPE;
  v_attempts INT;
BEGIN
  v_identifier := NULLIF(trim(lower(p_identifier)), '');
  IF v_identifier IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  SELECT * INTO v_limits FROM public._auth_limits_for_type(p_lockout_type);

  SELECT * INTO v_row
  FROM public.auth_lockouts
  WHERE lockout_type = p_lockout_type AND identifier = v_identifier;

  IF FOUND AND v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'locked_until', v_row.locked_until,
      'reason', 'locked',
      'attempts_remaining', 0,
      'max_attempts', v_limits.max_attempts
    );
  END IF;

  v_attempts := COALESCE(v_row.failed_attempts, 0);
  IF FOUND AND v_row.window_started_at + (v_limits.window_minutes || ' minutes')::interval <= now() THEN
    v_attempts := 0;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'attempts_remaining', GREATEST(0, v_limits.max_attempts - v_attempts),
    'max_attempts', v_limits.max_attempts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_auth_throttle TO anon, authenticated;

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
BEGIN
  v_identifier := NULLIF(trim(lower(p_identifier)), '');
  IF v_identifier IS NULL THEN
    RETURN jsonb_build_object('locked', false);
  END IF;

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

GRANT EXECUTE ON FUNCTION public.record_auth_failure TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_auth_success(
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
  v_identifier := NULLIF(trim(lower(p_identifier)), '');
  IF v_identifier IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.auth_lockouts
  WHERE lockout_type = p_lockout_type AND identifier = v_identifier;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_auth_success TO anon, authenticated;

-- Allow login_blocked events from public auth throttling.
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
  IF p_event_type NOT IN ('login_failed', 'login_success', 'login_blocked') THEN
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

-- Manager PIN: register-level lockout after repeated wrong overrides.
CREATE OR REPLACE FUNCTION public.verify_pos_manager_pin(
  p_register_id UUID,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_reg registers%ROWTYPE;
  v_staff pos_staff%ROWTYPE;
  v_register_key TEXT;
  v_throttle JSONB;
  v_failure JSONB;
BEGIN
  SELECT * INTO v_reg FROM registers WHERE id = p_register_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  v_register_key := p_register_id::TEXT;
  v_throttle := public.check_auth_throttle('pos_manager_pin_register', v_register_key);
  IF COALESCE((v_throttle->>'allowed')::BOOLEAN, true) = false THEN
    RETURN jsonb_build_object(
      'approved', false,
      'reason', 'Manager PIN locked on this register. Try again later.',
      'locked_until', v_throttle->'locked_until'
    );
  END IF;

  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RETURN jsonb_build_object('approved', false, 'reason', 'Invalid PIN');
  END IF;

  FOR v_staff IN
    SELECT * FROM pos_staff
    WHERE organization_id = v_reg.organization_id
      AND role = 'manager'
      AND is_active = true
      AND (store_ids IS NULL OR v_reg.store_id = ANY(store_ids))
  LOOP
    IF v_staff.pin_locked_until IS NOT NULL AND v_staff.pin_locked_until > now() THEN
      CONTINUE;
    END IF;
    IF v_staff.pin_hash IS NOT NULL
       AND v_staff.pin_hash = extensions.crypt(p_pin, v_staff.pin_hash) THEN
      PERFORM public.record_auth_success('pos_manager_pin_register', v_register_key);
      RETURN jsonb_build_object(
        'approved', true,
        'manager_id', v_staff.id,
        'manager_name', v_staff.display_name
      );
    END IF;
  END LOOP;

  v_failure := public.record_auth_failure(
    'pos_manager_pin_register',
    v_register_key,
    NULL,
    NULL,
    jsonb_build_object('register_id', p_register_id, 'organization_id', v_reg.organization_id)
  );

  RETURN jsonb_build_object(
    'approved', false,
    'reason', CASE
      WHEN COALESCE((v_failure->>'locked')::BOOLEAN, false) THEN
        'Manager PIN locked on this register. Try again later.'
      ELSE 'Incorrect manager PIN'
    END,
    'locked_until', v_failure->'locked_until'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_pos_manager_pin TO anon, authenticated;

-- Fix: pgcrypto lives in the extensions schema on Supabase hosted projects.
-- Functions with SET search_path = public cannot resolve gen_salt/crypt.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.create_pos_staff(
  p_organization_id UUID,
  p_display_name TEXT,
  p_pin TEXT,
  p_role member_role DEFAULT 'cashier',
  p_store_ids UUID[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_can_manage(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF length(trim(p_display_name)) < 2 THEN
    RAISE EXCEPTION 'Name must be at least 2 characters';
  END IF;

  IF p_pin !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4–6 digits';
  END IF;

  IF p_role NOT IN ('cashier', 'manager') THEN
    RAISE EXCEPTION 'Invalid role for POS staff';
  END IF;

  INSERT INTO pos_staff (
    organization_id, display_name, pin_hash, role, store_ids, created_by
  ) VALUES (
    p_organization_id,
    trim(p_display_name),
    extensions.crypt(p_pin, extensions.gen_salt('bf')),
    p_role,
    p_store_ids,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pos_staff TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_pos_staff_pin(
  p_staff_id UUID,
  p_pin TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM pos_staff WHERE id = p_staff_id;
  IF NOT FOUND OR NOT public.user_can_manage(v_org) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_pin !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4–6 digits';
  END IF;

  UPDATE pos_staff
  SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      failed_pin_attempts = 0,
      pin_locked_until = NULL,
      updated_at = now()
  WHERE id = p_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_pos_staff_pin TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_pos_staff_pin(
  p_register_id UUID,
  p_staff_id UUID,
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
  v_token TEXT;
  v_session_id UUID;
BEGIN
  SELECT * INTO v_reg FROM registers WHERE id = p_register_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  SELECT * INTO v_staff FROM pos_staff
  WHERE id = p_staff_id
    AND organization_id = v_reg.organization_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid staff';
  END IF;

  IF v_staff.store_ids IS NOT NULL AND NOT (v_reg.store_id = ANY(v_staff.store_ids)) THEN
    RAISE EXCEPTION 'Staff not assigned to this store';
  END IF;

  IF v_staff.pin_locked_until IS NOT NULL AND v_staff.pin_locked_until > now() THEN
    RAISE EXCEPTION 'PIN locked. Try again later.';
  END IF;

  IF v_staff.pin_hash IS DISTINCT FROM extensions.crypt(p_pin, v_staff.pin_hash) THEN
    UPDATE pos_staff
    SET failed_pin_attempts = failed_pin_attempts + 1,
        pin_locked_until = CASE
          WHEN failed_pin_attempts + 1 >= 5 THEN now() + interval '15 minutes'
          ELSE pin_locked_until
        END,
        updated_at = now()
    WHERE id = p_staff_id;
    RAISE EXCEPTION 'Incorrect PIN';
  END IF;

  UPDATE pos_staff
  SET failed_pin_attempts = 0, pin_locked_until = NULL, updated_at = now()
  WHERE id = p_staff_id;

  DELETE FROM pos_staff_sessions
  WHERE staff_id = p_staff_id AND register_id = p_register_id;

  INSERT INTO pos_staff_sessions (staff_id, register_id, organization_id, expires_at)
  VALUES (p_staff_id, p_register_id, v_reg.organization_id, now() + interval '12 hours')
  RETURNING token, id INTO v_token, v_session_id;

  RETURN jsonb_build_object(
    'token', v_token,
    'staff_id', v_staff.id,
    'display_name', v_staff.display_name,
    'role', v_staff.role,
    'organization_id', v_reg.organization_id,
    'register_id', p_register_id,
    'expires_at', (now() + interval '12 hours')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_pos_staff_pin TO anon, authenticated;

-- Sibling registers for POS switcher (same store as the current register).

CREATE OR REPLACE FUNCTION public.list_pos_store_registers(p_register_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id UUID;
  v_org_id UUID;
BEGIN
  SELECT store_id, organization_id INTO v_store_id, v_org_id
  FROM registers
  WHERE id = p_register_id AND is_active = true;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'is_current', r.id = p_register_id
        )
        ORDER BY r.name
      )
      FROM registers r
      WHERE r.store_id = v_store_id
        AND r.organization_id = v_org_id
        AND r.is_active = true
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_pos_store_registers(UUID) TO anon, authenticated;

-- Security pulse for Admin Health Level 3.
CREATE OR REPLACE FUNCTION public.admin_platform_security_pulse()
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

  RETURN jsonb_build_object(
    'security_events_24h', (
      SELECT COUNT(*)::INT FROM platform_security_events
      WHERE created_at >= now() - interval '24 hours'
    ),
    'security_events_7d', (
      SELECT COUNT(*)::INT FROM platform_security_events
      WHERE created_at >= now() - interval '7 days'
    ),
    'platform_audit_24h', (
      SELECT COUNT(*)::INT FROM platform_audit_logs
      WHERE created_at >= now() - interval '24 hours'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_platform_security_pulse() TO authenticated;

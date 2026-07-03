-- Week 3: Security hardening — narrow anon RPC surface, log_security_event lockdown, product image cleanup.

-- ---------------------------------------------------------------------------
-- SUP-011: log_security_event — login events only via service_role (API routes)
-- ---------------------------------------------------------------------------

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
  v_jwt_role TEXT := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_service BOOLEAN := v_jwt_role = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin');
BEGIN
  IF v_service THEN
    NULL;
  ELSIF p_event_type IN ('login_failed', 'login_success', 'login_blocked') THEN
    RAISE EXCEPTION 'Access denied';
  ELSIF auth.uid() IS NULL OR NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
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

REVOKE ALL ON FUNCTION public.log_security_event(TEXT, TEXT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_security_event(TEXT, TEXT, UUID, TEXT, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_security_event(TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_security_event(TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- SUP-006: Auth throttle RPCs — remove anon; login API uses service_role
-- POS manager PIN still works via verify_pos_manager_pin (SECURITY DEFINER).
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.check_auth_throttle(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.record_auth_failure(TEXT, TEXT, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.record_auth_success(TEXT, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.check_auth_throttle(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_auth_failure(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_auth_success(TEXT, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION public.check_auth_throttle(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_auth_failure(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_auth_success(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.check_auth_throttle IS
  'Login throttling — call from server API via service_role. POS uses verify_pos_manager_pin internally.';

-- ---------------------------------------------------------------------------
-- SUP-012: Deactivate product + return image URL for storage cleanup
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.deactivate_product_catalog_item(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_image_url TEXT;
  v_name TEXT;
BEGIN
  SELECT organization_id, image_url, name
  INTO v_org, v_image_url, v_name
  FROM products
  WHERE id = p_product_id;

  IF NOT FOUND OR NOT public.user_can_manage(v_org) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE products
  SET is_active = false, image_url = NULL, updated_at = now()
  WHERE id = p_product_id;

  UPDATE product_variants
  SET is_active = false
  WHERE product_id = p_product_id;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'name', v_name,
    'image_url', v_image_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_product_catalog_item(UUID) TO authenticated;

-- Orphan storage paths: objects in product-images not referenced by any product.image_url
CREATE OR REPLACE FUNCTION public.list_orphan_product_image_paths(p_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_paths JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(o.name ORDER BY o.created_at), '[]'::jsonb)
  INTO v_paths
  FROM (
    SELECT o.name, o.created_at
    FROM storage.objects o
    WHERE o.bucket_id = 'product-images'
      AND NOT EXISTS (
        SELECT 1
        FROM products p
        WHERE p.image_url IS NOT NULL
          AND p.image_url LIKE '%' || o.name || '%'
      )
    ORDER BY o.created_at
    LIMIT v_limit
  ) o;

  RETURN jsonb_build_object('paths', v_paths, 'count', jsonb_array_length(v_paths));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_orphan_product_image_paths(INT) TO service_role;

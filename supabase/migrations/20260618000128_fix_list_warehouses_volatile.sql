-- list_warehouses auto-provisions warehouses via ensure_org_warehouses (INSERT).
-- STABLE marks the function read-only, causing: "cannot execute INSERT in a read-only transaction".
CREATE OR REPLACE FUNCTION public.list_warehouses(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  PERFORM public.ensure_org_warehouses(p_org_id);

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', w.id,
          'store_id', w.store_id,
          'code', w.code,
          'name', w.name,
          'warehouse_type', w.warehouse_type,
          'address', w.address,
          'is_active', w.is_active,
          'location_count', (
            SELECT COUNT(*)::INT FROM storage_locations sl WHERE sl.warehouse_id = w.id AND sl.is_active
          )
        )
        ORDER BY w.name
      )
      FROM warehouses w
      WHERE w.organization_id = p_org_id
    ),
    '[]'::jsonb
  );
END;
$$;

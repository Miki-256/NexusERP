-- NX-AUDIT-003: catalog search must match product AND variant SKU/barcode/name
CREATE OR REPLACE FUNCTION public.list_products_page(
  p_org_id UUID,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_search TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_active_only BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_q TEXT := NULLIF(trim(p_search), '');
  v_total BIGINT;
  v_rows JSONB;
  v_category_counts JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM products p
  WHERE p.organization_id = p_org_id
    AND (NOT COALESCE(p_active_only, false) OR p.is_active = true)
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
    AND (
      v_q IS NULL
      OR p.name ILIKE '%' || v_q || '%'
      OR COALESCE(p.sku, '') ILIKE '%' || v_q || '%'
      OR COALESCE(p.barcode, '') ILIKE '%' || v_q || '%'
      OR EXISTS (
        SELECT 1 FROM product_variants pv
        WHERE pv.product_id = p.id
          AND (
            COALESCE(pv.sku, '') ILIKE '%' || v_q || '%'
            OR COALESCE(pv.barcode, '') ILIKE '%' || v_q || '%'
            OR pv.name ILIKE '%' || v_q || '%'
          )
      )
    );

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      p.id,
      p.name,
      p.sku,
      p.barcode,
      p.sell_price,
      p.cost_price,
      p.reorder_point,
      p.is_active,
      p.image_url,
      p.category_id,
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('name', c.name) ELSE NULL END AS categories,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', pv.id,
            'name', pv.name,
            'sell_price', pv.sell_price,
            'barcode', pv.barcode,
            'sku', pv.sku
          ) ORDER BY pv.name
        )
        FROM product_variants pv
        WHERE pv.product_id = p.id
      ), '[]'::jsonb) AS product_variants
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.organization_id = p_org_id
      AND (NOT COALESCE(p_active_only, false) OR p.is_active = true)
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (
        v_q IS NULL
        OR p.name ILIKE '%' || v_q || '%'
        OR COALESCE(p.sku, '') ILIKE '%' || v_q || '%'
        OR COALESCE(p.barcode, '') ILIKE '%' || v_q || '%'
        OR EXISTS (
          SELECT 1 FROM product_variants pv
          WHERE pv.product_id = p.id
            AND (
              COALESCE(pv.sku, '') ILIKE '%' || v_q || '%'
              OR COALESCE(pv.barcode, '') ILIKE '%' || v_q || '%'
              OR pv.name ILIKE '%' || v_q || '%'
            )
        )
      )
    ORDER BY p.name
    LIMIT v_limit
    OFFSET v_offset
  ) t;

  SELECT COALESCE(jsonb_object_agg(cat_key, cnt), '{}'::jsonb)
  INTO v_category_counts
  FROM (
    SELECT COALESCE(category_id::text, '__none__') AS cat_key, COUNT(*)::bigint AS cnt
    FROM products
    WHERE organization_id = p_org_id
    GROUP BY category_id
  ) cc;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'category_counts', v_category_counts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_products_page(
  UUID, INT, INT, TEXT, UUID, BOOLEAN
) TO authenticated;

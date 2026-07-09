-- POS enterprise optimization: catalog pagination, bootstrap images, idempotent sale race fix.

-- ---------------------------------------------------------------------------
-- Bootstrap: include product imageUrl (removes extra get_pos_catalog RTT on load)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pos_bootstrap(p_register_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg registers%ROWTYPE;
  v_store stores%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_staff JSONB;
  v_catalog JSONB;
  v_session JSONB;
  v_catalog_total INT;
BEGIN
  SELECT * INTO v_reg FROM registers WHERE id = p_register_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  SELECT * INTO v_store FROM stores WHERE id = v_reg.store_id AND is_active = true;
  SELECT * INTO v_org FROM organizations WHERE id = v_reg.organization_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', id, 'display_name', display_name, 'role', role)
    ORDER BY display_name
  ), '[]'::jsonb)
  INTO v_staff
  FROM pos_staff
  WHERE organization_id = v_reg.organization_id
    AND is_active = true
    AND (store_ids IS NULL OR v_reg.store_id = ANY(store_ids));

  SELECT COUNT(*)::INT INTO v_catalog_total
  FROM products p
  JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
  WHERE p.organization_id = v_reg.organization_id AND p.is_active = true;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'name'), '[]'::jsonb)
  INTO v_catalog
  FROM (
    SELECT jsonb_build_object(
      'productId', p.id,
      'variantId', pv.id,
      'name', p.name,
      'variantName', pv.name,
      'sellPrice', COALESCE(pv.sell_price, p.sell_price),
      'barcode', COALESCE(pv.barcode, p.barcode),
      'sku', COALESCE(pv.sku, p.sku),
      'stock', COALESCE(il.quantity, 0),
      'categoryId', p.category_id,
      'categoryName', c.name,
      'imageUrl', p.image_url
    ) AS row,
    p.name
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN inventory_levels il ON il.variant_id = pv.id AND il.store_id = v_reg.store_id
    WHERE p.organization_id = v_reg.organization_id AND p.is_active = true
    ORDER BY p.name
    LIMIT 500
  ) sub;

  SELECT to_jsonb(rs.*)
  INTO v_session
  FROM register_sessions rs
  WHERE rs.register_id = p_register_id AND rs.closed_at IS NULL
  ORDER BY rs.opened_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'register_id', v_reg.id,
    'register_name', v_reg.name,
    'store_id', v_store.id,
    'store_name', v_store.name,
    'organization_id', v_org.id,
    'org_name', v_org.name,
    'currency', v_org.currency,
    'tax_rate', v_org.tax_rate,
    'tax_inclusive', v_org.tax_inclusive,
    'receipt_footer', v_org.receipt_footer,
    'pos_max_cashier_discount_pct', COALESCE(v_org.pos_max_cashier_discount_pct, 15),
    'pos_tips_enabled', COALESCE(v_org.pos_tips_enabled, false),
    'pos_tip_presets', COALESCE(v_org.pos_tip_presets, '[10,15,20]'::jsonb),
    'staff', v_staff,
    'catalog', v_catalog,
    'catalog_total', v_catalog_total,
    'catalog_truncated', v_catalog_total > 500,
    'open_session', v_session
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_bootstrap(UUID) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Paginated / searchable catalog for large SKU lists
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pos_catalog_page(
  p_register_id UUID,
  p_search TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_limit INT DEFAULT 200,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_store UUID;
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_q TEXT := NULLIF(trim(p_search), '');
  v_cat TEXT := NULLIF(trim(p_category), '');
  v_total BIGINT;
  v_items JSONB;
BEGIN
  SELECT organization_id, store_id INTO v_org, v_store
  FROM registers WHERE id = p_register_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM products p
  JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.organization_id = v_org AND p.is_active = true
    AND (v_cat IS NULL OR c.name = v_cat)
    AND (
      v_q IS NULL
      OR p.name ILIKE '%' || v_q || '%'
      OR pv.name ILIKE '%' || v_q || '%'
      OR pv.barcode = v_q
      OR pv.sku ILIKE v_q
      OR p.barcode = v_q
      OR p.sku ILIKE v_q
    );

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'name'), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'productId', p.id,
      'variantId', pv.id,
      'name', p.name,
      'variantName', pv.name,
      'sellPrice', COALESCE(pv.sell_price, p.sell_price),
      'barcode', COALESCE(pv.barcode, p.barcode),
      'sku', COALESCE(pv.sku, p.sku),
      'stock', COALESCE(il.quantity, 0),
      'categoryId', p.category_id,
      'categoryName', c.name,
      'imageUrl', p.image_url
    ) AS row,
    p.name
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN inventory_levels il ON il.variant_id = pv.id AND il.store_id = v_store
    WHERE p.organization_id = v_org AND p.is_active = true
      AND (v_cat IS NULL OR c.name = v_cat)
      AND (
        v_q IS NULL
        OR p.name ILIKE '%' || v_q || '%'
        OR pv.name ILIKE '%' || v_q || '%'
        OR pv.barcode = v_q
        OR pv.sku ILIKE v_q
        OR p.barcode = v_q
        OR p.sku ILIKE v_q
      )
    ORDER BY p.name
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'offset', v_offset,
    'limit', v_limit,
    'has_more', (v_offset + v_limit) < v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_catalog_page(UUID, TEXT, TEXT, INT, INT) TO anon, authenticated;

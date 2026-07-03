-- Tenant product bulk import, barcode lookup, and receive-by-scan.

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_org_barcode_unique
  ON public.products (organization_id, barcode)
  WHERE barcode IS NOT NULL AND length(trim(barcode)) > 0;

-- Resolve product by barcode (EAN-13 / UPC-A variants).
CREATE OR REPLACE FUNCTION public.find_product_by_barcode(
  p_org_id UUID,
  p_barcode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_alt TEXT;
  v_row RECORD;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_code := NULLIF(trim(p_barcode), '');
  IF v_code IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT
    p.id,
    p.name,
    p.sku,
    p.barcode,
    p.sell_price,
    p.cost_price,
    p.category_id,
    p.is_active,
    c.name AS category_name,
    pv.id AS variant_id
  INTO v_row
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  LEFT JOIN public.product_variants pv ON pv.product_id = p.id AND pv.name = 'Default'
  WHERE p.organization_id = p_org_id
    AND p.barcode = v_code
  LIMIT 1;

  IF NOT FOUND AND length(v_code) = 12 AND v_code ~ '^\d+$' THEN
    v_alt := '0' || v_code;
    SELECT
      p.id, p.name, p.sku, p.barcode, p.sell_price, p.cost_price, p.category_id, p.is_active,
      c.name AS category_name, pv.id AS variant_id
    INTO v_row
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.product_variants pv ON pv.product_id = p.id AND pv.name = 'Default'
    WHERE p.organization_id = p_org_id AND p.barcode = v_alt
    LIMIT 1;
  ELSIF NOT FOUND AND length(v_code) = 13 AND v_code ~ '^0\d{12}$' THEN
    v_alt := substring(v_code from 2);
    SELECT
      p.id, p.name, p.sku, p.barcode, p.sell_price, p.cost_price, p.category_id, p.is_active,
      c.name AS category_name, pv.id AS variant_id
    INTO v_row
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.product_variants pv ON pv.product_id = p.id AND pv.name = 'Default'
    WHERE p.organization_id = p_org_id AND p.barcode = v_alt
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'barcode', v_code);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'product_id', v_row.id,
    'variant_id', v_row.variant_id,
    'name', v_row.name,
    'sku', v_row.sku,
    'barcode', v_row.barcode,
    'sell_price', v_row.sell_price,
    'cost_price', v_row.cost_price,
    'category_id', v_row.category_id,
    'category_name', v_row.category_name,
    'is_active', v_row.is_active
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.find_product_by_barcode TO authenticated;

CREATE OR REPLACE FUNCTION public._resolve_category_id(p_org_id UUID, p_category TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat TEXT;
  v_cat_id UUID;
BEGIN
  v_cat := NULLIF(trim(p_category), '');
  IF v_cat IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_cat_id FROM public.categories
  WHERE organization_id = p_org_id AND lower(name) = lower(v_cat);

  IF v_cat_id IS NULL THEN
    INSERT INTO public.categories (organization_id, name)
    VALUES (p_org_id, v_cat)
    RETURNING id INTO v_cat_id;
  END IF;

  RETURN v_cat_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._find_product_for_import(
  p_org_id UUID,
  p_name TEXT,
  p_sku TEXT,
  p_barcode TEXT
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.products p
  WHERE p.organization_id = p_org_id
    AND (
      (p_sku IS NOT NULL AND p.sku = p_sku)
      OR (p_barcode IS NOT NULL AND p.barcode = p_barcode)
      OR (p_sku IS NULL AND p_barcode IS NULL AND p.name = p_name)
    )
  ORDER BY
    CASE WHEN p_sku IS NOT NULL AND p.sku = p_sku THEN 0 ELSE 1 END,
    CASE WHEN p_barcode IS NOT NULL AND p.barcode = p_barcode THEN 0 ELSE 1 END
  LIMIT 1;
$$;

-- Tenant bulk import: skip (default) or update duplicates.
CREATE OR REPLACE FUNCTION public.import_products(
  p_org_id UUID,
  p_rows JSONB,
  p_store_id UUID DEFAULT NULL,
  p_mode TEXT DEFAULT 'skip'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_imported INT := 0;
  v_updated INT := 0;
  v_skipped INT := 0;
  v_errors JSONB := '[]'::jsonb;
  v_row_num INT := 0;
  v_name TEXT;
  v_sku TEXT;
  v_barcode TEXT;
  v_cat TEXT;
  v_cat_id UUID;
  v_product_id UUID;
  v_variant_id UUID;
  v_qty NUMERIC;
  v_sell NUMERIC;
  v_cost NUMERIC;
  v_reorder NUMERIC;
  v_mode TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 5000 THEN
    RAISE EXCEPTION 'Import limited to 5000 rows per batch';
  END IF;

  v_mode := lower(COALESCE(p_mode, 'skip'));
  IF v_mode NOT IN ('skip', 'update') THEN
    RAISE EXCEPTION 'Invalid import mode';
  END IF;

  IF p_store_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.stores WHERE id = p_store_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Invalid store';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_row_num := v_row_num + 1;
    v_name := NULLIF(trim(v_row->>'name'), '');
    v_sku := NULLIF(trim(v_row->>'sku'), '');
    v_barcode := NULLIF(trim(v_row->>'barcode'), '');

    IF v_name IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row_num, 'reason', 'Name is required'));
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      v_sell := COALESCE((v_row->>'sell_price')::NUMERIC, 0);
      v_cost := COALESCE((v_row->>'cost_price')::NUMERIC, 0);
      v_qty := COALESCE((v_row->>'quantity')::NUMERIC, 0);
      v_reorder := COALESCE((v_row->>'reorder_point')::NUMERIC, 0);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row_num, 'reason', 'Invalid numeric value'));
      v_skipped := v_skipped + 1;
      CONTINUE;
    END;

    IF v_sell < 0 OR v_cost < 0 OR v_qty < 0 OR v_reorder < 0 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row_num, 'reason', 'Prices and quantities must be >= 0'));
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_product_id := public._find_product_for_import(p_org_id, v_name, v_sku, v_barcode);

    IF v_product_id IS NOT NULL THEN
      IF v_mode = 'skip' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_cat := NULLIF(trim(v_row->>'category'), '');
      v_cat_id := public._resolve_category_id(p_org_id, v_cat);

      UPDATE public.products
      SET
        name = v_name,
        sku = COALESCE(v_sku, sku),
        barcode = COALESCE(v_barcode, barcode),
        sell_price = v_sell,
        cost_price = v_cost,
        category_id = COALESCE(v_cat_id, category_id),
        reorder_point = v_reorder,
        updated_at = now()
      WHERE id = v_product_id;

      UPDATE public.product_variants
      SET
        sku = COALESCE(v_sku, sku),
        barcode = COALESCE(v_barcode, barcode),
        sell_price = v_sell,
        cost_price = v_cost
      WHERE product_id = v_product_id AND name = 'Default';

      SELECT id INTO v_variant_id
      FROM public.product_variants
      WHERE product_id = v_product_id AND name = 'Default'
      LIMIT 1;

      IF p_store_id IS NOT NULL AND v_variant_id IS NOT NULL AND v_qty <> 0 THEN
        INSERT INTO public.inventory_levels (store_id, variant_id, organization_id, quantity)
        VALUES (p_store_id, v_variant_id, p_org_id, v_qty)
        ON CONFLICT (store_id, variant_id) DO UPDATE
        SET quantity = public.inventory_levels.quantity + EXCLUDED.quantity;
      END IF;

      v_updated := v_updated + 1;
      CONTINUE;
    END IF;

    v_cat := NULLIF(trim(v_row->>'category'), '');
    v_cat_id := public._resolve_category_id(p_org_id, v_cat);

    BEGIN
      INSERT INTO public.products (
        organization_id, category_id, name, sku, barcode,
        sell_price, cost_price, reorder_point
      )
      VALUES (p_org_id, v_cat_id, v_name, v_sku, v_barcode, v_sell, v_cost, v_reorder)
      RETURNING id INTO v_product_id;

      INSERT INTO public.product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
      VALUES (v_product_id, p_org_id, 'Default', v_sku, v_barcode, v_sell, v_cost)
      RETURNING id INTO v_variant_id;

      IF p_store_id IS NOT NULL THEN
        INSERT INTO public.inventory_levels (store_id, variant_id, organization_id, quantity)
        VALUES (p_store_id, v_variant_id, p_org_id, GREATEST(v_qty, 0))
        ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;
      END IF;

      v_imported := v_imported + 1;
    EXCEPTION
      WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row_num,
          'reason', 'Duplicate barcode in catalog'
        ));
        v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO public.audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    p_org_id,
    auth.uid(),
    'organization',
    p_org_id,
    'product.import',
    jsonb_build_object(
      'imported', v_imported,
      'updated', v_updated,
      'skipped', v_skipped,
      'mode', v_mode,
      'store_id', p_store_id,
      'row_count', jsonb_array_length(p_rows)
    )
  );

  RETURN jsonb_build_object(
    'imported', v_imported,
    'updated', v_updated,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.import_products TO authenticated;

-- Receive session: create new products or add stock to existing barcodes.
CREATE OR REPLACE FUNCTION public.bulk_receive_products(
  p_org_id UUID,
  p_store_id UUID,
  p_rows JSONB,
  p_default_category_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_created INT := 0;
  v_stocked INT := 0;
  v_skipped INT := 0;
  v_errors JSONB := '[]'::jsonb;
  v_row_num INT := 0;
  v_barcode TEXT;
  v_name TEXT;
  v_product_id UUID;
  v_variant_id UUID;
  v_qty NUMERIC;
  v_sell NUMERIC;
  v_cost NUMERIC;
  v_lookup JSONB;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_store_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.stores WHERE id = p_store_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Valid store is required';
  END IF;

  IF jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 500 THEN
    RAISE EXCEPTION 'Receive limited to 500 lines per batch';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_row_num := v_row_num + 1;
    v_barcode := NULLIF(trim(v_row->>'barcode'), '');
    v_name := NULLIF(trim(v_row->>'name'), '');
    v_qty := GREATEST(COALESCE((v_row->>'quantity')::NUMERIC, 1), 0);
    v_sell := COALESCE((v_row->>'sell_price')::NUMERIC, 0);
    v_cost := COALESCE((v_row->>'cost_price')::NUMERIC, 0);

    IF v_barcode IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row_num, 'reason', 'Barcode is required'));
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_lookup := public.find_product_by_barcode(p_org_id, v_barcode);

    IF COALESCE((v_lookup->>'found')::BOOLEAN, false) THEN
      v_product_id := (v_lookup->>'product_id')::UUID;
      v_variant_id := (v_lookup->>'variant_id')::UUID;

      IF v_variant_id IS NULL THEN
        SELECT id INTO v_variant_id
        FROM public.product_variants
        WHERE product_id = v_product_id AND name = 'Default'
        LIMIT 1;
      END IF;

      IF v_variant_id IS NOT NULL AND v_qty > 0 THEN
        INSERT INTO public.inventory_levels (store_id, variant_id, organization_id, quantity)
        VALUES (p_store_id, v_variant_id, p_org_id, v_qty)
        ON CONFLICT (store_id, variant_id) DO UPDATE
        SET quantity = public.inventory_levels.quantity + EXCLUDED.quantity;
      END IF;

      v_stocked := v_stocked + 1;
      CONTINUE;
    END IF;

    IF v_name IS NULL OR length(trim(v_name)) = 0 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_num,
        'reason', 'New barcode requires a product name',
        'barcode', v_barcode
      ));
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.products (
        organization_id, category_id, name, barcode,
        sell_price, cost_price
      )
      VALUES (p_org_id, p_default_category_id, v_name, v_barcode, v_sell, v_cost)
      RETURNING id INTO v_product_id;

      INSERT INTO public.product_variants (product_id, organization_id, name, barcode, sell_price, cost_price)
      VALUES (v_product_id, p_org_id, 'Default', v_barcode, v_sell, v_cost)
      RETURNING id INTO v_variant_id;

      INSERT INTO public.inventory_levels (store_id, variant_id, organization_id, quantity)
      VALUES (p_store_id, v_variant_id, p_org_id, v_qty)
      ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

      v_created := v_created + 1;
    EXCEPTION
      WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row_num,
          'reason', 'Barcode already exists',
          'barcode', v_barcode
        ));
        v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO public.audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    p_org_id,
    auth.uid(),
    'organization',
    p_org_id,
    'product.receive_scan',
    jsonb_build_object(
      'created', v_created,
      'stocked', v_stocked,
      'skipped', v_skipped,
      'store_id', p_store_id,
      'line_count', jsonb_array_length(p_rows)
    )
  );

  RETURN jsonb_build_object(
    'created', v_created,
    'stocked', v_stocked,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_receive_products TO authenticated;

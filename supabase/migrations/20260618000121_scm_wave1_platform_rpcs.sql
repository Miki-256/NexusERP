-- SCM Wave 1: platform RPCs, full ledger coverage, PIM & warehouse APIs.

-- ---------------------------------------------------------------------------
-- Warehouse access helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_access_warehouse(
  p_org_id UUID,
  p_warehouse_id UUID,
  p_capability TEXT DEFAULT 'view'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.user_can_manage(p_org_id) THEN RETURN true; END IF;
  IF NOT public.user_has_org_access(p_org_id) THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM warehouse_user_access wua
    JOIN warehouses w ON w.id = wua.warehouse_id
    WHERE wua.warehouse_id = p_warehouse_id
      AND wua.user_id = auth.uid()
      AND w.organization_id = p_org_id
      AND (
        (p_capability = 'view' AND wua.can_view)
        OR (p_capability = 'receive' AND wua.can_receive)
        OR (p_capability = 'pick' AND wua.can_pick)
        OR (p_capability = 'adjust' AND wua.can_adjust)
        OR (p_capability = 'manage' AND wua.can_manage)
      )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Ensure warehouses + default storage location per store
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_org_warehouses(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store RECORD;
  v_wh_id UUID;
  v_count INT := 0;
  v_code TEXT;
BEGIN
  FOR v_store IN
    SELECT s.* FROM stores s WHERE s.organization_id = p_org_id AND s.is_active = true
  LOOP
    v_code := upper(left(regexp_replace(trim(v_store.name), '[^a-zA-Z0-9]+', '-', 'g'), 12));
    IF v_code IS NULL OR length(v_code) = 0 THEN v_code := 'WH-' || left(v_store.id::text, 8); END IF;

    INSERT INTO warehouses (organization_id, store_id, code, name, warehouse_type, address, is_active)
    VALUES (p_org_id, v_store.id, v_code, v_store.name, 'store', v_store.address, true)
    ON CONFLICT (store_id) DO UPDATE SET
      name = EXCLUDED.name,
      address = COALESCE(EXCLUDED.address, warehouses.address),
      is_active = true
    RETURNING id INTO v_wh_id;

    IF v_wh_id IS NULL THEN
      SELECT id INTO v_wh_id FROM warehouses WHERE store_id = v_store.id;
    END IF;

    INSERT INTO storage_locations (
      organization_id, warehouse_id, parent_id, location_type, code, name,
      is_pickable, is_receivable, is_active, sort_order
    ) VALUES (
      p_org_id, v_wh_id, NULL, 'zone', 'DEFAULT', 'Default storage',
      true, true, true, 0
    )
    ON CONFLICT (warehouse_id, code) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Cost layer helper (FIFO foundation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._add_inventory_cost_layer(
  p_org_id UUID,
  p_store_id UUID,
  p_variant_id UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_quantity <= 0 THEN RETURN NULL; END IF;

  INSERT INTO inventory_cost_layers (
    organization_id, store_id, variant_id, quantity_remaining, unit_cost,
    source_type, source_id
  ) VALUES (
    p_org_id, p_store_id, p_variant_id, p_quantity, COALESCE(p_unit_cost, 0),
    p_source_type, p_source_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Stock-in helper (movement ledger + optional cost layer)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_stock_in(
  p_org_id UUID,
  p_store_id UUID,
  p_variant_id UUID,
  p_quantity NUMERIC,
  p_movement_type stock_movement_type,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement_id UUID;
  v_method inventory_costing_method;
BEGIN
  IF p_quantity <= 0 THEN RETURN NULL; END IF;

  v_movement_id := public._apply_stock_movement(
    p_org_id,
    p_movement_type,
    jsonb_build_array(jsonb_build_object(
      'store_id', p_store_id,
      'variant_id', p_variant_id,
      'quantity_delta', p_quantity,
      'unit_cost', p_unit_cost,
      'line_notes', p_notes
    )),
    p_reference_type,
    p_reference_id,
    p_notes,
    auth.uid(),
    p_idempotency_key,
    '{}'::jsonb
  );

  SELECT inventory_costing_method INTO v_method FROM organizations WHERE id = p_org_id;

  IF v_method = 'fifo' THEN
    PERFORM public._add_inventory_cost_layer(
      p_org_id, p_store_id, p_variant_id, p_quantity, p_unit_cost,
      p_reference_type, p_reference_id
    );
  END IF;

  RETURN v_movement_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Sale stock movement (batch deduct after sale lines inserted)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._record_sale_stock_movement(
  p_org_id UUID,
  p_store_id UUID,
  p_sale_id UUID,
  p_lines JSONB,
  p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines JSONB := '[]'::jsonb;
  v_line JSONB;
  v_variant_id UUID;
  v_qty NUMERIC;
BEGIN
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_variant_id := (v_line->>'variantId')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;
    IF v_variant_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'store_id', p_store_id,
      'variant_id', v_variant_id,
      'quantity_delta', -v_qty,
      'line_notes', 'POS sale'
    ));
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN RETURN NULL; END IF;

  RETURN public._apply_stock_movement(
    p_org_id,
    'sale_shipment',
    v_lines,
    'sale',
    p_sale_id,
    'POS sale ' || p_sale_id::text,
    p_user_id,
    'sale_shipment:' || p_sale_id::text,
    '{}'::jsonb
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Warehouses & locations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_warehouses(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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

CREATE OR REPLACE FUNCTION public.list_storage_locations(
  p_warehouse_id UUID,
  p_parent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM warehouses WHERE id = p_warehouse_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found'; END IF;
  IF NOT public.user_can_access_warehouse(v_org_id, p_warehouse_id, 'view') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', sl.id,
          'parent_id', sl.parent_id,
          'location_type', sl.location_type,
          'code', sl.code,
          'name', sl.name,
          'is_pickable', sl.is_pickable,
          'is_receivable', sl.is_receivable,
          'is_active', sl.is_active,
          'sort_order', sl.sort_order
        )
        ORDER BY sl.sort_order, sl.code
      )
      FROM storage_locations sl
      WHERE sl.warehouse_id = p_warehouse_id
        AND (
          (p_parent_id IS NULL AND sl.parent_id IS NULL)
          OR sl.parent_id = p_parent_id
        )
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_storage_location(
  p_warehouse_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_location_type storage_location_type DEFAULT 'bin',
  p_parent_id UUID DEFAULT NULL,
  p_is_pickable BOOLEAN DEFAULT true,
  p_is_receivable BOOLEAN DEFAULT true,
  p_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_id UUID;
  v_code TEXT := upper(NULLIF(trim(p_code), ''));
  v_name TEXT := NULLIF(trim(p_name), '');
BEGIN
  SELECT organization_id INTO v_org_id FROM warehouses WHERE id = p_warehouse_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_code IS NULL OR v_name IS NULL THEN RAISE EXCEPTION 'Code and name required'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE storage_locations SET
      code = v_code, name = v_name, location_type = COALESCE(p_location_type, location_type),
      parent_id = p_parent_id, is_pickable = COALESCE(p_is_pickable, is_pickable),
      is_receivable = COALESCE(p_is_receivable, is_receivable)
    WHERE id = p_id AND warehouse_id = p_warehouse_id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO storage_locations (
    organization_id, warehouse_id, parent_id, location_type, code, name,
    is_pickable, is_receivable
  ) VALUES (
    v_org_id, p_warehouse_id, p_parent_id, COALESCE(p_location_type, 'bin'),
    v_code, v_name, COALESCE(p_is_pickable, true), COALESCE(p_is_receivable, true)
  )
  ON CONFLICT (warehouse_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    location_type = EXCLUDED.location_type,
    parent_id = EXCLUDED.parent_id,
    is_pickable = EXCLUDED.is_pickable,
    is_receivable = EXCLUDED.is_receivable,
    is_active = true
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Extended barcode lookup (product + product_barcodes table)
-- ---------------------------------------------------------------------------
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
  v_variant_id UUID;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  v_code := NULLIF(trim(p_barcode), '');
  IF v_code IS NULL THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT pb.variant_id INTO v_variant_id
  FROM product_barcodes pb
  WHERE pb.organization_id = p_org_id AND pb.barcode = v_code
  LIMIT 1;

  IF v_variant_id IS NOT NULL THEN
    SELECT p.id, p.name, p.sku, p.barcode, p.sell_price, p.cost_price, p.category_id, p.is_active,
           c.name AS category_name, pv.id AS variant_id, pv.name AS variant_name
    INTO v_row
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE pv.id = v_variant_id;

    RETURN jsonb_build_object(
      'found', true,
      'product_id', v_row.id,
      'variant_id', v_row.variant_id,
      'name', v_row.name,
      'variant_name', v_row.variant_name,
      'sku', v_row.sku,
      'barcode', v_code,
      'sell_price', v_row.sell_price,
      'cost_price', v_row.cost_price,
      'category_id', v_row.category_id,
      'category_name', v_row.category_name,
      'is_active', v_row.is_active
    );
  END IF;

  SELECT p.id, p.name, p.sku, p.barcode, p.sell_price, p.cost_price, p.category_id, p.is_active,
         c.name AS category_name, pv.id AS variant_id, pv.name AS variant_name
  INTO v_row
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.name = 'Default'
  WHERE p.organization_id = p_org_id AND p.barcode = v_code
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'found', true, 'product_id', v_row.id, 'variant_id', v_row.variant_id,
      'name', v_row.name, 'variant_name', v_row.variant_name, 'sku', v_row.sku,
      'barcode', v_row.barcode, 'sell_price', v_row.sell_price, 'cost_price', v_row.cost_price,
      'category_id', v_row.category_id, 'category_name', v_row.category_name, 'is_active', v_row.is_active
    );
  END IF;

  SELECT pv.id INTO v_variant_id
  FROM product_variants pv
  WHERE pv.organization_id = p_org_id AND pv.barcode = v_code
  LIMIT 1;

  IF v_variant_id IS NOT NULL THEN
    SELECT p.id, p.name, p.sku, pv.barcode, p.sell_price, p.cost_price, p.category_id, p.is_active,
           c.name AS category_name, pv.id AS variant_id, pv.name AS variant_name
    INTO v_row
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE pv.id = v_variant_id;

    RETURN jsonb_build_object(
      'found', true, 'product_id', v_row.id, 'variant_id', v_row.variant_id,
      'name', v_row.name, 'variant_name', v_row.variant_name, 'sku', v_row.sku,
      'barcode', v_row.barcode, 'sell_price', v_row.sell_price, 'cost_price', v_row.cost_price,
      'category_id', v_row.category_id, 'category_name', v_row.category_name, 'is_active', v_row.is_active
    );
  END IF;

  IF length(v_code) = 13 AND v_code ~ '^\d+$' THEN
    v_alt := ltrim(v_code, '0');
    IF length(v_alt) <= 12 THEN
      RETURN public.find_product_by_barcode(p_org_id, v_alt);
    END IF;
  END IF;

  RETURN jsonb_build_object('found', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- Product detail + variants + barcodes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_detail(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_product JSONB;
BEGIN
  SELECT organization_id INTO v_org_id FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF NOT public.user_has_org_access(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT to_jsonb(p) INTO v_product FROM products p WHERE p.id = p_product_id;

  RETURN jsonb_build_object(
    'product', v_product,
    'variants', COALESCE((
      SELECT jsonb_agg(row_to_json(v) ORDER BY v.name)
      FROM product_variants v WHERE v.product_id = p_product_id AND v.is_active = true
    ), '[]'::jsonb),
    'barcodes', COALESCE((
      SELECT jsonb_agg(row_to_json(b) ORDER BY b.is_primary DESC, b.barcode)
      FROM product_barcodes b
      JOIN product_variants pv ON pv.id = b.variant_id
      WHERE pv.product_id = p_product_id
    ), '[]'::jsonb),
    'uoms', COALESCE((
      SELECT jsonb_agg(row_to_json(u) ORDER BY u.is_base DESC, u.uom_code)
      FROM product_uoms u WHERE u.product_id = p_product_id
    ), '[]'::jsonb),
    'suppliers', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ps.id, 'vendor_id', ps.vendor_id, 'vendor_name', v.name,
          'supplier_sku', ps.supplier_sku, 'unit_cost', ps.unit_cost,
          'lead_time_days', ps.lead_time_days, 'is_preferred', ps.is_preferred
        )
      )
      FROM product_suppliers ps
      JOIN vendors v ON v.id = ps.vendor_id
      WHERE ps.product_id = p_product_id AND ps.is_active
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_product_variant(
  p_product_id UUID,
  p_name TEXT,
  p_sku TEXT DEFAULT NULL,
  p_barcode TEXT DEFAULT NULL,
  p_sell_price NUMERIC DEFAULT NULL,
  p_cost_price NUMERIC DEFAULT NULL,
  p_variant_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_id UUID;
  v_name TEXT := NULLIF(trim(p_name), '');
BEGIN
  SELECT organization_id INTO v_org_id FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Variant name required'; END IF;

  IF p_variant_id IS NOT NULL THEN
    UPDATE product_variants SET
      name = v_name,
      sku = COALESCE(NULLIF(trim(p_sku), ''), sku),
      barcode = COALESCE(NULLIF(trim(p_barcode), ''), barcode),
      sell_price = COALESCE(p_sell_price, sell_price),
      cost_price = COALESCE(p_cost_price, cost_price)
    WHERE id = p_variant_id AND product_id = p_product_id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO product_variants (
    product_id, organization_id, name, sku, barcode, sell_price, cost_price
  ) VALUES (
    p_product_id, v_org_id, v_name,
    NULLIF(trim(p_sku), ''), NULLIF(trim(p_barcode), ''),
    COALESCE(p_sell_price, 0), COALESCE(p_cost_price, 0)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_product_barcode(
  p_variant_id UUID,
  p_barcode TEXT,
  p_barcode_type barcode_type DEFAULT 'other',
  p_is_primary BOOLEAN DEFAULT false,
  p_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_id UUID;
  v_code TEXT := NULLIF(trim(p_barcode), '');
BEGIN
  SELECT organization_id INTO v_org_id FROM product_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_code IS NULL THEN RAISE EXCEPTION 'Barcode required'; END IF;

  IF p_is_primary THEN
    UPDATE product_barcodes SET is_primary = false WHERE variant_id = p_variant_id;
    UPDATE product_variants SET barcode = v_code WHERE id = p_variant_id;
    UPDATE products p SET barcode = v_code
    FROM product_variants pv
    WHERE pv.id = p_variant_id AND p.id = pv.product_id AND pv.name = 'Default';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE product_barcodes SET
      barcode = v_code, barcode_type = COALESCE(p_barcode_type, barcode_type),
      is_primary = COALESCE(p_is_primary, is_primary)
    WHERE id = p_id AND variant_id = p_variant_id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO product_barcodes (organization_id, variant_id, barcode, barcode_type, is_primary)
  VALUES (v_org_id, p_variant_id, v_code, COALESCE(p_barcode_type, 'other'), COALESCE(p_is_primary, false))
  ON CONFLICT (organization_id, barcode) DO UPDATE SET
    variant_id = EXCLUDED.variant_id,
    barcode_type = EXCLUDED.barcode_type,
    is_primary = EXCLUDED.is_primary
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_product_extended(
  p_product_id UUID,
  p_fields JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE products SET
    lifecycle_status = COALESCE((p_fields->>'lifecycle_status')::product_lifecycle_status, lifecycle_status),
    base_uom_code = COALESCE(NULLIF(p_fields->>'base_uom_code', ''), base_uom_code),
    weight_kg = COALESCE((p_fields->>'weight_kg')::NUMERIC, weight_kg),
    length_cm = COALESCE((p_fields->>'length_cm')::NUMERIC, length_cm),
    width_cm = COALESCE((p_fields->>'width_cm')::NUMERIC, width_cm),
    height_cm = COALESCE((p_fields->>'height_cm')::NUMERIC, height_cm),
    hs_code = COALESCE(NULLIF(p_fields->>'hs_code', ''), hs_code),
    country_of_origin = COALESCE(NULLIF(p_fields->>'country_of_origin', ''), country_of_origin),
    shelf_life_days = COALESCE((p_fields->>'shelf_life_days')::INT, shelf_life_days),
    description = COALESCE(NULLIF(p_fields->>'description', ''), description),
    updated_at = now()
  WHERE id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_org_inventory_settings(
  p_org_id UUID,
  p_costing_method inventory_costing_method
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE organizations SET inventory_costing_method = p_costing_method WHERE id = p_org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- create_product_with_variant — ledger for initial stock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_with_variant(
  p_organization_id UUID,
  p_name TEXT,
  p_category_id UUID,
  p_sku TEXT,
  p_barcode TEXT,
  p_sell_price NUMERIC,
  p_cost_price NUMERIC,
  p_tax_rate NUMERIC,
  p_store_id UUID,
  p_initial_qty NUMERIC DEFAULT 0,
  p_image_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_variant_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO products (
    organization_id, category_id, name, sku, barcode,
    sell_price, cost_price, tax_rate, image_url
  ) VALUES (
    p_organization_id, p_category_id, p_name, p_sku, p_barcode,
    p_sell_price, COALESCE(p_cost_price, 0), p_tax_rate, p_image_url
  )
  RETURNING id INTO v_product_id;

  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, p_organization_id, 'Default', p_sku, p_barcode, p_sell_price, COALESCE(p_cost_price, 0))
  RETURNING id INTO v_variant_id;

  INSERT INTO product_uoms (organization_id, product_id, uom_code, uom_name, conversion_factor, is_base, is_sale, is_purchase)
  VALUES (p_organization_id, v_product_id, 'ea', 'Each', 1, true, true, true)
  ON CONFLICT (product_id, uom_code) DO NOTHING;

  IF p_barcode IS NOT NULL AND length(trim(p_barcode)) > 0 THEN
    PERFORM public.upsert_product_barcode(v_variant_id, p_barcode, 'other', true);
  END IF;

  IF p_store_id IS NOT NULL THEN
    IF COALESCE(p_initial_qty, 0) > 0 THEN
      PERFORM public._apply_stock_in(
        p_organization_id, p_store_id, v_variant_id, p_initial_qty,
        'initial_stock', 'product', v_product_id, COALESCE(p_cost_price, 0),
        'Initial stock on create', 'initial_stock:' || v_variant_id::text || ':' || p_store_id::text
      );
    ELSE
      INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
      VALUES (p_store_id, v_variant_id, p_organization_id, 0)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object('product_id', v_product_id, 'variant_id', v_variant_id);
END;
$$;

-- Patch receive_purchase_order to add FIFO cost layers
CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_po_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_line purchase_order_lines%ROWTYPE;
  v_bill_id UUID;
  v_entry_id UUID;
  v_on_hand NUMERIC;
  v_old_cost NUMERIC;
  v_new_cost NUMERIC;
  v_lines JSONB := '[]'::jsonb;
  v_movement_id UUID;
  v_method inventory_costing_method;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT public.user_can_manage(v_po.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_po.status = 'received' THEN RAISE EXCEPTION 'Purchase order already received'; END IF;

  PERFORM public.ensure_default_accounts(v_po.organization_id);
  SELECT inventory_costing_method INTO v_method FROM organizations WHERE id = v_po.organization_id;

  FOR v_line IN SELECT * FROM purchase_order_lines WHERE po_id = p_po_id LOOP
    IF v_method = 'moving_average' THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_on_hand
      FROM inventory_levels WHERE variant_id = v_line.variant_id;

      SELECT COALESCE(pv.cost_price, p.cost_price, 0) INTO v_old_cost
      FROM product_variants pv LEFT JOIN products p ON p.id = pv.product_id
      WHERE pv.id = v_line.variant_id;

      IF (v_on_hand + v_line.quantity) > 0 THEN
        v_new_cost := round(
          ((v_on_hand * COALESCE(v_old_cost, 0)) + (v_line.quantity * v_line.unit_cost))
          / (v_on_hand + v_line.quantity), 2);
      ELSE
        v_new_cost := v_line.unit_cost;
      END IF;

      UPDATE product_variants SET cost_price = v_new_cost WHERE id = v_line.variant_id;
      UPDATE products p SET cost_price = v_new_cost
        FROM product_variants pv WHERE pv.id = v_line.variant_id AND p.id = pv.product_id;
    END IF;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'store_id', v_po.store_id,
      'variant_id', v_line.variant_id,
      'quantity_delta', v_line.quantity,
      'unit_cost', v_line.unit_cost,
      'line_notes', 'PO receipt'
    ));
  END LOOP;

  IF jsonb_array_length(v_lines) > 0 THEN
    v_movement_id := public._apply_stock_movement(
      v_po.organization_id, 'purchase_receipt', v_lines,
      'purchase_order', p_po_id, 'PO receipt ' || p_po_id::text,
      auth.uid(), 'po_receipt:' || p_po_id::text,
      jsonb_build_object('po_total', v_po.total)
    );

    IF v_method = 'fifo' THEN
      FOR v_line IN SELECT * FROM purchase_order_lines WHERE po_id = p_po_id LOOP
        PERFORM public._add_inventory_cost_layer(
          v_po.organization_id, v_po.store_id, v_line.variant_id,
          v_line.quantity, v_line.unit_cost, 'purchase_order', p_po_id
        );
      END LOOP;
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM purchase_order_lines WHERE po_id = p_po_id LOOP
    INSERT INTO inventory_adjustments (store_id, variant_id, organization_id, delta, reason, user_id)
    VALUES (v_po.store_id, v_line.variant_id, v_po.organization_id, v_line.quantity,
            'PO receipt ' || p_po_id::text, auth.uid());
  END LOOP;

  INSERT INTO vendor_bills (organization_id, vendor_id, po_id, bill_date, amount, status)
  VALUES (v_po.organization_id, v_po.vendor_id, p_po_id, current_date, v_po.total, 'open')
  RETURNING id INTO v_bill_id;

  IF v_po.total > 0 THEN
    v_entry_id := public.post_journal_entry(
      v_po.organization_id, 'PUR', current_date,
      'Goods receipt PO ' || p_po_id::text, 'purchase', p_po_id,
      jsonb_build_array(
        jsonb_build_object('accountId', public.account_id_by_code(v_po.organization_id, '1200'),
          'debit', v_po.total, 'credit', 0, 'description', 'Inventory received'),
        jsonb_build_object('accountId', public.account_id_by_code(v_po.organization_id, '2000'),
          'debit', 0, 'credit', v_po.total, 'description', 'Accounts payable')
      )
    );
    UPDATE vendor_bills SET journal_entry_id = v_entry_id WHERE id = v_bill_id;
  END IF;

  UPDATE purchase_orders SET status = 'received', received_at = now() WHERE id = p_po_id;
  RETURN v_bill_id;
END;
$$;

-- bulk_receive_products: ledger integration
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
        PERFORM public._apply_stock_in(
          p_org_id, p_store_id, v_variant_id, v_qty, 'bulk_receive', 'product', v_product_id,
          v_cost, 'Scan receive', 'bulk_receive:' || v_variant_id::text || ':' || v_row_num::text
        );
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

      PERFORM public._apply_stock_in(
        p_org_id, p_store_id, v_variant_id, v_qty, 'bulk_receive', 'product', v_product_id,
        v_cost, 'New product scan receive', 'bulk_receive_new:' || v_variant_id::text
      );

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

-- complete_sale: ledger integration
CREATE OR REPLACE FUNCTION public.complete_sale(
  p_organization_id UUID,
  p_store_id UUID,
  p_register_id UUID,
  p_session_id UUID,
  p_idempotency_key UUID,
  p_lines JSONB,
  p_discount_amount NUMERIC,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_payments JSONB,
  p_pos_staff_id UUID DEFAULT NULL,
  p_pos_session_token TEXT DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_promotion_code TEXT DEFAULT NULL,
  p_tip_amount NUMERIC DEFAULT 0,
  p_manager_discount_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_staff_id UUID;
  v_org organizations%ROWTYPE;
  v_receipt_no TEXT;
  v_sale_id UUID;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_tip NUMERIC := GREATEST(COALESCE(p_tip_amount, 0), 0);
  v_merch_subtotal NUMERIC := 0;
  v_gross_merch NUMERIC := 0;
  v_line_discounts_total NUMERIC := 0;
  v_line JSONB;
  v_variant_id UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_line_discount NUMERIC;
  v_line_gross NUMERIC;
  v_line_subtotal NUMERIC;
  v_line_tax NUMERIC;
  v_line_total NUMERIC;
  v_tax_rate NUMERIC;
  v_payment_total NUMERIC := 0;
  v_payment JSONB;
  v_payment_amount NUMERIC;
  v_existing_sale UUID;
  v_dup_receipt TEXT;
  v_dup_total NUMERIC;
  v_stock NUMERIC;
  v_staff_sess RECORD;
  v_credit_total NUMERIC := 0;
  v_credit_balance NUMERIC := 0;
  v_on_account_total NUMERIC := 0;
  v_receivable_balance NUMERIC := 0;
  v_credit_limit NUMERIC;
  v_on_account_enabled BOOLEAN;
  v_cust_name TEXT;
  v_cust_phone TEXT;
  v_promo promotions%ROWTYPE;
  v_promo_discount NUMERIC := 0;
  v_manual_discount NUMERIC := GREATEST(COALESCE(p_discount_amount, 0), 0);
  v_promo_result JSONB;
  v_pay_status payment_status;
  v_has_pending_payments BOOLEAN := false;
  v_tax_rates JSONB := '{}'::jsonb;
  v_gift_card_total NUMERIC := 0;
  v_loyalty_total NUMERIC := 0;
  v_loyalty_points_total INT := 0;
  v_loyalty_points_earned INT := 0;
  v_loyalty_pts INT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NOT NULL THEN
    IF NOT public.user_has_org_access(p_organization_id) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    v_staff_id := p_pos_staff_id;
  ELSIF p_pos_session_token IS NOT NULL THEN
    SELECT * INTO v_staff_sess FROM public.validate_pos_staff_session(p_pos_session_token);
    IF NOT FOUND OR v_staff_sess.organization_id <> p_organization_id THEN
      RAISE EXCEPTION 'Invalid POS session';
    END IF;
    v_staff_id := v_staff_sess.staff_id;
  ELSE
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key is required';
  END IF;

  SELECT id, receipt_no, total
  INTO v_existing_sale, v_dup_receipt, v_dup_total
  FROM sales
  WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'sale_id', v_existing_sale,
      'receipt_no', v_dup_receipt,
      'total', v_dup_total,
      'duplicate', true
    );
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;

  IF NOT COALESCE(v_org.pos_tips_enabled, false) AND v_tip > 0 THEN
    RAISE EXCEPTION 'Tips are not enabled for this organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM register_sessions
    WHERE id = p_session_id AND register_id = p_register_id AND closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Register session is not open';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT name, phone, on_account_enabled, credit_limit
    INTO v_cust_name, v_cust_phone, v_on_account_enabled, v_credit_limit
    FROM customers
    WHERE id = p_customer_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer not found';
    END IF;
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Sale must include at least one line item';
  END IF;

  -- Preload per-variant tax rates (avoids repeated subqueries in line loops)
  SELECT COALESCE(jsonb_object_agg(pv.id::TEXT, COALESCE(p.tax_rate, v_org.tax_rate)), '{}'::jsonb)
  INTO v_tax_rates
  FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  WHERE pv.id IN (
    SELECT (elem->>'variantId')::UUID
    FROM jsonb_array_elements(p_lines) elem
  );

  v_receipt_no := public.next_receipt_number(p_store_id);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant_id := (v_line->>'variantId')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;
    v_unit_price := (v_line->>'unitPrice')::NUMERIC;
    v_line_discount := COALESCE((v_line->>'discountAmount')::NUMERIC, 0);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity for variant %', v_variant_id;
    END IF;

    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid unit price for variant %', v_variant_id;
    END IF;

    IF v_line_discount < 0 THEN
      RAISE EXCEPTION 'Line discount cannot be negative';
    END IF;

    v_line_gross := round(v_unit_price * v_qty, 2);
    IF v_line_discount > v_line_gross + 0.01 THEN
      RAISE EXCEPTION 'Line discount exceeds line total for variant %', v_variant_id;
    END IF;

    SELECT quantity INTO v_stock FROM inventory_levels
    WHERE store_id = p_store_id AND variant_id = v_variant_id
    FOR UPDATE;

    IF v_stock IS NULL THEN v_stock := 0; END IF;
    IF v_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for variant %', v_variant_id;
    END IF;

    v_line_subtotal := v_line_gross - v_line_discount;
    IF v_line_subtotal < -0.01 THEN
      RAISE EXCEPTION 'Invalid line subtotal for variant %', v_variant_id;
    END IF;

    v_gross_merch := v_gross_merch + v_line_gross;
    v_line_discounts_total := v_line_discounts_total + v_line_discount;
    v_merch_subtotal := v_merch_subtotal + v_line_subtotal;

    v_tax_rate := COALESCE((v_tax_rates->>v_variant_id::TEXT)::NUMERIC, v_org.tax_rate);

    IF v_org.tax_inclusive THEN
      v_line_tax := v_line_subtotal - (v_line_subtotal / (1 + v_tax_rate / 100));
      v_line_total := v_line_subtotal;
    ELSE
      v_line_tax := v_line_subtotal * (v_tax_rate / 100);
      v_line_total := v_line_subtotal + v_line_tax;
    END IF;

    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_total := v_tax_total + v_line_tax;
  END LOOP;

  IF p_promotion_code IS NOT NULL AND trim(p_promotion_code) <> '' THEN
    v_promo_result := public.validate_promotion_code(
      p_organization_id, p_promotion_code, v_merch_subtotal, p_pos_session_token
    );
    IF NOT COALESCE((v_promo_result->>'valid')::BOOLEAN, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_promo_result->>'message', 'Invalid promotion');
    END IF;
    SELECT * INTO v_promo FROM promotions WHERE id = (v_promo_result->>'promotion_id')::UUID;
    v_promo_discount := GREATEST((v_promo_result->>'discount_amount')::NUMERIC, 0);
  END IF;

  IF v_manual_discount + v_promo_discount > v_merch_subtotal + 0.01 THEN
    RAISE EXCEPTION 'Order discounts exceed merchandise subtotal';
  END IF;

  IF v_line_discounts_total + v_manual_discount + v_promo_discount > v_gross_merch + 0.01 THEN
    RAISE EXCEPTION 'Total discounts cannot exceed merchandise value (100%% cap)';
  END IF;

  PERFORM public._enforce_cashier_discount_limit(
    p_organization_id,
    p_register_id,
    v_gross_merch,
    v_line_discounts_total + v_manual_discount + v_promo_discount,
    p_pos_session_token,
    p_manager_discount_pin,
    v_user_id
  );

  v_total := v_subtotal + v_tax_total - v_manual_discount - v_promo_discount + v_tip;
  IF v_total < -0.01 THEN
    RAISE EXCEPTION 'Sale total cannot be negative';
  END IF;
  IF v_total < 0 THEN v_total := 0; END IF;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_payment_amount := COALESCE((v_payment->>'amount')::NUMERIC, 0);
    IF v_payment_amount < 0 THEN
      RAISE EXCEPTION 'Payment amount cannot be negative';
    END IF;
    v_payment_total := v_payment_total + v_payment_amount;
    IF v_payment->>'method' = 'store_credit' THEN
      v_credit_total := v_credit_total + v_payment_amount;
    ELSIF v_payment->>'method' = 'on_account' THEN
      v_on_account_total := v_on_account_total + v_payment_amount;
    ELSIF v_payment->>'method' = 'gift_card' THEN
      v_gift_card_total := v_gift_card_total + v_payment_amount;
    ELSIF v_payment->>'method' = 'loyalty' THEN
      v_loyalty_total := v_loyalty_total + v_payment_amount;
    END IF;
  END LOOP;

  IF abs(v_payment_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'Payment total % does not match sale total %', v_payment_total, v_total;
  END IF;

  IF v_credit_total > 0 AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer required for store credit payment';
  END IF;

  IF v_on_account_total > 0 AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer required for pay-later payment';
  END IF;

  IF v_on_account_total > 0 AND NOT COALESCE(v_on_account_enabled, false) THEN
    RAISE EXCEPTION 'Pay later is not enabled for this customer';
  END IF;

  IF v_credit_total > 0 THEN
    SELECT balance INTO v_credit_balance FROM customer_credits
    WHERE organization_id = p_organization_id AND customer_id = p_customer_id
    FOR UPDATE;
    IF v_credit_balance IS NULL OR v_credit_balance < v_credit_total THEN
      RAISE EXCEPTION 'Insufficient store credit';
    END IF;
  END IF;

  IF v_on_account_total > 0 THEN
    SELECT balance INTO v_receivable_balance FROM customer_receivables
    WHERE organization_id = p_organization_id AND customer_id = p_customer_id
    FOR UPDATE;

    IF v_credit_limit IS NOT NULL
      AND COALESCE(v_receivable_balance, 0) + v_on_account_total > v_credit_limit THEN
      RAISE EXCEPTION 'Credit limit exceeded';
    END IF;
  END IF;

  IF v_gift_card_total > 0 THEN
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      IF v_payment->>'method' = 'gift_card' THEN
        PERFORM public._lock_validate_gift_card(
          p_organization_id,
          v_payment->>'reference',
          COALESCE((v_payment->>'amount')::NUMERIC, 0)
        );
      END IF;
    END LOOP;
  END IF;

  IF v_loyalty_total > 0 THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Customer required for loyalty redemption';
    END IF;
    v_loyalty_points_total := 0;
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      IF v_payment->>'method' = 'loyalty' THEN
        v_loyalty_pts := COALESCE(NULLIF(trim(v_payment->>'reference'), '')::INT, 0);
        IF v_loyalty_pts <= 0 THEN
          v_loyalty_pts := public._loyalty_points_for_amount(
            v_org, COALESCE((v_payment->>'amount')::NUMERIC, 0)
          );
        END IF;
        v_loyalty_points_total := v_loyalty_points_total + v_loyalty_pts;
      END IF;
    END LOOP;
    PERFORM public._validate_loyalty_redemption(
      p_organization_id, p_customer_id, v_loyalty_points_total
    );
  END IF;

  BEGIN
    INSERT INTO sales (
      organization_id, store_id, register_id, session_id, receipt_no,
      subtotal, tax_amount, discount_amount, tip_amount, total,
      customer_id, customer_name, customer_phone,
      idempotency_key, created_by, pos_staff_id, promotion_id
    ) VALUES (
      p_organization_id, p_store_id, p_register_id, p_session_id, v_receipt_no,
      v_subtotal, v_tax_total, v_manual_discount + v_promo_discount, v_tip, v_total,
      p_customer_id,
      COALESCE(p_customer_name, v_cust_name),
      COALESCE(p_customer_phone, v_cust_phone),
      p_idempotency_key, v_user_id, v_staff_id,
      CASE WHEN v_promo.id IS NOT NULL THEN v_promo.id ELSE NULL END
    ) RETURNING id INTO v_sale_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, receipt_no, total
      INTO v_existing_sale, v_dup_receipt, v_dup_total
      FROM sales
      WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'sale_id', v_existing_sale,
          'receipt_no', v_dup_receipt,
          'total', v_dup_total,
          'duplicate', true
        );
      END IF;
      RAISE;
  END;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant_id := (v_line->>'variantId')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;
    v_unit_price := (v_line->>'unitPrice')::NUMERIC;
    v_line_discount := COALESCE((v_line->>'discountAmount')::NUMERIC, 0);
    v_line_subtotal := v_unit_price * v_qty - v_line_discount;
    v_tax_rate := COALESCE((v_tax_rates->>v_variant_id::TEXT)::NUMERIC, v_org.tax_rate);

    IF v_org.tax_inclusive THEN
      v_line_tax := v_line_subtotal - (v_line_subtotal / (1 + v_tax_rate / 100));
      v_line_total := v_line_subtotal;
    ELSE
      v_line_tax := v_line_subtotal * (v_tax_rate / 100);
      v_line_total := v_line_subtotal + v_line_tax;
    END IF;

    INSERT INTO sale_lines (
      sale_id, variant_id, product_name, variant_name,
      quantity, unit_price, tax_amount, discount_amount, line_total
    ) VALUES (
      v_sale_id, v_variant_id,
      v_line->>'productName', v_line->>'variantName',
      v_qty, v_unit_price, v_line_tax, v_line_discount, v_line_total
    );
  END LOOP;

  PERFORM public._record_sale_stock_movement(
    p_organization_id, p_store_id, v_sale_id, p_lines, v_user_id
  );

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_pay_status := public._pos_resolve_payment_status(
      v_payment->>'method', v_payment->>'reference', v_org
    );
    IF v_pay_status = 'pending'::payment_status THEN
      v_has_pending_payments := true;
    END IF;

    INSERT INTO payments (
      sale_id, organization_id, method, amount, status,
      reference, provider, phone, bank_name, cash_tendered, change_given
    ) VALUES (
      v_sale_id, p_organization_id,
      (v_payment->>'method')::payment_method,
      (v_payment->>'amount')::NUMERIC,
      v_pay_status,
      v_payment->>'reference',
      NULLIF(v_payment->>'provider', '')::mobile_money_provider,
      v_payment->>'phone',
      v_payment->>'bankName',
      (v_payment->>'cashTendered')::NUMERIC,
      (v_payment->>'changeGiven')::NUMERIC
    );
  END LOOP;

  IF v_credit_total > 0 THEN
    UPDATE customer_credits
    SET balance = balance - v_credit_total, updated_at = now()
    WHERE organization_id = p_organization_id AND customer_id = p_customer_id;

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id, created_by)
    VALUES (p_organization_id, p_customer_id, -v_credit_total, 'Redeemed at POS', v_sale_id, v_user_id);
  END IF;

  IF v_on_account_total > 0 THEN
    INSERT INTO customer_receivables (organization_id, customer_id, balance)
    VALUES (p_organization_id, p_customer_id, v_on_account_total)
    ON CONFLICT (organization_id, customer_id)
    DO UPDATE SET balance = customer_receivables.balance + v_on_account_total, updated_at = now();

    INSERT INTO receivable_transactions (organization_id, customer_id, amount, reason, sale_id, created_by)
    VALUES (p_organization_id, p_customer_id, v_on_account_total, 'POS sale — pay later', v_sale_id, v_user_id);
  END IF;

  IF v_gift_card_total > 0 THEN
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      IF v_payment->>'method' = 'gift_card' THEN
        PERFORM public._redeem_gift_card(
          p_organization_id,
          v_payment->>'reference',
          COALESCE((v_payment->>'amount')::NUMERIC, 0),
          v_sale_id,
          v_user_id
        );
      END IF;
    END LOOP;
  END IF;

  IF v_loyalty_total > 0 AND v_loyalty_points_total > 0 THEN
    PERFORM public._redeem_loyalty_points(
      p_organization_id, p_customer_id, v_loyalty_points_total, v_sale_id, v_user_id
    );
  END IF;

  IF COALESCE(v_org.pos_loyalty_enabled, false) AND p_customer_id IS NOT NULL THEN
    v_loyalty_points_earned := public._award_loyalty_points(
      p_organization_id, p_customer_id, v_merch_subtotal, v_sale_id, v_user_id
    );
  END IF;

  IF v_staff_id IS NOT NULL THEN
    UPDATE register_sessions SET active_staff_id = v_staff_id WHERE id = p_session_id;
  END IF;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
    VALUES (
      p_organization_id, v_user_id, 'sale', v_sale_id, 'completed',
      jsonb_build_object(
        'receipt_no', v_receipt_no, 'total', v_total, 'tip_amount', v_tip,
        'pos_staff_id', v_staff_id,
        'promotion_code', NULLIF(trim(p_promotion_code), ''),
        'payments_pending', v_has_pending_payments
      )
    );
  END IF;

  -- Async GL: enqueue instead of blocking checkout on journal writes
  IF COALESCE(v_org.pos_auto_post_sales, false) AND NOT v_has_pending_payments THEN
    PERFORM public.enqueue_sale_ledger_post(v_sale_id);
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'receipt_no', v_receipt_no,
    'total', v_total,
    'tip_amount', v_tip,
    'duplicate', false,
    'payments_pending', v_has_pending_payments,
    'loyalty_points_earned', v_loyalty_points_earned
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB,
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT
) TO anon, authenticated;

-- import_products: ledger integration
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

      IF p_store_id IS NOT NULL AND v_variant_id IS NOT NULL AND v_qty > 0 THEN
        PERFORM public._apply_stock_in(
          p_org_id, p_store_id, v_variant_id, v_qty, 'import_receipt', 'product', v_product_id,
          v_cost, 'Product import update', 'import_update:' || v_product_id::text || ':' || v_row_num::text
        );
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

      IF p_store_id IS NOT NULL AND v_qty > 0 THEN
        PERFORM public._apply_stock_in(
          p_org_id, p_store_id, v_variant_id, v_qty, 'import_receipt', 'product', v_product_id,
          v_cost, 'Product import', 'import_new:' || v_variant_id::text
        );
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

GRANT EXECUTE ON FUNCTION public.user_can_access_warehouse TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_org_warehouses TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_warehouses TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_storage_locations TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_storage_location TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_detail TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_product_variant TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_product_barcode TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_extended TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_org_inventory_settings TO authenticated;

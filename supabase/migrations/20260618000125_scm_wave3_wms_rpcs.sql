-- SCM Wave 3: WMS RPCs — putaway, bin stock, fulfillment pick/pack/ship.

-- ---------------------------------------------------------------------------
-- Staging location helper (dock per warehouse)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ensure_staging_location(
  p_org_id UUID,
  p_warehouse_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM storage_locations
  WHERE warehouse_id = p_warehouse_id AND code = 'STAGING' AND is_active
  LIMIT 1;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO storage_locations (
    organization_id, warehouse_id, parent_id, location_type, code, name,
    is_pickable, is_receivable, is_active, sort_order
  ) VALUES (
    p_org_id, p_warehouse_id, NULL, 'staging', 'STAGING', 'Pick staging',
    true, false, true, 999
  )
  ON CONFLICT (warehouse_id, code) DO UPDATE SET is_active = true
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Location balance helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_location_balance(
  p_org_id UUID,
  p_store_id UUID,
  p_location_id UUID,
  p_variant_id UUID,
  p_delta NUMERIC,
  p_lot_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty NUMERIC;
  v_id UUID;
BEGIN
  IF p_delta = 0 THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage_locations sl
    WHERE sl.id = p_location_id AND sl.organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Invalid location';
  END IF;

  SELECT id, quantity INTO v_id, v_qty
  FROM location_balances
  WHERE location_id = p_location_id
    AND variant_id = p_variant_id
    AND lot_id IS NOT DISTINCT FROM p_lot_id
  FOR UPDATE;

  IF v_id IS NULL THEN
    IF p_delta < 0 THEN RAISE EXCEPTION 'Insufficient quantity at location'; END IF;
    INSERT INTO location_balances (
      organization_id, store_id, location_id, variant_id, lot_id, quantity
    ) VALUES (p_org_id, p_store_id, p_location_id, p_variant_id, p_lot_id, p_delta);
    RETURN;
  END IF;

  v_qty := v_qty + p_delta;
  IF v_qty < 0 THEN RAISE EXCEPTION 'Insufficient quantity at location'; END IF;

  IF v_qty = 0 THEN
    DELETE FROM location_balances WHERE id = v_id;
  ELSE
    UPDATE location_balances SET quantity = v_qty, updated_at = now() WHERE id = v_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_location_balances(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_variant_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.location_code, t.product_name)
    FROM (
      SELECT
        lb.id, lb.store_id, s.name AS store_name,
        lb.location_id, sl.code AS location_code, sl.name AS location_name,
        lb.variant_id, pv.name AS variant_name, p.name AS product_name,
        lb.lot_id, il.lot_number, lb.quantity, lb.updated_at
      FROM location_balances lb
      JOIN stores s ON s.id = lb.store_id
      JOIN storage_locations sl ON sl.id = lb.location_id
      JOIN product_variants pv ON pv.id = lb.variant_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN inventory_lots il ON il.id = lb.lot_id
      WHERE lb.organization_id = p_org_id
        AND lb.quantity > 0
        AND (p_store_id IS NULL OR lb.store_id = p_store_id)
        AND (p_location_id IS NULL OR lb.location_id = p_location_id)
        AND (p_variant_id IS NULL OR lb.variant_id = p_variant_id)
      ORDER BY sl.code, p.name
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    ) t
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Putaway (bin transfer — no change to store on-hand total)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.putaway_stock(
  p_org_id UUID,
  p_store_id UUID,
  p_variant_id UUID,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_quantity NUMERIC,
  p_lot_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
  IF p_from_location_id = p_to_location_id THEN RAISE EXCEPTION 'From and to locations must differ'; END IF;

  PERFORM public._apply_location_balance(p_org_id, p_store_id, p_from_location_id, p_variant_id, -p_quantity, p_lot_id);
  PERFORM public._apply_location_balance(p_org_id, p_store_id, p_to_location_id, p_variant_id, p_quantity, p_lot_id);

  INSERT INTO stock_movements (
    organization_id, movement_type, reference_type, notes, metadata, user_id
  ) VALUES (
    p_org_id, 'location_transfer', 'putaway',
    COALESCE(NULLIF(trim(p_notes), ''), 'Putaway transfer'),
    jsonb_build_object(
      'store_id', p_store_id,
      'variant_id', p_variant_id,
      'from_location_id', p_from_location_id,
      'to_location_id', p_to_location_id,
      'quantity', p_quantity,
      'lot_id', p_lot_id
    ),
    auth.uid()
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

-- Seed location balance from store on-hand (DEFAULT zone)
CREATE OR REPLACE FUNCTION public.sync_default_location_balances(
  p_org_id UUID,
  p_store_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wh_id UUID;
  v_default_loc UUID;
  v_row RECORD;
  v_located NUMERIC;
  v_count INT := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  PERFORM public.ensure_org_warehouses(p_org_id);

  SELECT w.id INTO v_wh_id FROM warehouses w WHERE w.store_id = p_store_id AND w.organization_id = p_org_id;
  IF v_wh_id IS NULL THEN RAISE EXCEPTION 'Warehouse not found for store'; END IF;

  SELECT id INTO v_default_loc FROM storage_locations
  WHERE warehouse_id = v_wh_id AND code = 'DEFAULT' LIMIT 1;

  IF v_default_loc IS NULL THEN RAISE EXCEPTION 'Default location missing'; END IF;

  FOR v_row IN
    SELECT il.variant_id, il.quantity
    FROM inventory_levels il
    WHERE il.organization_id = p_org_id AND il.store_id = p_store_id AND il.quantity > 0
  LOOP
    SELECT COALESCE(SUM(lb.quantity), 0) INTO v_located
    FROM location_balances lb
    WHERE lb.store_id = p_store_id AND lb.variant_id = v_row.variant_id;

    IF v_located < v_row.quantity THEN
      PERFORM public._apply_location_balance(
        p_org_id, p_store_id, v_default_loc, v_row.variant_id,
        v_row.quantity - v_located, NULL
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fulfillment order number
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_fulfillment_order_no(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq INT;
BEGIN
  SELECT COUNT(*)::INT + 1 INTO v_seq
  FROM fulfillment_orders
  WHERE organization_id = p_org_id
    AND created_at >= date_trunc('day', now());

  RETURN 'FO-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- Fulfillment CRUD & workflow
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_fulfillment_order(
  p_org_id UUID,
  p_store_id UUID,
  p_lines JSONB,
  p_ship_to_name TEXT DEFAULT NULL,
  p_ship_to_phone TEXT DEFAULT NULL,
  p_ship_to_address TEXT DEFAULT NULL,
  p_priority fulfillment_priority DEFAULT 'normal',
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_wh_id UUID;
  v_line JSONB;
  v_order_no TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one line is required';
  END IF;

  PERFORM public.ensure_org_warehouses(p_org_id);
  SELECT id INTO v_wh_id FROM warehouses WHERE store_id = p_store_id AND organization_id = p_org_id;
  v_order_no := public.next_fulfillment_order_no(p_org_id);

  INSERT INTO fulfillment_orders (
    organization_id, store_id, warehouse_id, order_no, status, priority,
    ship_to_name, ship_to_phone, ship_to_address, notes, created_by
  ) VALUES (
    p_org_id, p_store_id, v_wh_id, v_order_no, 'draft', COALESCE(p_priority, 'normal'),
    NULLIF(trim(p_ship_to_name), ''), NULLIF(trim(p_ship_to_phone), ''),
    NULLIF(trim(p_ship_to_address), ''), NULLIF(trim(p_notes), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO fulfillment_order_lines (
      fulfillment_order_id, organization_id, variant_id, product_name, quantity_ordered
    ) VALUES (
      v_id, p_org_id,
      (v_line->>'variantId')::UUID,
      COALESCE(v_line->>'productName', 'Product'),
      GREATEST((v_line->>'quantity')::NUMERIC, 0.001)
    );
  END LOOP;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_fulfillment_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM fulfillment_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE fulfillment_orders
  SET status = 'released', released_at = now()
  WHERE id = p_order_id AND status = 'draft';
END;
$$;

CREATE OR REPLACE FUNCTION public.pick_fulfillment_line(
  p_line_id UUID,
  p_location_id UUID,
  p_quantity NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line fulfillment_order_lines%ROWTYPE;
  v_order fulfillment_orders%ROWTYPE;
  v_staging UUID;
  v_pick_qty NUMERIC;
BEGIN
  SELECT fol.* INTO v_line FROM fulfillment_order_lines fol WHERE fol.id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;

  SELECT * INTO v_order FROM fulfillment_orders WHERE id = v_line.fulfillment_order_id FOR UPDATE;
  IF NOT public.user_can_manage(v_order.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_order.status NOT IN ('released', 'picking') THEN
    RAISE EXCEPTION 'Order is not open for picking';
  END IF;

  v_pick_qty := GREATEST(p_quantity, 0);
  IF v_pick_qty <= 0 THEN RAISE EXCEPTION 'Pick quantity must be positive'; END IF;
  IF v_line.quantity_picked + v_pick_qty > v_line.quantity_ordered + 0.001 THEN
    RAISE EXCEPTION 'Pick quantity exceeds ordered';
  END IF;

  v_staging := public._ensure_staging_location(v_order.organization_id, v_order.warehouse_id);

  PERFORM public._apply_location_balance(
    v_order.organization_id, v_order.store_id, p_location_id, v_line.variant_id, -v_pick_qty, v_line.lot_id
  );
  PERFORM public._apply_location_balance(
    v_order.organization_id, v_order.store_id, v_staging, v_line.variant_id, v_pick_qty, v_line.lot_id
  );

  UPDATE fulfillment_order_lines
  SET quantity_picked = quantity_picked + v_pick_qty,
      pick_location_id = COALESCE(pick_location_id, p_location_id)
  WHERE id = p_line_id;

  UPDATE fulfillment_orders
  SET status = 'picking', picked_at = COALESCE(picked_at, now())
  WHERE id = v_order.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_fulfillment_pick(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_line fulfillment_order_lines%ROWTYPE;
BEGIN
  SELECT organization_id INTO v_org_id FROM fulfillment_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  FOR v_line IN SELECT * FROM fulfillment_order_lines WHERE fulfillment_order_id = p_order_id LOOP
    IF v_line.quantity_picked < v_line.quantity_ordered - 0.001 THEN
      RAISE EXCEPTION 'All lines must be fully picked before complete';
    END IF;
  END LOOP;

  UPDATE fulfillment_orders
  SET status = 'picked', picked_at = now()
  WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pack_fulfillment_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM fulfillment_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE fulfillment_orders
  SET status = 'packed', packed_at = now()
  WHERE id = p_order_id AND status IN ('picked', 'picking');
END;
$$;

CREATE OR REPLACE FUNCTION public.ship_fulfillment_order(
  p_order_id UUID,
  p_carrier TEXT DEFAULT NULL,
  p_tracking_number TEXT DEFAULT NULL,
  p_weight_kg NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order fulfillment_orders%ROWTYPE;
  v_line fulfillment_order_lines%ROWTYPE;
  v_staging UUID;
  v_lines JSONB := '[]'::jsonb;
  v_shipment_id UUID;
  v_movement_id UUID;
BEGIN
  SELECT * INTO v_order FROM fulfillment_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT public.user_can_manage(v_order.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_order.status NOT IN ('picked', 'packed') THEN
    RAISE EXCEPTION 'Order must be picked/packed before ship';
  END IF;

  v_staging := public._ensure_staging_location(v_order.organization_id, v_order.warehouse_id);

  FOR v_line IN SELECT * FROM fulfillment_order_lines WHERE fulfillment_order_id = p_order_id LOOP
    IF v_line.quantity_picked <= 0 THEN CONTINUE; END IF;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'store_id', v_order.store_id,
      'variant_id', v_line.variant_id,
      'quantity_delta', -v_line.quantity_picked,
      'line_notes', 'Fulfillment ship ' || v_order.order_no
    ));

    PERFORM public._apply_location_balance(
      v_order.organization_id, v_order.store_id, v_staging, v_line.variant_id,
      -v_line.quantity_picked, v_line.lot_id
    );

    UPDATE fulfillment_order_lines
    SET quantity_shipped = quantity_picked
    WHERE id = v_line.id;
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN RAISE EXCEPTION 'Nothing to ship'; END IF;

  v_movement_id := public._apply_stock_movement(
    v_order.organization_id, 'fulfillment_shipment', v_lines,
    'fulfillment_order', p_order_id, 'Ship ' || v_order.order_no,
    auth.uid(), 'fulfillment_ship:' || p_order_id::text, '{}'::jsonb
  );

  INSERT INTO shipments (
    organization_id, fulfillment_order_id, carrier, tracking_number,
    status, weight_kg, shipped_at
  ) VALUES (
    v_order.organization_id, p_order_id,
    NULLIF(trim(p_carrier), ''), NULLIF(trim(p_tracking_number), ''),
    'in_transit', p_weight_kg, now()
  )
  RETURNING id INTO v_shipment_id;

  UPDATE fulfillment_orders
  SET status = 'shipped', shipped_at = now()
  WHERE id = p_order_id;

  RETURN v_shipment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_fulfillment_orders(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC)
    FROM (
      SELECT
        fo.id, fo.order_no, fo.store_id, s.name AS store_name,
        fo.status, fo.priority, fo.ship_to_name, fo.ship_to_address,
        fo.created_at, fo.released_at, fo.shipped_at,
        (SELECT COUNT(*)::INT FROM fulfillment_order_lines fol WHERE fol.fulfillment_order_id = fo.id) AS line_count,
        (SELECT COALESCE(SUM(fol.quantity_ordered), 0) FROM fulfillment_order_lines fol WHERE fol.fulfillment_order_id = fo.id) AS total_qty
      FROM fulfillment_orders fo
      JOIN stores s ON s.id = fo.store_id
      WHERE fo.organization_id = p_org_id
        AND (p_store_id IS NULL OR fo.store_id = p_store_id)
        AND (p_status IS NULL OR fo.status::TEXT = p_status)
      ORDER BY fo.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100))
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_fulfillment_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order fulfillment_orders%ROWTYPE;
  v_lines JSONB;
  v_shipments JSONB;
BEGIN
  SELECT * INTO v_order FROM fulfillment_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT public.user_has_org_access(v_order.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_lines
  FROM (
    SELECT
      fol.id, fol.variant_id, fol.product_name,
      fol.quantity_ordered, fol.quantity_picked, fol.quantity_shipped,
      fol.pick_location_id, sl.code AS pick_location_code, fol.line_notes
    FROM fulfillment_order_lines fol
    LEFT JOIN storage_locations sl ON sl.id = fol.pick_location_id
    WHERE fol.fulfillment_order_id = p_order_id
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(sh)), '[]'::jsonb) INTO v_shipments
  FROM shipments sh WHERE sh.fulfillment_order_id = p_order_id;

  RETURN jsonb_build_object(
    'order', row_to_json(v_order),
    'lines', v_lines,
    'shipments', v_shipments
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_location_by_barcode(
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
  v_code TEXT := NULLIF(trim(p_barcode), '');
  v_row RECORD;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_code IS NULL THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT sl.id, sl.warehouse_id, sl.code, sl.name, w.store_id
  INTO v_row
  FROM storage_locations sl
  JOIN warehouses w ON w.id = sl.warehouse_id
  WHERE sl.organization_id = p_org_id
    AND sl.is_active
    AND (sl.location_barcode = v_code OR sl.code = v_code)
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  RETURN jsonb_build_object(
    'found', true,
    'location_id', v_row.id,
    'warehouse_id', v_row.warehouse_id,
    'store_id', v_row.store_id,
    'code', v_row.code,
    'name', v_row.name
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.list_location_balances TO authenticated;
GRANT EXECUTE ON FUNCTION public.putaway_stock TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_default_location_balances TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_fulfillment_order TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_fulfillment_order TO authenticated;
GRANT EXECUTE ON FUNCTION public.pick_fulfillment_line TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_fulfillment_pick TO authenticated;
GRANT EXECUTE ON FUNCTION public.pack_fulfillment_order TO authenticated;
GRANT EXECUTE ON FUNCTION public.ship_fulfillment_order TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_fulfillment_orders TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fulfillment_order TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_location_by_barcode TO authenticated;

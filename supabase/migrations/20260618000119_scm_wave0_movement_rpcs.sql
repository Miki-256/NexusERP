-- SCM Wave 0: stock movement engine, RPC refactors, list APIs, historical backfill.

-- ---------------------------------------------------------------------------
-- Core engine — all stock mutations should route through this function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_stock_movement(
  p_organization_id UUID,
  p_movement_type stock_movement_type,
  p_lines JSONB,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement_id UUID;
  v_user_id UUID := COALESCE(p_user_id, auth.uid());
  v_line JSONB;
  v_store_id UUID;
  v_variant_id UUID;
  v_delta NUMERIC;
  v_before NUMERIC;
  v_after NUMERIC;
  v_unit_cost NUMERIC;
  v_line_notes TEXT;
  v_sorted_lines JSONB;
  v_exists BOOLEAN;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one movement line is required';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_movement_id
    FROM stock_movements
    WHERE organization_id = p_organization_id
      AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_movement_id IS NOT NULL THEN
      RETURN v_movement_id;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(elem ORDER BY elem->>'store_id', elem->>'variant_id'), '[]'::jsonb)
  INTO v_sorted_lines
  FROM jsonb_array_elements(p_lines) AS elem;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_sorted_lines) AS t(value) LOOP
    v_store_id := (v_line->>'store_id')::UUID;
    v_variant_id := (v_line->>'variant_id')::UUID;
    v_delta := (v_line->>'quantity_delta')::NUMERIC;

    IF v_store_id IS NULL OR v_variant_id IS NULL OR v_delta IS NULL OR v_delta = 0 THEN
      RAISE EXCEPTION 'Invalid movement line (store, variant, and non-zero delta required)';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM stores s
      WHERE s.id = v_store_id AND s.organization_id = p_organization_id
    ) THEN
      RAISE EXCEPTION 'Store % does not belong to organization', v_store_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM product_variants pv
      WHERE pv.id = v_variant_id AND pv.organization_id = p_organization_id
    ) THEN
      RAISE EXCEPTION 'Variant % does not belong to organization', v_variant_id;
    END IF;

    PERFORM 1
    FROM inventory_levels
    WHERE store_id = v_store_id AND variant_id = v_variant_id
    FOR UPDATE;
  END LOOP;

  INSERT INTO stock_movements (
    organization_id, movement_type, reference_type, reference_id,
    idempotency_key, notes, metadata, user_id
  ) VALUES (
    p_organization_id, p_movement_type, p_reference_type, p_reference_id,
    NULLIF(trim(p_idempotency_key), ''), NULLIF(trim(p_notes), ''),
    COALESCE(p_metadata, '{}'::jsonb), v_user_id
  )
  RETURNING id INTO v_movement_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_sorted_lines) AS t(value) LOOP
    v_store_id := (v_line->>'store_id')::UUID;
    v_variant_id := (v_line->>'variant_id')::UUID;
    v_delta := (v_line->>'quantity_delta')::NUMERIC;
    v_unit_cost := NULLIF(v_line->>'unit_cost', '')::NUMERIC;
    v_line_notes := NULLIF(trim(v_line->>'line_notes'), '');

    SELECT quantity, true INTO v_before, v_exists
    FROM inventory_levels
    WHERE store_id = v_store_id AND variant_id = v_variant_id;

    IF NOT COALESCE(v_exists, false) THEN
      v_before := 0;
      IF v_delta < 0 THEN
        RAISE EXCEPTION 'Insufficient stock for variant % at store %', v_variant_id, v_store_id;
      END IF;
      INSERT INTO inventory_levels (organization_id, store_id, variant_id, quantity)
      VALUES (p_organization_id, v_store_id, v_variant_id, v_delta);
      v_after := v_delta;
    ELSE
      v_after := v_before + v_delta;
      IF v_after < 0 THEN
        RAISE EXCEPTION 'Insufficient stock for variant % at store % (have %, need %)',
          v_variant_id, v_store_id, v_before, ABS(v_delta);
      END IF;
      UPDATE inventory_levels
      SET quantity = v_after, updated_at = now()
      WHERE store_id = v_store_id AND variant_id = v_variant_id;
    END IF;

    INSERT INTO stock_movement_lines (
      movement_id, organization_id, store_id, variant_id,
      quantity_delta, quantity_before, quantity_after, unit_cost, line_notes
    ) VALUES (
      v_movement_id, p_organization_id, v_store_id, v_variant_id,
      v_delta, v_before, v_after, v_unit_cost, v_line_notes
    );
  END LOOP;

  RETURN v_movement_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- List stock movements (paginated)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_stock_movements(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_variant_id UUID DEFAULT NULL,
  p_movement_type TEXT DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_items JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(DISTINCT sm.id)::INT INTO v_total
  FROM stock_movements sm
  JOIN stock_movement_lines sml ON sml.movement_id = sm.id
  WHERE sm.organization_id = p_org_id
    AND (p_store_id IS NULL OR sml.store_id = p_store_id)
    AND (p_variant_id IS NULL OR sml.variant_id = p_variant_id)
    AND (p_movement_type IS NULL OR sm.movement_type::TEXT = p_movement_type)
    AND (p_from IS NULL OR sm.created_at >= p_from)
    AND (p_to IS NULL OR sm.created_at <= p_to);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      sm.id,
      sm.movement_type,
      sm.reference_type,
      sm.reference_id,
      sm.notes,
      sm.user_id,
      sm.created_at,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', sml.id,
              'store_id', sml.store_id,
              'store_name', s.name,
              'variant_id', sml.variant_id,
              'variant_name', pv.name,
              'product_name', p.name,
              'quantity_delta', sml.quantity_delta,
              'quantity_before', sml.quantity_before,
              'quantity_after', sml.quantity_after,
              'unit_cost', sml.unit_cost,
              'line_notes', sml.line_notes
            )
            ORDER BY sml.created_at
          )
          FROM stock_movement_lines sml
          JOIN stores s ON s.id = sml.store_id
          JOIN product_variants pv ON pv.id = sml.variant_id
          JOIN products p ON p.id = pv.product_id
          WHERE sml.movement_id = sm.id
            AND (p_store_id IS NULL OR sml.store_id = p_store_id)
            AND (p_variant_id IS NULL OR sml.variant_id = p_variant_id)
        ),
        '[]'::jsonb
      ) AS lines
    FROM stock_movements sm
    WHERE sm.organization_id = p_org_id
      AND (p_movement_type IS NULL OR sm.movement_type::TEXT = p_movement_type)
      AND (p_from IS NULL OR sm.created_at >= p_from)
      AND (p_to IS NULL OR sm.created_at <= p_to)
      AND EXISTS (
        SELECT 1 FROM stock_movement_lines sml2
        WHERE sml2.movement_id = sm.id
          AND (p_store_id IS NULL OR sml2.store_id = p_store_id)
          AND (p_variant_id IS NULL OR sml2.variant_id = p_variant_id)
      )
    ORDER BY sm.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    OFFSET GREATEST(0, p_offset)
  ) t;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

-- ---------------------------------------------------------------------------
-- Paginated inventory levels (store stock list)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_inventory_levels_page(
  p_org_id UUID,
  p_store_id UUID,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q TEXT := NULLIF(trim(p_search), '');
  v_total INT;
  v_items JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM stores s WHERE s.id = p_store_id AND s.organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM inventory_levels il
  JOIN product_variants pv ON pv.id = il.variant_id
  JOIN products p ON p.id = pv.product_id
  WHERE il.organization_id = p_org_id
    AND il.store_id = p_store_id
    AND (
      v_q IS NULL
      OR p.name ILIKE '%' || v_q || '%'
      OR pv.name ILIKE '%' || v_q || '%'
      OR COALESCE(p.sku, '') ILIKE '%' || v_q || '%'
      OR COALESCE(pv.sku, '') ILIKE '%' || v_q || '%'
      OR COALESCE(pv.barcode, '') ILIKE '%' || v_q || '%'
      OR COALESCE(p.barcode, '') ILIKE '%' || v_q || '%'
    );

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      il.id,
      il.store_id,
      il.variant_id,
      il.quantity,
      il.updated_at,
      pv.name AS variant_name,
      pv.barcode AS variant_barcode,
      p.name AS product_name,
      p.sell_price,
      p.reorder_point
    FROM inventory_levels il
    JOIN product_variants pv ON pv.id = il.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE il.organization_id = p_org_id
      AND il.store_id = p_store_id
      AND (
        v_q IS NULL
        OR p.name ILIKE '%' || v_q || '%'
        OR pv.name ILIKE '%' || v_q || '%'
        OR COALESCE(p.sku, '') ILIKE '%' || v_q || '%'
        OR COALESCE(pv.sku, '') ILIKE '%' || v_q || '%'
        OR COALESCE(pv.barcode, '') ILIKE '%' || v_q || '%'
        OR COALESCE(p.barcode, '') ILIKE '%' || v_q || '%'
      )
    ORDER BY p.name, pv.name
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    OFFSET GREATEST(0, p_offset)
  ) t;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

-- ---------------------------------------------------------------------------
-- Refactor: adjust_inventory (behavior-identical + movement ledger)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_inventory(
  p_store_id UUID,
  p_variant_id UUID,
  p_delta NUMERIC,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
  v_new_qty NUMERIC;
  v_store_name TEXT;
  v_variant_name TEXT;
  v_product_name TEXT;
  v_adj_id UUID;
  v_movement_id UUID;
BEGIN
  v_user_id := auth.uid();
  SELECT organization_id, name INTO v_org_id, v_store_name FROM stores WHERE id = p_store_id;

  IF NOT public.user_can_manage(v_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_movement_id := public._apply_stock_movement(
    v_org_id,
    'adjustment',
    jsonb_build_array(jsonb_build_object(
      'store_id', p_store_id,
      'variant_id', p_variant_id,
      'quantity_delta', p_delta,
      'line_notes', COALESCE(NULLIF(trim(p_reason), ''), 'Adjustment')
    )),
    NULL, NULL,
    COALESCE(NULLIF(trim(p_reason), ''), 'Adjustment'),
    v_user_id,
    NULL,
    '{}'::jsonb
  );

  SELECT quantity_after INTO v_new_qty
  FROM stock_movement_lines
  WHERE movement_id = v_movement_id
  LIMIT 1;

  INSERT INTO inventory_adjustments (store_id, variant_id, organization_id, delta, reason, user_id)
  VALUES (p_store_id, p_variant_id, v_org_id, p_delta, p_reason, v_user_id)
  RETURNING id INTO v_adj_id;

  UPDATE stock_movements
  SET reference_type = 'inventory_adjustment', reference_id = v_adj_id
  WHERE id = v_movement_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (v_org_id, v_user_id, 'inventory', p_variant_id, 'adjusted',
    jsonb_build_object('store_id', p_store_id, 'delta', p_delta, 'reason', p_reason, 'movement_id', v_movement_id));

  SELECT pv.name, p.name INTO v_variant_name, v_product_name
  FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  WHERE pv.id = p_variant_id;

  PERFORM public.enqueue_notification_event(
    v_org_id,
    'inventory.stock_adjustment',
    'inventory_adjustment',
    v_adj_id,
    jsonb_build_object(
      'store_id', p_store_id,
      'store_name', COALESCE(v_store_name, 'Store'),
      'variant_id', p_variant_id,
      'variant_name', COALESCE(v_variant_name, ''),
      'product_name', COALESCE(v_product_name, ''),
      'delta', p_delta,
      'quantity', v_new_qty,
      'reason', COALESCE(NULLIF(trim(p_reason), ''), 'Adjustment')
    ),
    'stock_adj:' || COALESCE(v_adj_id::text, p_variant_id::text || ':' || p_store_id::text || ':' || extract(epoch from now())::text)
  );

  IF v_new_qty = 0 THEN
    PERFORM public.enqueue_notification_event(
      v_org_id,
      'inventory.out_of_stock',
      'inventory_level',
      p_variant_id,
      jsonb_build_object(
        'store_id', p_store_id,
        'store_name', COALESCE(v_store_name, 'Store'),
        'variant_id', p_variant_id,
        'variant_name', COALESCE(v_variant_name, ''),
        'product_name', COALESCE(v_product_name, ''),
        'quantity', 0
      ),
      'out_of_stock:' || p_variant_id::text || ':' || p_store_id::text || ':' || current_date::text
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Refactor: transfer_stock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_stock(
  p_from_store_id UUID,
  p_to_store_id UUID,
  p_variant_id UUID,
  p_quantity NUMERIC,
  p_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_transfer_id UUID;
  v_movement_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;
  IF p_from_store_id = p_to_store_id THEN
    RAISE EXCEPTION 'Source and destination stores must differ';
  END IF;

  SELECT organization_id INTO v_org_id FROM stores WHERE id = p_from_store_id;
  IF NOT FOUND OR (SELECT organization_id FROM stores WHERE id = p_to_store_id) <> v_org_id THEN
    RAISE EXCEPTION 'Stores must belong to the same organization';
  END IF;
  IF NOT public.user_can_manage(v_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO stock_transfers (
    organization_id, from_store_id, to_store_id, variant_id, quantity, note, created_by
  ) VALUES (
    v_org_id, p_from_store_id, p_to_store_id, p_variant_id, p_quantity, p_note, auth.uid()
  )
  RETURNING id INTO v_transfer_id;

  v_movement_id := public._apply_stock_movement(
    v_org_id,
    'warehouse_transfer',
    jsonb_build_array(
      jsonb_build_object(
        'store_id', p_from_store_id,
        'variant_id', p_variant_id,
        'quantity_delta', -p_quantity,
        'line_notes', 'Transfer out'
      ),
      jsonb_build_object(
        'store_id', p_to_store_id,
        'variant_id', p_variant_id,
        'quantity_delta', p_quantity,
        'line_notes', 'Transfer in'
      )
    ),
    'stock_transfer',
    v_transfer_id,
    p_note,
    auth.uid(),
    'stock_transfer:' || v_transfer_id::text,
    jsonb_build_object('from_store_id', p_from_store_id, 'to_store_id', p_to_store_id)
  );

  INSERT INTO inventory_adjustments (organization_id, store_id, variant_id, delta, reason, user_id)
  VALUES
    (v_org_id, p_from_store_id, p_variant_id, -p_quantity, 'Transfer out ' || v_transfer_id, auth.uid()),
    (v_org_id, p_to_store_id, p_variant_id, p_quantity, 'Transfer in ' || v_transfer_id, auth.uid());

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_org_id, auth.uid(), 'stock_transfer', v_transfer_id, 'completed',
    jsonb_build_object(
      'from_store_id', p_from_store_id,
      'to_store_id', p_to_store_id,
      'variant_id', p_variant_id,
      'quantity', p_quantity,
      'movement_id', v_movement_id
    )
  );

  RETURN v_transfer_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Refactor: receive_purchase_order (stock via movement engine)
-- ---------------------------------------------------------------------------
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
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  IF NOT public.user_can_manage(v_po.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_po.status = 'received' THEN
    RAISE EXCEPTION 'Purchase order already received';
  END IF;

  PERFORM public.ensure_default_accounts(v_po.organization_id);

  FOR v_line IN SELECT * FROM purchase_order_lines WHERE po_id = p_po_id LOOP
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
      v_po.organization_id,
      'purchase_receipt',
      v_lines,
      'purchase_order',
      p_po_id,
      'PO receipt ' || p_po_id::text,
      auth.uid(),
      'po_receipt:' || p_po_id::text,
      jsonb_build_object('po_total', v_po.total)
    );
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

-- ---------------------------------------------------------------------------
-- Refactor: complete_manufacturing_order (stock via movement engine)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_manufacturing_order(p_mo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mo manufacturing_orders%ROWTYPE;
  v_bom boms%ROWTYPE;
  v_line RECORD;
  v_need NUMERIC;
  v_stock NUMERIC;
  v_batches NUMERIC;
  v_component_cost NUMERIC := 0;
  v_unit_cost NUMERIC;
  v_output_product_id UUID;
  v_existing_qty NUMERIC;
  v_existing_cost NUMERIC;
  v_lines JSONB := '[]'::jsonb;
  v_movement_id UUID;
BEGIN
  SELECT * INTO v_mo FROM manufacturing_orders WHERE id = p_mo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO not found'; END IF;
  IF NOT public.user_can_manage(v_mo.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_mo.status NOT IN ('draft', 'confirmed') THEN RAISE EXCEPTION 'MO already completed or cancelled'; END IF;

  SELECT * INTO v_bom FROM boms WHERE id = v_mo.bom_id;

  FOR v_line IN
    SELECT bl.* FROM bom_lines bl WHERE bl.bom_id = v_bom.id
  LOOP
    v_need := v_line.quantity * (v_mo.quantity / NULLIF(v_bom.output_qty, 0));
    SELECT il.quantity INTO v_stock
    FROM inventory_levels il
    WHERE il.organization_id = v_mo.organization_id
      AND il.store_id = v_mo.store_id
      AND il.variant_id = v_line.component_variant_id;

    IF COALESCE(v_stock, 0) < v_need THEN
      RAISE EXCEPTION 'Insufficient component stock for variant %', v_line.component_variant_id;
    END IF;

    SELECT COALESCE(pv.cost_price, p.cost_price, 0) INTO v_unit_cost
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = v_line.component_variant_id;

    v_component_cost := v_component_cost + (v_need * v_unit_cost);

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'store_id', v_mo.store_id,
      'variant_id', v_line.component_variant_id,
      'quantity_delta', -v_need,
      'unit_cost', v_unit_cost,
      'line_notes', 'MO component consumption'
    ));
  END LOOP;

  v_batches := v_mo.quantity;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'store_id', v_mo.store_id,
    'variant_id', v_bom.output_variant_id,
    'quantity_delta', v_batches,
    'line_notes', 'MO finished goods'
  ));

  SELECT pv.product_id, COALESCE(pv.cost_price, p.cost_price, 0), COALESCE(il.quantity, 0)
  INTO v_output_product_id, v_existing_cost, v_existing_qty
  FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  LEFT JOIN inventory_levels il ON il.variant_id = pv.id AND il.store_id = v_mo.store_id
  WHERE pv.id = v_bom.output_variant_id;

  v_movement_id := public._apply_stock_movement(
    v_mo.organization_id,
    'production_receipt',
    v_lines,
    'manufacturing_order',
    p_mo_id,
    'MO completion',
    auth.uid(),
    'mo_complete:' || p_mo_id::text,
    jsonb_build_object('component_cost', v_component_cost, 'output_qty', v_batches)
  );

  IF v_batches > 0 AND v_component_cost > 0 THEN
    v_unit_cost := v_component_cost / v_batches;
    IF COALESCE(v_existing_qty, 0) > 0 THEN
      v_unit_cost := ((v_existing_qty * v_existing_cost) + v_component_cost) / (v_existing_qty + v_batches);
    END IF;
    UPDATE product_variants SET cost_price = v_unit_cost, updated_at = now()
    WHERE id = v_bom.output_variant_id;
    UPDATE products SET cost_price = v_unit_cost, updated_at = now()
    WHERE id = v_output_product_id;
  END IF;

  UPDATE manufacturing_orders SET status = 'done', completed_at = now() WHERE id = p_mo_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_mo.organization_id, auth.uid(), 'manufacturing_order', p_mo_id, 'completed',
    jsonb_build_object('component_cost', v_component_cost, 'output_qty', v_batches, 'movement_id', v_movement_id)
  );

  RETURN jsonb_build_object(
    'manufacturing_order_id', p_mo_id,
    'component_cost', v_component_cost,
    'unit_cost', v_unit_cost,
    'movement_id', v_movement_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Backfill historical movements from inventory_adjustments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_stock_movements_from_adjustments(
  p_org_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 5000
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adj RECORD;
  v_movement_id UUID;
  v_count INT := 0;
  v_type stock_movement_type;
BEGIN
  FOR v_adj IN
    SELECT ia.*
    FROM inventory_adjustments ia
    WHERE (p_org_id IS NULL OR ia.organization_id = p_org_id)
      AND NOT EXISTS (
        SELECT 1 FROM stock_movements sm
        WHERE sm.reference_type = 'inventory_adjustment'
          AND sm.reference_id = ia.id
      )
    ORDER BY ia.created_at
    LIMIT GREATEST(1, LEAST(p_limit, 50000))
  LOOP
    v_type := CASE
      WHEN v_adj.reason ILIKE 'Transfer out%' OR v_adj.reason ILIKE 'Transfer in%' THEN 'warehouse_transfer'
      WHEN v_adj.reason ILIKE 'PO receipt%' THEN 'purchase_receipt'
      ELSE 'adjustment'
    END;

    INSERT INTO stock_movements (
      organization_id, movement_type, reference_type, reference_id,
      notes, user_id, created_at, metadata
    ) VALUES (
      v_adj.organization_id, v_type, 'inventory_adjustment', v_adj.id,
      v_adj.reason, v_adj.user_id, v_adj.created_at,
      jsonb_build_object('backfilled', true)
    )
    RETURNING id INTO v_movement_id;

    INSERT INTO stock_movement_lines (
      movement_id, organization_id, store_id, variant_id,
      quantity_delta, quantity_before, quantity_after, line_notes, created_at
    ) VALUES (
      v_movement_id, v_adj.organization_id, v_adj.store_id, v_adj.variant_id,
      v_adj.delta, 0, v_adj.delta, v_adj.reason, v_adj.created_at
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.list_stock_movements(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_inventory_levels_page(UUID, UUID, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_stock(UUID, UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_manufacturing_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_stock_movements_from_adjustments(UUID, INT) TO service_role;

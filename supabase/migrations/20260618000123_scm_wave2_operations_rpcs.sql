-- SCM Wave 2: operations RPCs — lots, quality, cycle count, MRP, procurement.

-- ---------------------------------------------------------------------------
-- Quality hold guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_not_on_quality_hold(
  p_org_id UUID,
  p_store_id UUID,
  p_variant_id UUID,
  p_lot_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM quality_holds qh
    WHERE qh.organization_id = p_org_id
      AND qh.store_id = p_store_id
      AND qh.variant_id = p_variant_id
      AND qh.status = 'active'
      AND (qh.lot_id IS NULL OR p_lot_id IS NULL OR qh.lot_id = p_lot_id)
  ) THEN
    RAISE EXCEPTION 'Stock is on quality hold for this variant';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Lot balance helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_lot_balance(
  p_org_id UUID,
  p_store_id UUID,
  p_variant_id UUID,
  p_lot_id UUID,
  p_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty NUMERIC;
BEGIN
  IF p_lot_id IS NULL OR p_delta = 0 THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM inventory_lots il
    WHERE il.id = p_lot_id AND il.organization_id = p_org_id AND il.variant_id = p_variant_id
  ) THEN
    RAISE EXCEPTION 'Invalid lot for variant';
  END IF;

  INSERT INTO lot_balances (organization_id, store_id, variant_id, lot_id, quantity)
  VALUES (p_org_id, p_store_id, p_variant_id, p_lot_id, GREATEST(p_delta, 0))
  ON CONFLICT (store_id, lot_id) DO UPDATE
  SET quantity = lot_balances.quantity + p_delta,
      updated_at = now()
  RETURNING quantity INTO v_qty;

  IF v_qty < 0 THEN
    RAISE EXCEPTION 'Insufficient lot quantity';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Create lot record
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._create_inventory_lot(
  p_org_id UUID,
  p_variant_id UUID,
  p_lot_number TEXT,
  p_expiry_date DATE DEFAULT NULL,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_code TEXT := NULLIF(trim(p_lot_number), '');
BEGIN
  IF v_code IS NULL THEN RAISE EXCEPTION 'Lot number is required'; END IF;

  INSERT INTO inventory_lots (
    organization_id, variant_id, lot_number, expiry_date,
    source_type, source_id, notes
  ) VALUES (
    p_org_id, p_variant_id, v_code, p_expiry_date,
    p_source_type, p_source_id, p_notes
  )
  ON CONFLICT (organization_id, lot_number) DO UPDATE
  SET expiry_date = COALESCE(EXCLUDED.expiry_date, inventory_lots.expiry_date),
      notes = COALESCE(EXCLUDED.notes, inventory_lots.notes)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Patch movement engine: quality holds + lot balances
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
  v_lot_id UUID;
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
    IF v_movement_id IS NOT NULL THEN RETURN v_movement_id; END IF;
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

    IF v_delta < 0 THEN
      v_lot_id := NULLIF(v_line->>'lot_id', '')::UUID;
      PERFORM public._assert_not_on_quality_hold(p_organization_id, v_store_id, v_variant_id, v_lot_id);
    END IF;

    PERFORM 1 FROM inventory_levels
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
    v_lot_id := NULLIF(v_line->>'lot_id', '')::UUID;
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

    IF v_lot_id IS NOT NULL THEN
      PERFORM public._apply_lot_balance(p_organization_id, v_store_id, v_variant_id, v_lot_id, v_delta);
    END IF;

    INSERT INTO stock_movement_lines (
      movement_id, organization_id, store_id, variant_id, lot_id,
      quantity_delta, quantity_before, quantity_after, unit_cost, line_notes
    ) VALUES (
      v_movement_id, p_organization_id, v_store_id, v_variant_id, v_lot_id,
      v_delta, v_before, v_after, v_unit_cost, v_line_notes
    );
  END LOOP;

  RETURN v_movement_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Lot tracking
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_product_lot_tracking(
  p_product_id UUID,
  p_track_lots BOOLEAN
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
  UPDATE products SET track_lots = COALESCE(p_track_lots, false), updated_at = now()
  WHERE id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_inventory_lots(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_variant_id UUID DEFAULT NULL,
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
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM inventory_lots il
  WHERE il.organization_id = p_org_id
    AND (p_variant_id IS NULL OR il.variant_id = p_variant_id)
    AND (
      p_store_id IS NULL
      OR EXISTS (
        SELECT 1 FROM lot_balances lb
        WHERE lb.lot_id = il.id AND lb.store_id = p_store_id AND lb.quantity > 0
      )
    );

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      il.id,
      il.variant_id,
      pv.name AS variant_name,
      p.name AS product_name,
      il.lot_number,
      il.expiry_date,
      il.status,
      il.created_at,
      COALESCE((
        SELECT SUM(lb.quantity) FROM lot_balances lb
        WHERE lb.lot_id = il.id AND (p_store_id IS NULL OR lb.store_id = p_store_id)
      ), 0) AS total_qty
    FROM inventory_lots il
    JOIN product_variants pv ON pv.id = il.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE il.organization_id = p_org_id
      AND (p_variant_id IS NULL OR il.variant_id = p_variant_id)
      AND (
        p_store_id IS NULL
        OR EXISTS (
          SELECT 1 FROM lot_balances lb
          WHERE lb.lot_id = il.id AND lb.store_id = p_store_id AND lb.quantity > 0
        )
      )
    ORDER BY il.expiry_date NULLS LAST, il.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) t;

  RETURN jsonb_build_object('items', v_items, 'total_count', v_total);
END;
$$;

-- ---------------------------------------------------------------------------
-- Quality holds
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_quality_hold(
  p_org_id UUID,
  p_store_id UUID,
  p_variant_id UUID,
  p_reason TEXT,
  p_lot_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;

  INSERT INTO quality_holds (
    organization_id, store_id, variant_id, lot_id, reason, placed_by
  ) VALUES (
    p_org_id, p_store_id, p_variant_id, p_lot_id,
    trim(p_reason), auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_quality_hold(p_hold_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM quality_holds WHERE id = p_hold_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE quality_holds
  SET status = 'released', released_at = now(), released_by = auth.uid()
  WHERE id = p_hold_id AND status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION public.list_quality_holds(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_active_only BOOLEAN DEFAULT true
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
        qh.id, qh.store_id, s.name AS store_name,
        qh.variant_id, pv.name AS variant_name, p.name AS product_name,
        qh.lot_id, il.lot_number, qh.status, qh.reason,
        qh.created_at, qh.released_at
      FROM quality_holds qh
      JOIN stores s ON s.id = qh.store_id
      JOIN product_variants pv ON pv.id = qh.variant_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN inventory_lots il ON il.id = qh.lot_id
      WHERE qh.organization_id = p_org_id
        AND (p_store_id IS NULL OR qh.store_id = p_store_id)
        AND (NOT p_active_only OR qh.status = 'active')
      ORDER BY qh.created_at DESC
      LIMIT 100
    ) t
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Cycle counting
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_cycle_count_session(
  p_org_id UUID,
  p_store_id UUID,
  p_name TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT := NULLIF(trim(p_name), '');
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Session name is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM stores WHERE id = p_store_id AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'Invalid store';
  END IF;

  INSERT INTO cycle_count_sessions (organization_id, store_id, name, notes, status, created_by)
  VALUES (p_org_id, p_store_id, v_name, NULLIF(trim(p_notes), ''), 'in_progress', auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO cycle_count_lines (session_id, organization_id, variant_id, expected_qty)
  SELECT v_id, p_org_id, il.variant_id, il.quantity
  FROM inventory_levels il
  WHERE il.organization_id = p_org_id AND il.store_id = p_store_id AND il.quantity <> 0;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_cycle_count_line(
  p_session_id UUID,
  p_variant_id UUID,
  p_counted_qty NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess cycle_count_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_sess FROM cycle_count_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF NOT public.user_can_manage(v_sess.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_sess.status NOT IN ('draft', 'in_progress') THEN
    RAISE EXCEPTION 'Session is not open for counting';
  END IF;

  UPDATE cycle_count_lines
  SET counted_qty = p_counted_qty,
      variance_qty = p_counted_qty - expected_qty,
      notes = NULLIF(trim(p_notes), ''),
      counted_at = now()
  WHERE session_id = p_session_id AND variant_id = p_variant_id;

  IF NOT FOUND THEN
    INSERT INTO cycle_count_lines (
      session_id, organization_id, variant_id, expected_qty, counted_qty, variance_qty, notes, counted_at
    ) VALUES (
      p_session_id, v_sess.organization_id, p_variant_id, 0, p_counted_qty, p_counted_qty,
      NULLIF(trim(p_notes), ''), now()
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_cycle_count(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess cycle_count_sessions%ROWTYPE;
  v_line cycle_count_lines%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_movement_id UUID;
  v_adjusted INT := 0;
BEGIN
  SELECT * INTO v_sess FROM cycle_count_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF NOT public.user_can_manage(v_sess.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_sess.status = 'finalized' THEN RAISE EXCEPTION 'Session already finalized'; END IF;

  FOR v_line IN
    SELECT * FROM cycle_count_lines
    WHERE session_id = p_session_id AND counted_qty IS NOT NULL AND variance_qty IS DISTINCT FROM 0
  LOOP
    IF COALESCE(v_line.variance_qty, 0) = 0 THEN CONTINUE; END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'store_id', v_sess.store_id,
      'variant_id', v_line.variant_id,
      'quantity_delta', v_line.variance_qty,
      'line_notes', 'Cycle count ' || v_sess.name
    ));
    v_adjusted := v_adjusted + 1;
  END LOOP;

  IF jsonb_array_length(v_lines) > 0 THEN
    v_movement_id := public._apply_stock_movement(
      v_sess.organization_id, 'cycle_count_adjustment', v_lines,
      'cycle_count', p_session_id, 'Cycle count finalize: ' || v_sess.name,
      auth.uid(), 'cycle_count:' || p_session_id::text, '{}'::jsonb
    );

    FOR v_line IN
      SELECT * FROM cycle_count_lines
      WHERE session_id = p_session_id AND counted_qty IS NOT NULL AND variance_qty IS DISTINCT FROM 0
    LOOP
      INSERT INTO inventory_adjustments (store_id, variant_id, organization_id, delta, reason, user_id)
      VALUES (v_sess.store_id, v_line.variant_id, v_sess.organization_id, v_line.variance_qty,
              'Cycle count ' || v_sess.name, auth.uid());
    END LOOP;
  END IF;

  UPDATE cycle_count_sessions
  SET status = 'finalized', finalized_at = now(), finalized_by = auth.uid()
  WHERE id = p_session_id;

  RETURN jsonb_build_object('session_id', p_session_id, 'lines_adjusted', v_adjusted, 'movement_id', v_movement_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_cycle_count_sessions(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 20
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
        cs.id, cs.store_id, s.name AS store_name, cs.name, cs.status, cs.notes,
        cs.created_at, cs.finalized_at,
        (SELECT COUNT(*)::INT FROM cycle_count_lines ccl WHERE ccl.session_id = cs.id) AS line_count,
        (SELECT COUNT(*)::INT FROM cycle_count_lines ccl WHERE ccl.session_id = cs.id AND ccl.counted_qty IS NOT NULL) AS counted_lines
      FROM cycle_count_sessions cs
      JOIN stores s ON s.id = cs.store_id
      WHERE cs.organization_id = p_org_id
        AND (p_store_id IS NULL OR cs.store_id = p_store_id)
      ORDER BY cs.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cycle_count_session(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess cycle_count_sessions%ROWTYPE;
  v_lines JSONB;
BEGIN
  SELECT * INTO v_sess FROM cycle_count_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF NOT public.user_has_org_access(v_sess.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.product_name), '[]'::jsonb) INTO v_lines
  FROM (
    SELECT
      ccl.id, ccl.variant_id, pv.name AS variant_name, p.name AS product_name,
      ccl.expected_qty, ccl.counted_qty, ccl.variance_qty, ccl.notes, ccl.counted_at
    FROM cycle_count_lines ccl
    JOIN product_variants pv ON pv.id = ccl.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE ccl.session_id = p_session_id
  ) t;

  RETURN jsonb_build_object(
    'session', row_to_json(v_sess),
    'lines', v_lines
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- MRP
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_mrp(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_count INT := 0;
  v_row RECORD;
  v_demand RECORD;
  v_on_hand NUMERIC;
  v_suggest NUMERIC;
  v_vendor_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO mrp_runs (organization_id, store_id, created_by)
  VALUES (p_org_id, p_store_id, auth.uid())
  RETURNING id INTO v_run_id;

  FOR v_row IN
    SELECT il.store_id, il.variant_id, il.quantity AS on_hand,
           COALESCE(p.reorder_point, 0) AS reorder_point, p.name AS product_name
    FROM inventory_levels il
    JOIN product_variants pv ON pv.id = il.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE il.organization_id = p_org_id
      AND (p_store_id IS NULL OR il.store_id = p_store_id)
      AND COALESCE(p.reorder_point, 0) > 0
      AND il.quantity <= p.reorder_point
  LOOP
    v_suggest := GREATEST(v_row.reorder_point * 2 - v_row.on_hand, v_row.reorder_point - v_row.on_hand, 1);

    SELECT ps.vendor_id INTO v_vendor_id
    FROM product_suppliers ps
    JOIN products p ON p.id = ps.product_id
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE pv.id = v_row.variant_id AND ps.is_active AND ps.is_preferred
    ORDER BY ps.lead_time_days NULLS LAST
    LIMIT 1;

    IF v_vendor_id IS NULL THEN
      SELECT ps.vendor_id INTO v_vendor_id
      FROM product_suppliers ps
      JOIN products p ON p.id = ps.product_id
      JOIN product_variants pv ON pv.product_id = p.id
      WHERE pv.id = v_row.variant_id AND ps.is_active
      LIMIT 1;
    END IF;

    INSERT INTO mrp_suggestions (
      organization_id, mrp_run_id, store_id, variant_id, source,
      on_hand, reorder_point, suggested_qty, preferred_vendor_id
    ) VALUES (
      p_org_id, v_run_id, v_row.store_id, v_row.variant_id, 'reorder_point',
      v_row.on_hand, v_row.reorder_point, v_suggest, v_vendor_id
    );
    v_count := v_count + 1;
  END LOOP;

  FOR v_demand IN
    SELECT mo.store_id, bl.component_variant_id AS variant_id,
           SUM(bl.quantity * mo.quantity / NULLIF(b.output_qty, 0)) AS demand_qty
    FROM manufacturing_orders mo
    JOIN boms b ON b.id = mo.bom_id
    JOIN bom_lines bl ON bl.bom_id = b.id
    WHERE mo.organization_id = p_org_id
      AND mo.status = 'confirmed'
      AND (p_store_id IS NULL OR mo.store_id = p_store_id)
    GROUP BY mo.store_id, bl.component_variant_id
  LOOP
    SELECT COALESCE(quantity, 0) INTO v_on_hand
    FROM inventory_levels
    WHERE organization_id = p_org_id
      AND store_id = v_demand.store_id
      AND variant_id = v_demand.variant_id;

    IF v_on_hand < v_demand.demand_qty THEN
      v_suggest := v_demand.demand_qty - v_on_hand;
      SELECT ps.vendor_id INTO v_vendor_id
      FROM product_suppliers ps
      JOIN product_variants pv ON pv.product_id = ps.product_id
      WHERE pv.id = v_demand.variant_id AND ps.is_active
      LIMIT 1;

      INSERT INTO mrp_suggestions (
        organization_id, mrp_run_id, store_id, variant_id, source,
        on_hand, reorder_point, suggested_qty, preferred_vendor_id
      ) VALUES (
        p_org_id, v_run_id, v_demand.store_id, v_demand.variant_id, 'manufacturing',
        v_on_hand, 0, v_suggest, v_vendor_id
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  UPDATE mrp_runs SET suggestion_count = v_count WHERE id = v_run_id;

  RETURN jsonb_build_object('run_id', v_run_id, 'suggestion_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_mrp_suggestions(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_include_dismissed BOOLEAN DEFAULT false
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
        ms.id, ms.store_id, s.name AS store_name,
        ms.variant_id, pv.name AS variant_name, p.name AS product_name,
        ms.source, ms.on_hand, ms.reorder_point, ms.suggested_qty,
        ms.preferred_vendor_id, v.name AS vendor_name,
        ms.is_dismissed, ms.created_at, ms.mrp_run_id
      FROM mrp_suggestions ms
      JOIN stores s ON s.id = ms.store_id
      JOIN product_variants pv ON pv.id = ms.variant_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN vendors v ON v.id = ms.preferred_vendor_id
      WHERE ms.organization_id = p_org_id
        AND (p_store_id IS NULL OR ms.store_id = p_store_id)
        AND (p_include_dismissed OR NOT ms.is_dismissed)
      ORDER BY ms.created_at DESC
      LIMIT 200
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_mrp_suggestion(p_suggestion_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM mrp_suggestions WHERE id = p_suggestion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE mrp_suggestions SET is_dismissed = true WHERE id = p_suggestion_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Purchase requisitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_requisition(
  p_org_id UUID,
  p_store_id UUID,
  p_title TEXT,
  p_lines JSONB,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_line JSONB;
  v_title TEXT := NULLIF(trim(p_title), '');
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one line is required';
  END IF;

  INSERT INTO purchase_requisitions (organization_id, store_id, title, notes, status, created_by)
  VALUES (p_org_id, p_store_id, v_title, NULLIF(trim(p_notes), ''), 'draft', auth.uid())
  RETURNING id INTO v_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO purchase_requisition_lines (
      requisition_id, organization_id, variant_id, product_name, quantity,
      suggested_vendor_id, unit_cost_estimate, mrp_suggestion_id, line_notes
    ) VALUES (
      v_id, p_org_id,
      (v_line->>'variantId')::UUID,
      COALESCE(v_line->>'productName', 'Product'),
      GREATEST((v_line->>'quantity')::NUMERIC, 0.001),
      NULLIF(v_line->>'vendorId', '')::UUID,
      NULLIF(v_line->>'unitCost', '')::NUMERIC,
      NULLIF(v_line->>'mrpSuggestionId', '')::UUID,
      NULLIF(v_line->>'notes', '')
    );
  END LOOP;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_requisition_from_mrp(
  p_org_id UUID,
  p_store_id UUID,
  p_suggestion_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_sid UUID;
  v_s mrp_suggestions%ROWTYPE;
  v_name TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_suggestion_ids IS NULL OR array_length(p_suggestion_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one suggestion';
  END IF;

  INSERT INTO purchase_requisitions (
    organization_id, store_id, title, status, created_by
  ) VALUES (
    p_org_id, p_store_id, 'MRP replenishment ' || to_char(now(), 'YYYY-MM-DD'), 'submitted', auth.uid()
  )
  RETURNING id INTO v_id;

  FOREACH v_sid IN ARRAY p_suggestion_ids LOOP
    SELECT * INTO v_s FROM mrp_suggestions
    WHERE id = v_sid AND organization_id = p_org_id AND NOT is_dismissed;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT p.name INTO v_name
    FROM products p JOIN product_variants pv ON pv.product_id = p.id
    WHERE pv.id = v_s.variant_id;

    INSERT INTO purchase_requisition_lines (
      requisition_id, organization_id, variant_id, product_name, quantity,
      suggested_vendor_id, mrp_suggestion_id
    ) VALUES (
      v_id, p_org_id, v_s.variant_id, COALESCE(v_name, 'Product'),
      v_s.suggested_qty, v_s.preferred_vendor_id, v_s.id
    );

    UPDATE mrp_suggestions
    SET requisition_line_id = (
      SELECT prl.id FROM purchase_requisition_lines prl
      WHERE prl.requisition_id = v_id AND prl.mrp_suggestion_id = v_sid LIMIT 1
    )
    WHERE id = v_sid;
  END LOOP;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_requisition_to_po(p_requisition_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req purchase_requisitions%ROWTYPE;
  v_line purchase_requisition_lines%ROWTYPE;
  v_vendor_id UUID;
  v_po_id UUID;
  v_lines JSONB := '[]'::jsonb;
  v_cost NUMERIC;
BEGIN
  SELECT * INTO v_req FROM purchase_requisitions WHERE id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found'; END IF;
  IF NOT public.user_can_manage(v_req.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_req.status = 'converted' THEN RAISE EXCEPTION 'Requisition already converted'; END IF;

  SELECT COALESCE(
    (SELECT suggested_vendor_id FROM purchase_requisition_lines
     WHERE requisition_id = p_requisition_id AND suggested_vendor_id IS NOT NULL LIMIT 1),
    (SELECT id FROM vendors WHERE organization_id = v_req.organization_id AND is_active LIMIT 1)
  ) INTO v_vendor_id;

  IF v_vendor_id IS NULL THEN RAISE EXCEPTION 'No vendor available for PO'; END IF;

  FOR v_line IN SELECT * FROM purchase_requisition_lines WHERE requisition_id = p_requisition_id LOOP
    v_cost := COALESCE(v_line.unit_cost_estimate, 0);
    IF v_cost = 0 THEN
      SELECT COALESCE(pv.cost_price, p.cost_price, 0) INTO v_cost
      FROM product_variants pv JOIN products p ON p.id = pv.product_id
      WHERE pv.id = v_line.variant_id;
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'variantId', v_line.variant_id,
      'productName', v_line.product_name,
      'quantity', v_line.quantity,
      'unitCost', v_cost
    ));
  END LOOP;

  v_po_id := public.create_purchase_order(
    v_req.organization_id, v_vendor_id, v_req.store_id,
    NULL, 'From requisition ' || v_req.title, v_lines
  );

  UPDATE purchase_requisitions
  SET status = 'converted', po_id = v_po_id, approved_at = now(), approved_by = auth.uid()
  WHERE id = p_requisition_id;

  RETURN v_po_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_purchase_requisitions(
  p_org_id UUID,
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
        pr.id, pr.store_id, s.name AS store_name, pr.title, pr.status, pr.notes,
        pr.po_id, pr.created_at, pr.approved_at,
        (SELECT COUNT(*)::INT FROM purchase_requisition_lines prl WHERE prl.requisition_id = pr.id) AS line_count
      FROM purchase_requisitions pr
      JOIN stores s ON s.id = pr.store_id
      WHERE pr.organization_id = p_org_id
      ORDER BY pr.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100))
    ) t
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Partial PO receipt + lot capture
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receive_purchase_order(UUID);

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id UUID,
  p_receipt_lines JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_line purchase_order_lines%ROWTYPE;
  v_receipt JSONB;
  v_recv_qty NUMERIC;
  v_remaining NUMERIC;
  v_bill_id UUID;
  v_entry_id UUID;
  v_on_hand NUMERIC;
  v_old_cost NUMERIC;
  v_new_cost NUMERIC;
  v_lines JSONB := '[]'::jsonb;
  v_movement_id UUID;
  v_method inventory_costing_method;
  v_lot_id UUID;
  v_lot_number TEXT;
  v_expiry DATE;
  v_track_lots BOOLEAN;
  v_receipt_total NUMERIC := 0;
  v_all_received BOOLEAN := true;
  v_any_received BOOLEAN := false;
  v_mv RECORD;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT public.user_can_manage(v_po.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_po.status = 'received' THEN RAISE EXCEPTION 'Purchase order already fully received'; END IF;
  IF v_po.status = 'cancelled' THEN RAISE EXCEPTION 'Purchase order is cancelled'; END IF;

  PERFORM public.ensure_default_accounts(v_po.organization_id);
  SELECT inventory_costing_method INTO v_method FROM organizations WHERE id = v_po.organization_id;

  FOR v_line IN SELECT * FROM purchase_order_lines WHERE po_id = p_po_id LOOP
    v_recv_qty := NULL;
    IF p_receipt_lines IS NOT NULL THEN
      SELECT elem INTO v_receipt
      FROM jsonb_array_elements(p_receipt_lines) elem
      WHERE (elem->>'lineId')::UUID = v_line.id
      LIMIT 1;
      IF v_receipt IS NOT NULL THEN
        v_recv_qty := GREATEST((v_receipt->>'quantity')::NUMERIC, 0);
      ELSE
        CONTINUE;
      END IF;
    ELSE
      v_recv_qty := v_line.quantity - COALESCE(v_line.qty_received, 0);
    END IF;

    v_remaining := v_line.quantity - COALESCE(v_line.qty_received, 0);
    IF v_recv_qty IS NULL OR v_recv_qty <= 0 THEN
      IF v_remaining > 0 THEN v_all_received := false; END IF;
      CONTINUE;
    END IF;
    IF v_recv_qty > v_remaining + 0.001 THEN
      RAISE EXCEPTION 'Receive qty exceeds remaining for line %', v_line.id;
    END IF;

    v_any_received := true;
    IF v_recv_qty < v_remaining - 0.001 THEN v_all_received := false; END IF;
    v_receipt_total := v_receipt_total + round(v_recv_qty * v_line.unit_cost, 2);

    SELECT COALESCE(p.track_lots, false) INTO v_track_lots
    FROM products p JOIN product_variants pv ON pv.product_id = p.id
    WHERE pv.id = v_line.variant_id;

    v_lot_id := NULL;
    IF v_track_lots THEN
      v_lot_number := NULL;
      v_expiry := NULL;
      IF v_receipt IS NOT NULL THEN
        v_lot_number := NULLIF(trim(v_receipt->>'lotNumber'), '');
        v_expiry := NULLIF(v_receipt->>'expiryDate', '')::DATE;
      END IF;
      IF v_lot_number IS NULL THEN
        v_lot_number := 'PO-' || left(p_po_id::text, 8) || '-' || left(v_line.id::text, 8);
      END IF;
      v_lot_id := public._create_inventory_lot(
        v_po.organization_id, v_line.variant_id, v_lot_number, v_expiry,
        'purchase_order', p_po_id, 'PO receipt'
      );
    END IF;

    IF v_method = 'moving_average' THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_on_hand
      FROM inventory_levels WHERE variant_id = v_line.variant_id;
      SELECT COALESCE(pv.cost_price, p.cost_price, 0) INTO v_old_cost
      FROM product_variants pv LEFT JOIN products p ON p.id = pv.product_id
      WHERE pv.id = v_line.variant_id;
      IF (v_on_hand + v_recv_qty) > 0 THEN
        v_new_cost := round(
          ((v_on_hand * COALESCE(v_old_cost, 0)) + (v_recv_qty * v_line.unit_cost))
          / (v_on_hand + v_recv_qty), 2);
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
      'quantity_delta', v_recv_qty,
      'unit_cost', v_line.unit_cost,
      'line_notes', 'PO receipt',
      'lot_id', v_lot_id
    ));

    UPDATE purchase_order_lines
    SET qty_received = COALESCE(qty_received, 0) + v_recv_qty
    WHERE id = v_line.id;
  END LOOP;

  IF NOT v_any_received THEN
    RAISE EXCEPTION 'No lines to receive';
  END IF;

  IF jsonb_array_length(v_lines) > 0 THEN
    v_movement_id := public._apply_stock_movement(
      v_po.organization_id, 'purchase_receipt', v_lines,
      'purchase_order', p_po_id, 'PO receipt ' || p_po_id::text,
      auth.uid(), 'po_receipt:' || p_po_id::text || ':' || COALESCE(v_po.received_at::text, now()::text),
      jsonb_build_object('receipt_total', v_receipt_total)
    );

    IF v_method = 'fifo' THEN
      FOR v_mv IN SELECT value AS r FROM jsonb_array_elements(v_lines) AS t(value) LOOP
        PERFORM public._add_inventory_cost_layer(
          v_po.organization_id, v_po.store_id,
          (v_mv.r->>'variant_id')::UUID,
          (v_mv.r->>'quantity_delta')::NUMERIC,
          (v_mv.r->>'unit_cost')::NUMERIC,
          'purchase_order', p_po_id
        );
      END LOOP;
    END IF;
  END IF;

  FOR v_mv IN SELECT value AS r FROM jsonb_array_elements(v_lines) AS t(value) LOOP
    INSERT INTO inventory_adjustments (store_id, variant_id, organization_id, delta, reason, user_id)
    VALUES (
      v_po.store_id,
      (v_mv.r->>'variant_id')::UUID,
      v_po.organization_id,
      (v_mv.r->>'quantity_delta')::NUMERIC,
      'PO receipt ' || p_po_id::text,
      auth.uid()
    );
  END LOOP;

  INSERT INTO vendor_bills (organization_id, vendor_id, po_id, bill_date, amount, status)
  VALUES (v_po.organization_id, v_po.vendor_id, p_po_id, current_date, v_receipt_total, 'open')
  RETURNING id INTO v_bill_id;

  IF v_receipt_total > 0 THEN
    v_entry_id := public.post_journal_entry(
      v_po.organization_id, 'PUR', current_date,
      'Goods receipt PO ' || p_po_id::text, 'purchase', p_po_id,
      jsonb_build_array(
        jsonb_build_object('accountId', public.account_id_by_code(v_po.organization_id, '1200'),
          'debit', v_receipt_total, 'credit', 0, 'description', 'Inventory received'),
        jsonb_build_object('accountId', public.account_id_by_code(v_po.organization_id, '2000'),
          'debit', 0, 'credit', v_receipt_total, 'description', 'Accounts payable')
      )
    );
    UPDATE vendor_bills SET journal_entry_id = v_entry_id WHERE id = v_bill_id;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM purchase_order_lines
    WHERE po_id = p_po_id AND COALESCE(qty_received, 0) < quantity - 0.001
  ) INTO v_all_received;

  UPDATE purchase_orders
  SET
    status = CASE WHEN v_all_received THEN 'received'::po_status ELSE 'partially_received'::po_status END,
    received_at = CASE WHEN v_all_received THEN now() ELSE received_at END
  WHERE id = p_po_id;

  RETURN v_bill_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.set_product_lot_tracking TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_inventory_lots TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_quality_hold TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_quality_hold TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_quality_holds TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_cycle_count_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cycle_count_line TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_cycle_count TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_cycle_count_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cycle_count_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_mrp TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_mrp_suggestions TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_mrp_suggestion TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_requisition TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_requisition_from_mrp TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_requisition_to_po TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_purchase_requisitions TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(UUID, JSONB) TO authenticated;

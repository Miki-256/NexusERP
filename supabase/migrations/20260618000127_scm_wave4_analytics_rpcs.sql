-- SCM Wave 4: analytics RPCs, forecasting, valuation, e-commerce sync.

-- ---------------------------------------------------------------------------
-- Capture daily snapshot (manual / scheduled)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.capture_inventory_snapshot(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_snapshot_date DATE DEFAULT current_date
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO inventory_daily_snapshots (
    organization_id, store_id, variant_id, snapshot_date,
    quantity, unit_cost, inventory_value
  )
  SELECT
    il.organization_id, il.store_id, il.variant_id, p_snapshot_date,
    il.quantity,
    COALESCE(pv.cost_price, p.cost_price, 0),
    round(il.quantity * COALESCE(pv.cost_price, p.cost_price, 0), 2)
  FROM inventory_levels il
  JOIN product_variants pv ON pv.id = il.variant_id
  JOIN products p ON p.id = pv.product_id
  WHERE il.organization_id = p_org_id
    AND (p_store_id IS NULL OR il.store_id = p_store_id)
    AND il.quantity <> 0
  ON CONFLICT (store_id, variant_id, snapshot_date) DO UPDATE SET
    quantity = EXCLUDED.quantity,
    unit_cost = EXCLUDED.unit_cost,
    inventory_value = EXCLUDED.inventory_value;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- SCM dashboard KPIs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scm_dashboard_stats(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_skus INT;
  v_total_units NUMERIC;
  v_total_value NUMERIC;
  v_low_stock INT;
  v_open_fo INT;
  v_movements_today INT;
  v_dead_stock INT;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COUNT(*)::INT, COALESCE(SUM(il.quantity), 0), COALESCE(SUM(round(il.quantity * COALESCE(pv.cost_price, p.cost_price, 0), 2)), 0)
  INTO v_total_skus, v_total_units, v_total_value
  FROM inventory_levels il
  JOIN product_variants pv ON pv.id = il.variant_id
  JOIN products p ON p.id = pv.product_id
  WHERE il.organization_id = p_org_id
    AND (p_store_id IS NULL OR il.store_id = p_store_id)
    AND il.quantity > 0;

  SELECT COUNT(*)::INT INTO v_low_stock
  FROM inventory_levels il
  JOIN products p ON p.id = (SELECT product_id FROM product_variants WHERE id = il.variant_id)
  WHERE il.organization_id = p_org_id
    AND (p_store_id IS NULL OR il.store_id = p_store_id)
    AND COALESCE(p.reorder_point, 0) > 0
    AND il.quantity <= p.reorder_point;

  SELECT COUNT(*)::INT INTO v_open_fo
  FROM fulfillment_orders fo
  WHERE fo.organization_id = p_org_id
    AND (p_store_id IS NULL OR fo.store_id = p_store_id)
    AND fo.status NOT IN ('shipped', 'cancelled');

  SELECT COUNT(DISTINCT sm.id)::INT INTO v_movements_today
  FROM stock_movements sm
  WHERE sm.organization_id = p_org_id
    AND sm.created_at >= date_trunc('day', now());

  SELECT COUNT(*)::INT INTO v_dead_stock
  FROM inventory_levels il
  WHERE il.organization_id = p_org_id
    AND (p_store_id IS NULL OR il.store_id = p_store_id)
    AND il.quantity > 0
    AND NOT EXISTS (
      SELECT 1 FROM stock_movement_lines sml
      JOIN stock_movements sm ON sm.id = sml.movement_id
      WHERE sml.variant_id = il.variant_id
        AND sml.store_id = il.store_id
        AND sm.created_at >= now() - interval '90 days'
    );

  RETURN jsonb_build_object(
    'total_skus', v_total_skus,
    'total_units', v_total_units,
    'total_value', v_total_value,
    'low_stock_count', v_low_stock,
    'open_fulfillment_orders', v_open_fo,
    'movements_today', v_movements_today,
    'dead_stock_count', v_dead_stock
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- ABC analysis (by sales value in period)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_abc_analysis(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_days INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from TIMESTAMPTZ := now() - (GREATEST(COALESCE(p_days, 90), 7) || ' days')::interval;
  v_items JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  WITH sales AS (
    SELECT
      sl.variant_id,
      p.name AS product_name,
      pv.name AS variant_name,
      SUM(sl.quantity) AS units_sold,
      SUM(sl.line_total) AS revenue
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    JOIN product_variants pv ON pv.id = sl.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND (p_store_id IS NULL OR s.store_id = p_store_id)
      AND s.created_at >= v_from
    GROUP BY sl.variant_id, p.name, pv.name
  ),
  ranked AS (
    SELECT
      *,
      SUM(revenue) OVER () AS total_revenue,
      SUM(revenue) OVER (ORDER BY revenue DESC ROWS UNBOUNDED PRECEDING) AS cumulative_revenue
    FROM sales
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      variant_id, product_name, variant_name,
      units_sold, round(revenue, 2) AS revenue,
      CASE
        WHEN total_revenue = 0 THEN 'C'
        WHEN cumulative_revenue / total_revenue <= 0.8 THEN 'A'
        WHEN cumulative_revenue / total_revenue <= 0.95 THEN 'B'
        ELSE 'C'
      END AS abc_class
    FROM ranked
    ORDER BY revenue DESC
    LIMIT 200
  ) t;

  RETURN jsonb_build_object('items', v_items, 'period_days', p_days);
END;
$$;

-- ---------------------------------------------------------------------------
-- Inventory valuation report
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_valuation_report(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.inventory_value DESC)
      FROM (
        SELECT
          il.store_id, s.name AS store_name,
          il.variant_id, p.name AS product_name, pv.name AS variant_name,
          il.quantity AS on_hand,
          COALESCE(pv.cost_price, p.cost_price, 0) AS unit_cost,
          round(il.quantity * COALESCE(pv.cost_price, p.cost_price, 0), 2) AS inventory_value
        FROM inventory_levels il
        JOIN stores s ON s.id = il.store_id
        JOIN product_variants pv ON pv.id = il.variant_id
        JOIN products p ON p.id = pv.product_id
        WHERE il.organization_id = p_org_id
          AND (p_store_id IS NULL OR il.store_id = p_store_id)
          AND il.quantity > 0
        ORDER BY inventory_value DESC
        LIMIT 500
      ) t
    ), '[]'::jsonb),
    'total_value', COALESCE((
      SELECT round(SUM(il.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 2)
      FROM inventory_levels il
      JOIN product_variants pv ON pv.id = il.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE il.organization_id = p_org_id
        AND (p_store_id IS NULL OR il.store_id = p_store_id)
    ), 0)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Stock aging (days since last movement)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_aging_report(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
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
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.days_since_movement DESC NULLS FIRST)
    FROM (
      SELECT
        il.store_id, s.name AS store_name,
        il.variant_id, p.name AS product_name, pv.name AS variant_name,
        il.quantity AS on_hand,
        MAX(sm.created_at) AS last_movement_at,
        CASE
          WHEN MAX(sm.created_at) IS NULL THEN NULL
          ELSE EXTRACT(DAY FROM now() - MAX(sm.created_at))::INT
        END AS days_since_movement
      FROM inventory_levels il
      JOIN stores s ON s.id = il.store_id
      JOIN product_variants pv ON pv.id = il.variant_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN stock_movement_lines sml ON sml.variant_id = il.variant_id AND sml.store_id = il.store_id
      LEFT JOIN stock_movements sm ON sm.id = sml.movement_id
      WHERE il.organization_id = p_org_id
        AND (p_store_id IS NULL OR il.store_id = p_store_id)
        AND il.quantity > 0
      GROUP BY il.store_id, s.name, il.variant_id, p.name, pv.name, il.quantity
      ORDER BY days_since_movement DESC NULLS FIRST
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    ) t
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Movement summary by type
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_movement_summary(
  p_org_id UUID,
  p_from DATE,
  p_to DATE,
  p_store_id UUID DEFAULT NULL
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
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.movement_count DESC)
    FROM (
      SELECT
        sm.movement_type,
        COUNT(DISTINCT sm.id)::INT AS movement_count,
        COALESCE(SUM(ABS(sml.quantity_delta)), 0) AS total_units_moved
      FROM stock_movements sm
      JOIN stock_movement_lines sml ON sml.movement_id = sm.id
      WHERE sm.organization_id = p_org_id
        AND sm.created_at >= p_from::timestamptz
        AND sm.created_at < (p_to + 1)::date
        AND (p_store_id IS NULL OR sml.store_id = p_store_id)
      GROUP BY sm.movement_type
    ) t
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Demand forecast (moving average from sale history)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_inventory_forecast(
  p_org_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_horizon_days INT DEFAULT 30,
  p_history_days INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_from TIMESTAMPTZ;
  v_count INT := 0;
  v_horizon INT := GREATEST(COALESCE(p_horizon_days, 30), 7);
  v_history INT := GREATEST(COALESCE(p_history_days, 90), 14);
  v_row RECORD;
  v_avg NUMERIC;
  v_forecast NUMERIC;
  v_on_hand NUMERIC;
  v_dos NUMERIC;
  v_abc TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  v_from := now() - (v_history || ' days')::interval;

  INSERT INTO inventory_forecast_runs (
    organization_id, store_id, method, history_days, horizon_days, created_by
  ) VALUES (
    p_org_id, p_store_id, 'moving_average', v_history, v_horizon, auth.uid()
  )
  RETURNING id INTO v_run_id;

  FOR v_row IN
    SELECT
      s.store_id,
      sl.variant_id,
      p.name AS product_name,
      SUM(sl.quantity) AS units_sold
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    JOIN products p ON p.id = (SELECT product_id FROM product_variants WHERE id = sl.variant_id)
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND s.created_at >= v_from
      AND (p_store_id IS NULL OR s.store_id = p_store_id)
    GROUP BY s.store_id, sl.variant_id, p.name
    HAVING SUM(sl.quantity) > 0
  LOOP
    v_avg := v_row.units_sold / v_history;
    v_forecast := round(v_avg * v_horizon, 3);

    SELECT COALESCE(quantity, 0) INTO v_on_hand
    FROM inventory_levels
    WHERE store_id = v_row.store_id AND variant_id = v_row.variant_id;

    v_dos := CASE WHEN v_avg > 0 THEN round(v_on_hand / v_avg, 1) ELSE NULL END;

    SELECT COALESCE(abc_class, 'C') INTO v_abc
    FROM (
      SELECT (elem->>'abc_class') AS abc_class
      FROM jsonb_array_elements(
        (public.inventory_abc_analysis(p_org_id, v_row.store_id, v_history)->'items')
      ) elem
      WHERE (elem->>'variant_id')::UUID = v_row.variant_id
      LIMIT 1
    ) sub;

    INSERT INTO inventory_forecast_lines (
      forecast_run_id, organization_id, store_id, variant_id, product_name,
      avg_daily_demand, forecast_qty, on_hand, days_of_supply, abc_class
    ) VALUES (
      v_run_id, p_org_id, v_row.store_id, v_row.variant_id, v_row.product_name,
      round(v_avg, 4), v_forecast, v_on_hand, v_dos, v_abc
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE inventory_forecast_runs SET line_count = v_count WHERE id = v_run_id;

  RETURN jsonb_build_object('run_id', v_run_id, 'line_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_inventory_forecast(
  p_org_id UUID,
  p_run_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF p_run_id IS NOT NULL THEN
    v_run_id := p_run_id;
  ELSE
    SELECT id INTO v_run_id
    FROM inventory_forecast_runs
    WHERE organization_id = p_org_id
    ORDER BY run_at DESC
    LIMIT 1;
  END IF;

  IF v_run_id IS NULL THEN
    RETURN jsonb_build_object('run_id', NULL, 'lines', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'run', (SELECT row_to_json(r) FROM inventory_forecast_runs r WHERE r.id = v_run_id),
    'lines', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.days_of_supply NULLS LAST)
      FROM (
        SELECT
          ifl.*, s.name AS store_name
        FROM inventory_forecast_lines ifl
        JOIN stores s ON s.id = ifl.store_id
        WHERE ifl.forecast_run_id = v_run_id
        ORDER BY ifl.days_of_supply NULLS LAST
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- E-commerce channels
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_ecommerce_channel(
  p_org_id UUID,
  p_name TEXT,
  p_channel_type ecommerce_channel_type DEFAULT 'manual',
  p_store_id UUID DEFAULT NULL,
  p_config JSONB DEFAULT '{}',
  p_id UUID DEFAULT NULL
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
  IF v_name IS NULL THEN RAISE EXCEPTION 'Channel name is required'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE ecommerce_channels SET
      name = v_name,
      channel_type = COALESCE(p_channel_type, channel_type),
      store_id = p_store_id,
      config = COALESCE(p_config, config),
      is_active = true
    WHERE id = p_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO ecommerce_channels (organization_id, name, channel_type, store_id, config)
  VALUES (p_org_id, v_name, COALESCE(p_channel_type, 'manual'), p_store_id, COALESCE(p_config, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_ecommerce_channels(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.name)
    FROM (
      SELECT
        ec.id, ec.name, ec.channel_type, ec.store_id, s.name AS store_name,
        ec.is_active, ec.last_sync_at, ec.created_at,
        (SELECT COUNT(*)::INT FROM ecommerce_product_mappings epm WHERE epm.channel_id = ec.id) AS mapping_count
      FROM ecommerce_channels ec
      LEFT JOIN stores s ON s.id = ec.store_id
      WHERE ec.organization_id = p_org_id AND ec.is_active
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_ecommerce_product_mapping(
  p_channel_id UUID,
  p_variant_id UUID,
  p_external_sku TEXT DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL,
  p_sync_inventory BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM ecommerce_channels WHERE id = p_channel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Channel not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO ecommerce_product_mappings (
    organization_id, channel_id, variant_id, external_sku, external_id, sync_inventory
  ) VALUES (
    v_org_id, p_channel_id, p_variant_id,
    NULLIF(trim(p_external_sku), ''), NULLIF(trim(p_external_id), ''),
    COALESCE(p_sync_inventory, true)
  )
  ON CONFLICT (channel_id, variant_id) DO UPDATE SET
    external_sku = COALESCE(EXCLUDED.external_sku, ecommerce_product_mappings.external_sku),
    external_id = COALESCE(EXCLUDED.external_id, ecommerce_product_mappings.external_id),
    sync_inventory = EXCLUDED.sync_inventory
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_ecommerce_inventory(p_channel_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel ecommerce_channels%ROWTYPE;
  v_run_id UUID;
  v_payload JSONB := '[]'::jsonb;
  v_count INT := 0;
  v_row RECORD;
BEGIN
  SELECT * INTO v_channel FROM ecommerce_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Channel not found'; END IF;
  IF NOT public.user_can_manage(v_channel.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO ecommerce_sync_runs (organization_id, channel_id, status)
  VALUES (v_channel.organization_id, p_channel_id, 'running')
  RETURNING id INTO v_run_id;

  FOR v_row IN
    SELECT
      epm.variant_id, epm.external_sku, epm.external_id,
      p.name AS product_name, pv.name AS variant_name,
      COALESCE(il.quantity, 0) AS available_qty
    FROM ecommerce_product_mappings epm
    JOIN product_variants pv ON pv.id = epm.variant_id
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN inventory_levels il ON il.variant_id = epm.variant_id
      AND (v_channel.store_id IS NULL OR il.store_id = v_channel.store_id)
    WHERE epm.channel_id = p_channel_id AND epm.sync_inventory
  LOOP
    v_payload := v_payload || jsonb_build_array(jsonb_build_object(
      'variant_id', v_row.variant_id,
      'external_sku', v_row.external_sku,
      'external_id', v_row.external_id,
      'product_name', v_row.product_name,
      'available_qty', v_row.available_qty
    ));
    v_count := v_count + 1;
  END LOOP;

  UPDATE ecommerce_sync_runs
  SET status = 'success', items_synced = v_count, payload = v_payload, completed_at = now()
  WHERE id = v_run_id;

  UPDATE ecommerce_channels SET last_sync_at = now() WHERE id = p_channel_id;

  RETURN jsonb_build_object(
    'sync_run_id', v_run_id,
    'items_synced', v_count,
    'payload', v_payload,
    'channel_type', v_channel.channel_type,
    'note', CASE
      WHEN v_channel.channel_type = 'manual' THEN 'Export payload for manual upload to your storefront'
      ELSE 'Channel API integration pending — payload prepared'
    END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.capture_inventory_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION public.scm_dashboard_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_abc_analysis TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_valuation_report TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_aging_report TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_movement_summary TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_inventory_forecast TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_inventory_forecast TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_ecommerce_channel TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ecommerce_channels TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_ecommerce_product_mapping TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_ecommerce_inventory TO authenticated;

-- Fix MRP duplicate suggestions: supersede open rows on each run,
-- dismiss when converted to a requisition, and enforce one open row
-- per (org, store, variant, source).

-- ---------------------------------------------------------------------------
-- 1) One-time cleanup: keep newest open suggestion per SKU/source key
-- ---------------------------------------------------------------------------
UPDATE mrp_suggestions
SET is_dismissed = true
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id, store_id, variant_id, source
        ORDER BY created_at DESC, id DESC
      ) AS rn
    FROM mrp_suggestions
    WHERE NOT is_dismissed
  ) ranked
  WHERE rn > 1
);

-- Converted-but-still-open rows should leave the live list
UPDATE mrp_suggestions
SET is_dismissed = true
WHERE NOT is_dismissed
  AND requisition_line_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Safety net: at most one open suggestion per SKU/source
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_mrp_suggestions_active_sku
  ON mrp_suggestions (organization_id, store_id, variant_id, source)
  WHERE NOT is_dismissed;

-- ---------------------------------------------------------------------------
-- 3) run_mrp — supersede prior open suggestions before inserting this run
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

  -- Refresh live set: dismiss open suggestions in scope (history kept via mrp_runs)
  UPDATE mrp_suggestions
  SET is_dismissed = true
  WHERE organization_id = p_org_id
    AND NOT is_dismissed
    AND (p_store_id IS NULL OR store_id = p_store_id);

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
    v_vendor_id := NULL;

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

    IF NOT FOUND THEN
      v_on_hand := 0;
    END IF;

    IF v_on_hand < v_demand.demand_qty THEN
      v_suggest := v_demand.demand_qty - v_on_hand;
      v_vendor_id := NULL;
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

-- ---------------------------------------------------------------------------
-- 4) create_requisition_from_mrp — dismiss converted suggestions
-- ---------------------------------------------------------------------------
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
    SET
      requisition_line_id = (
        SELECT prl.id FROM purchase_requisition_lines prl
        WHERE prl.requisition_id = v_id AND prl.mrp_suggestion_id = v_sid LIMIT 1
      ),
      is_dismissed = true
    WHERE id = v_sid;
  END LOOP;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_mrp TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_requisition_from_mrp TO authenticated;

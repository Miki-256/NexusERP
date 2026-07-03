-- Manufacturing: roll up component costs into finished goods on MO completion.

DROP FUNCTION IF EXISTS public.complete_manufacturing_order(UUID);

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

    UPDATE inventory_levels SET quantity = quantity - v_need, updated_at = now()
    WHERE organization_id = v_mo.organization_id
      AND store_id = v_mo.store_id
      AND variant_id = v_line.component_variant_id;
  END LOOP;

  v_batches := v_mo.quantity;

  INSERT INTO inventory_levels (organization_id, store_id, variant_id, quantity)
  VALUES (v_mo.organization_id, v_mo.store_id, v_bom.output_variant_id, v_batches)
  ON CONFLICT (store_id, variant_id)
  DO UPDATE SET quantity = inventory_levels.quantity + v_batches, updated_at = now();

  SELECT pv.product_id, COALESCE(pv.cost_price, p.cost_price, 0), COALESCE(il.quantity, 0)
  INTO v_output_product_id, v_existing_cost, v_existing_qty
  FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  LEFT JOIN inventory_levels il ON il.variant_id = pv.id AND il.store_id = v_mo.store_id
  WHERE pv.id = v_bom.output_variant_id;

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
    jsonb_build_object('component_cost', v_component_cost, 'output_qty', v_batches)
  );

  RETURN jsonb_build_object(
    'manufacturing_order_id', p_mo_id,
    'component_cost', v_component_cost,
    'unit_cost', v_unit_cost
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_manufacturing_order(UUID) TO authenticated;

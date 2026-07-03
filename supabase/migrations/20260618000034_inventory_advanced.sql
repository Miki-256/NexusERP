-- Inventory: reorder points, stock transfers, low-stock listing.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS reorder_point NUMERIC NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_store_id UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  to_store_id UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  note TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_store_id <> to_store_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_org ON stock_transfers(organization_id);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_transfers_select ON stock_transfers;
CREATE POLICY stock_transfers_select ON stock_transfers FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

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
  v_from_qty NUMERIC;
  v_transfer_id UUID;
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

  SELECT quantity INTO v_from_qty
  FROM inventory_levels
  WHERE store_id = p_from_store_id AND variant_id = p_variant_id
  FOR UPDATE;

  IF COALESCE(v_from_qty, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock at source store';
  END IF;

  UPDATE inventory_levels
  SET quantity = quantity - p_quantity, updated_at = now()
  WHERE store_id = p_from_store_id AND variant_id = p_variant_id;

  INSERT INTO inventory_levels (organization_id, store_id, variant_id, quantity)
  VALUES (v_org_id, p_to_store_id, p_variant_id, p_quantity)
  ON CONFLICT (store_id, variant_id)
  DO UPDATE SET quantity = inventory_levels.quantity + EXCLUDED.quantity, updated_at = now();

  INSERT INTO stock_transfers (
    organization_id, from_store_id, to_store_id, variant_id, quantity, note, created_by
  ) VALUES (
    v_org_id, p_from_store_id, p_to_store_id, p_variant_id, p_quantity, p_note, auth.uid()
  )
  RETURNING id INTO v_transfer_id;

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
      'quantity', p_quantity
    )
  );

  RETURN v_transfer_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_stock TO authenticated;

CREATE OR REPLACE FUNCTION public.list_low_stock_items(p_organization_id UUID, p_store_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'quantity')::numeric ASC)
      FROM (
        SELECT jsonb_build_object(
          'store_id', il.store_id,
          'store_name', s.name,
          'variant_id', il.variant_id,
          'variant_name', pv.name,
          'product_name', p.name,
          'quantity', il.quantity,
          'reorder_point', p.reorder_point
        ) AS row_data
        FROM inventory_levels il
        JOIN stores s ON s.id = il.store_id
        JOIN product_variants pv ON pv.id = il.variant_id
        JOIN products p ON p.id = pv.product_id
        WHERE il.organization_id = p_organization_id
          AND p.reorder_point > 0
          AND il.quantity <= p.reorder_point
          AND (p_store_id IS NULL OR il.store_id = p_store_id)
      ) x
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_low_stock_items TO authenticated;

CREATE OR REPLACE FUNCTION public.set_product_reorder_point(
  p_product_id UUID,
  p_reorder_point NUMERIC
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF NOT public.user_can_manage(v_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_reorder_point < 0 THEN
    RAISE EXCEPTION 'Reorder point cannot be negative';
  END IF;

  UPDATE products SET reorder_point = p_reorder_point, updated_at = now() WHERE id = p_product_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_product_reorder_point TO authenticated;

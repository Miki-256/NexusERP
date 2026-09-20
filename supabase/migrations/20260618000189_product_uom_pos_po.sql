-- Product UOM (fixed conversions): schema, RPCs, PO/POS qty_base conversion.
-- Stock always moves in base units. Tip Payable COGS uses qty_base when present.

-- ---------------------------------------------------------------------------
-- Line columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.sale_lines
  ADD COLUMN IF NOT EXISTS uom_code TEXT,
  ADD COLUMN IF NOT EXISTS qty_base NUMERIC(14,6);

ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS uom_code TEXT,
  ADD COLUMN IF NOT EXISTS qty_base NUMERIC(14,6);

UPDATE public.sale_lines
SET qty_base = quantity,
    uom_code = COALESCE(uom_code, 'ea')
WHERE qty_base IS NULL;

UPDATE public.purchase_order_lines
SET qty_base = quantity,
    uom_code = COALESCE(uom_code, 'ea')
WHERE qty_base IS NULL;

ALTER TABLE public.sale_lines
  ALTER COLUMN qty_base SET DEFAULT NULL;

-- ---------------------------------------------------------------------------
-- Resolve sale/PO line UOM → base quantity
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._resolve_line_uom(
  p_variant_id UUID,
  p_quantity NUMERIC,
  p_uom_code TEXT DEFAULT NULL,
  p_require_sale BOOLEAN DEFAULT false,
  p_require_purchase BOOLEAN DEFAULT false
)
RETURNS TABLE(uom_code TEXT, qty_base NUMERIC, conversion_factor NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_org_id UUID;
  v_code TEXT;
  v_factor NUMERIC;
  v_is_base BOOLEAN;
  v_is_sale BOOLEAN;
  v_is_purchase BOOLEAN;
  v_base_code TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;

  SELECT pv.product_id, pv.organization_id, COALESCE(NULLIF(trim(p.base_uom_code), ''), 'ea')
  INTO v_product_id, v_org_id, v_base_code
  FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  WHERE pv.id = p_variant_id;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Variant not found';
  END IF;

  v_code := NULLIF(trim(p_uom_code), '');
  IF v_code IS NULL THEN
    SELECT u.uom_code INTO v_code
    FROM product_uoms u
    WHERE u.product_id = v_product_id AND u.is_base
    LIMIT 1;
    v_code := COALESCE(v_code, v_base_code, 'ea');
  END IF;

  SELECT u.conversion_factor, u.is_base, u.is_sale, u.is_purchase, u.uom_code
  INTO v_factor, v_is_base, v_is_sale, v_is_purchase, v_code
  FROM product_uoms u
  WHERE u.product_id = v_product_id AND lower(u.uom_code) = lower(v_code)
  LIMIT 1;

  IF v_factor IS NULL THEN
    IF lower(v_code) = lower(v_base_code) OR lower(v_code) = 'ea' THEN
      v_factor := 1;
      v_is_base := true;
      v_is_sale := true;
      v_is_purchase := true;
      -- ensure row exists for future edits
      INSERT INTO product_uoms (organization_id, product_id, uom_code, uom_name, conversion_factor, is_base, is_sale, is_purchase)
      VALUES (v_org_id, v_product_id, v_code, v_code, 1, true, true, true)
      ON CONFLICT (product_id, uom_code) DO NOTHING;
    ELSE
      RAISE EXCEPTION 'Unknown UOM % for product', v_code;
    END IF;
  END IF;

  IF p_require_sale AND NOT COALESCE(v_is_sale, false) AND NOT COALESCE(v_is_base, false) THEN
    RAISE EXCEPTION 'UOM % is not enabled for sale', v_code;
  END IF;
  IF p_require_purchase AND NOT COALESCE(v_is_purchase, false) AND NOT COALESCE(v_is_base, false) THEN
    RAISE EXCEPTION 'UOM % is not enabled for purchase', v_code;
  END IF;

  IF v_factor <= 0 THEN
    RAISE EXCEPTION 'Invalid conversion factor for UOM %', v_code;
  END IF;

  uom_code := v_code;
  conversion_factor := v_factor;
  qty_base := round(p_quantity * v_factor, 6);
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Upsert / delete product UOM
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_product_uom(
  p_product_id UUID,
  p_uom_code TEXT,
  p_uom_name TEXT,
  p_conversion_factor NUMERIC,
  p_is_base BOOLEAN DEFAULT false,
  p_is_sale BOOLEAN DEFAULT false,
  p_is_purchase BOOLEAN DEFAULT false,
  p_uom_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_id UUID;
  v_code TEXT := lower(trim(p_uom_code));
  v_name TEXT := trim(p_uom_name);
  v_factor NUMERIC := p_conversion_factor;
BEGIN
  SELECT organization_id INTO v_org_id FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF v_code IS NULL OR v_code = '' THEN RAISE EXCEPTION 'UOM code is required'; END IF;
  IF v_name IS NULL OR v_name = '' THEN RAISE EXCEPTION 'UOM name is required'; END IF;
  IF v_factor IS NULL OR v_factor <= 0 THEN RAISE EXCEPTION 'Conversion factor must be > 0'; END IF;

  IF COALESCE(p_is_base, false) THEN
    v_factor := 1;
    UPDATE product_uoms SET is_base = false WHERE product_id = p_product_id AND is_base;
    UPDATE products SET base_uom_code = v_code WHERE id = p_product_id;
  END IF;

  IF p_uom_id IS NOT NULL THEN
    UPDATE product_uoms SET
      uom_code = v_code,
      uom_name = v_name,
      conversion_factor = v_factor,
      is_base = COALESCE(p_is_base, false),
      is_sale = COALESCE(p_is_sale, false) OR COALESCE(p_is_base, false),
      is_purchase = COALESCE(p_is_purchase, false) OR COALESCE(p_is_base, false)
    WHERE id = p_uom_id AND product_id = p_product_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'UOM not found'; END IF;
  ELSE
    INSERT INTO product_uoms (
      organization_id, product_id, uom_code, uom_name, conversion_factor,
      is_base, is_sale, is_purchase
    ) VALUES (
      v_org_id, p_product_id, v_code, v_name, v_factor,
      COALESCE(p_is_base, false),
      COALESCE(p_is_sale, false) OR COALESCE(p_is_base, false),
      COALESCE(p_is_purchase, false) OR COALESCE(p_is_base, false)
    )
    ON CONFLICT (product_id, uom_code) DO UPDATE SET
      uom_name = EXCLUDED.uom_name,
      conversion_factor = EXCLUDED.conversion_factor,
      is_base = EXCLUDED.is_base,
      is_sale = EXCLUDED.is_sale,
      is_purchase = EXCLUDED.is_purchase
    RETURNING id INTO v_id;
  END IF;

  -- Ensure exactly one base
  IF NOT EXISTS (SELECT 1 FROM product_uoms WHERE product_id = p_product_id AND is_base) THEN
    UPDATE product_uoms SET is_base = true, conversion_factor = 1, is_sale = true, is_purchase = true
    WHERE id = (
      SELECT id FROM product_uoms WHERE product_id = p_product_id
      ORDER BY CASE WHEN lower(uom_code) = 'ea' THEN 0 ELSE 1 END, created_at
      LIMIT 1
    );
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_product_uom(p_uom_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row product_uoms%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM product_uoms WHERE id = p_uom_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'UOM not found'; END IF;
  IF NOT public.user_can_manage(v_row.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_row.is_base THEN RAISE EXCEPTION 'Cannot delete base UOM'; END IF;
  DELETE FROM product_uoms WHERE id = p_uom_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_product_uom TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product_uom TO authenticated;

-- ---------------------------------------------------------------------------
-- create_purchase_order with UOM
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_org_id UUID,
  p_vendor_id UUID,
  p_store_id UUID,
  p_expected_date DATE,
  p_notes TEXT,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po_id UUID;
  v_line JSONB;
  v_total NUMERIC := 0;
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_uom TEXT;
  v_qty_base NUMERIC;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO purchase_orders (organization_id, vendor_id, store_id, status, expected_date, notes, created_by)
  VALUES (p_org_id, p_vendor_id, p_store_id, 'ordered', p_expected_date, p_notes, auth.uid())
  RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (v_line->>'quantity')::NUMERIC;
    v_cost := (v_line->>'unitCost')::NUMERIC;
    v_uom := NULLIF(trim(v_line->>'uomCode'), '');
    SELECT r.uom_code, r.qty_base INTO v_uom, v_qty_base
    FROM public._resolve_line_uom((v_line->>'variantId')::UUID, v_qty, v_uom, false, true) r;

    INSERT INTO purchase_order_lines (
      po_id, organization_id, variant_id, product_name,
      quantity, unit_cost, line_total, uom_code, qty_base
    ) VALUES (
      v_po_id, p_org_id, (v_line->>'variantId')::UUID, v_line->>'productName',
      v_qty, v_cost, v_qty * v_cost, v_uom, v_qty_base
    );
    v_total := v_total + v_qty * v_cost;
  END LOOP;

  UPDATE purchase_orders SET total = v_total WHERE id = v_po_id;
  RETURN v_po_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_purchase_order TO authenticated;

-- ---------------------------------------------------------------------------
-- Sale stock movement: deduct qty_base from sale_lines
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
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT variant_id, COALESCE(qty_base, quantity) AS qty
    FROM sale_lines
    WHERE sale_id = p_sale_id
  LOOP
    IF v_row.variant_id IS NULL OR v_row.qty IS NULL OR v_row.qty <= 0 THEN CONTINUE; END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'store_id', p_store_id,
      'variant_id', v_row.variant_id,
      'quantity_delta', -v_row.qty,
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
  v_factor NUMERIC;
  v_recv_base NUMERIC;
  v_unit_cost_base NUMERIC;
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

    v_factor := CASE
      WHEN COALESCE(v_line.quantity, 0) > 0 AND COALESCE(v_line.qty_base, 0) > 0
        THEN v_line.qty_base / v_line.quantity
      ELSE 1
    END;
    v_recv_base := round(v_recv_qty * v_factor, 6);
    v_unit_cost_base := CASE WHEN v_factor > 0 THEN round(v_line.unit_cost / v_factor, 6) ELSE v_line.unit_cost END;

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
      IF (v_on_hand + v_recv_base) > 0 THEN
        v_new_cost := round(
          ((v_on_hand * COALESCE(v_old_cost, 0)) + (v_recv_base * v_unit_cost_base))
          / (v_on_hand + v_recv_base), 2);
      ELSE
        v_new_cost := v_unit_cost_base;
      END IF;
      UPDATE product_variants SET cost_price = v_new_cost WHERE id = v_line.variant_id;
      UPDATE products p SET cost_price = v_new_cost
        FROM product_variants pv WHERE pv.id = v_line.variant_id AND p.id = pv.product_id;
    END IF;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'store_id', v_po.store_id,
      'variant_id', v_line.variant_id,
      'quantity_delta', v_recv_base,
      'unit_cost', v_unit_cost_base,
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
  v_uom_code TEXT;
  v_qty_base NUMERIC;
  v_product_id UUID;
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
    v_uom_code := NULLIF(trim(v_line->>'uomCode'), '');

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity for variant %', v_variant_id;
    END IF;

    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid unit price for variant %', v_variant_id;
    END IF;

    IF v_line_discount < 0 THEN
      RAISE EXCEPTION 'Line discount cannot be negative';
    END IF;

    SELECT r.uom_code, r.qty_base INTO v_uom_code, v_qty_base
    FROM public._resolve_line_uom(v_variant_id, v_qty, v_uom_code, true, false) r;

    v_line_gross := round(v_unit_price * v_qty, 2);
    IF v_line_discount > v_line_gross + 0.01 THEN
      RAISE EXCEPTION 'Line discount exceeds line total for variant %', v_variant_id;
    END IF;

    SELECT quantity INTO v_stock FROM inventory_levels
    WHERE store_id = p_store_id AND variant_id = v_variant_id
    FOR UPDATE;

    IF v_stock IS NULL THEN v_stock := 0; END IF;
    IF v_stock < v_qty_base THEN
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
    v_uom_code := NULLIF(trim(v_line->>'uomCode'), '');
    SELECT r.uom_code, r.qty_base INTO v_uom_code, v_qty_base
    FROM public._resolve_line_uom(v_variant_id, v_qty, v_uom_code, true, false) r;
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
      quantity, unit_price, tax_amount, discount_amount, line_total,
      uom_code, qty_base
    ) VALUES (
      v_sale_id, v_variant_id,
      v_line->>'productName', v_line->>'variantName',
      v_qty, v_unit_price, v_line_tax, v_line_discount, v_line_total,
      v_uom_code, v_qty_base
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
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, NUMERIC, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sale TO authenticated;
-- Wave 2 signature only: (p_po_id, p_receipt_lines DEFAULT NULL) — no single-arg overload.
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(UUID, JSONB) TO authenticated;

-- COGS uses base qty when available
CREATE OR REPLACE FUNCTION public.post_sale_to_ledger_internal(p_sale_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_cogs NUMERIC := 0;
  v_merch_revenue NUMERIC;
  v_tip NUMERIC;
  v_entry_id UUID;
  v_pay RECORD;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND OR v_sale.status <> 'completed' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM payments WHERE sale_id = p_sale_id AND status = 'pending') THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = v_sale.organization_id AND source_type = 'sale' AND source_id = p_sale_id
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.ensure_default_accounts(v_sale.organization_id);

  v_merch_revenue := v_sale.subtotal - v_sale.discount_amount;
  v_tip := GREATEST(COALESCE(v_sale.tip_amount, 0), 0);

  SELECT COALESCE(SUM(
    COALESCE(sl.qty_base, sl.quantity) * COALESCE(pv.cost_price, p.cost_price, 0)
  ), 0)
    INTO v_cogs
  FROM sale_lines sl
  LEFT JOIN product_variants pv ON pv.id = sl.variant_id
  LEFT JOIN products p ON p.id = pv.product_id
  WHERE sl.sale_id = p_sale_id;

  FOR v_pay IN
    SELECT method, SUM(amount) AS amt FROM payments
    WHERE sale_id = p_sale_id AND status = 'completed'
    GROUP BY method
  LOOP
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, public._payment_method_account_code(v_pay.method)),
      'debit', v_pay.amt, 'credit', 0, 'description', 'Receipt ' || v_sale.receipt_no,
      'storeId', v_sale.store_id));
  END LOOP;

  IF v_merch_revenue > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '4000'),
      'debit', 0, 'credit', v_merch_revenue, 'description', 'Sales revenue',
      'storeId', v_sale.store_id));
  END IF;

  IF v_tip > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '2160'),
      'debit', 0, 'credit', v_tip, 'description', 'Tip payable',
      'storeId', v_sale.store_id));
  END IF;

  IF v_sale.tax_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '2100'),
      'debit', 0, 'credit', v_sale.tax_amount, 'description', 'Tax collected',
      'storeId', v_sale.store_id));
  END IF;

  IF v_cogs > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '5000'),
        'debit', v_cogs, 'credit', 0, 'description', 'COGS', 'storeId', v_sale.store_id),
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '1200'),
        'debit', 0, 'credit', v_cogs, 'description', 'Inventory relief', 'storeId', v_sale.store_id));
  END IF;

  v_entry_id := public._post_journal_entry_balanced(
    v_sale.organization_id, 'SAL', v_sale.created_at::date,
    'Sale ' || v_sale.receipt_no, 'sale', p_sale_id, v_lines, auth.uid()
  );
  RETURN v_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- POS catalog: include sale UOMs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pos_catalog(p_register_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_store UUID;
  v_result JSONB;
BEGIN
  SELECT organization_id, store_id INTO v_org, v_store
  FROM registers WHERE id = p_register_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'name'), '[]'::jsonb)
  INTO v_result
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
      'imageUrl', p.image_url,
      'saleUoms', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'code', u.uom_code,
            'name', u.uom_name,
            'factor', u.conversion_factor,
            'isBase', u.is_base
          )
          ORDER BY u.is_base DESC, u.uom_code
        )
        FROM product_uoms u
        WHERE u.product_id = p.id AND (u.is_sale OR u.is_base)
      ), '[]'::jsonb)
    ) AS row,
    p.name
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN inventory_levels il ON il.variant_id = pv.id AND il.store_id = v_store
    WHERE p.organization_id = v_org AND p.is_active = true
  ) sub;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_catalog TO anon, authenticated;

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
      'imageUrl', p.image_url,
      'saleUoms', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'code', u.uom_code,
            'name', u.uom_name,
            'factor', u.conversion_factor,
            'isBase', u.is_base
          )
          ORDER BY u.is_base DESC, u.uom_code
        )
        FROM product_uoms u
        WHERE u.product_id = p.id AND (u.is_sale OR u.is_base)
      ), '[]'::jsonb)
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

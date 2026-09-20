-- Fix void/refund stock restore to use sale_lines.qty_base (UOM-aware).
-- returned_quantity and return qty remain in sale UOM; inventory moves in base units.

CREATE OR REPLACE FUNCTION public._sale_line_base_factor(
  p_quantity NUMERIC,
  p_qty_base NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_quantity, 0) = 0 THEN 1::NUMERIC
    ELSE COALESCE(p_qty_base, p_quantity) / p_quantity
  END;
$$;

CREATE OR REPLACE FUNCTION public._sale_line_restore_remaining_base(
  p_quantity NUMERIC,
  p_returned_quantity NUMERIC,
  p_qty_base NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(
    (COALESCE(p_quantity, 0) - COALESCE(p_returned_quantity, 0))
      * public._sale_line_base_factor(p_quantity, p_qty_base),
    6
  );
$$;

CREATE OR REPLACE FUNCTION public._sale_line_return_to_base(
  p_return_qty NUMERIC,
  p_quantity NUMERIC,
  p_qty_base NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(
    COALESCE(p_return_qty, 0) * public._sale_line_base_factor(p_quantity, p_qty_base),
    6
  );
$$;

CREATE OR REPLACE FUNCTION public.void_sale_backoffice(
  p_sale_id UUID,
  p_reason TEXT,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_line sale_lines%ROWTYPE;
  v_user_id UUID;
  v_credit NUMERIC;
  v_on_account NUMERIC;
  v_issue_credit NUMERIC;
  v_already_returned NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_refund_method NOT IN ('cash', 'store_credit') THEN
    RAISE EXCEPTION 'Invalid refund method';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF NOT public.user_can_manage(v_sale.organization_id) THEN
    RAISE EXCEPTION 'Only managers can void sales';
  END IF;

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Sale cannot be voided';
  END IF;

  FOR v_line IN SELECT * FROM sale_lines WHERE sale_id = p_sale_id
  LOOP
    UPDATE inventory_levels
    SET quantity = quantity + public._sale_line_restore_remaining_base(v_line.quantity, v_line.returned_quantity, v_line.qty_base), updated_at = now()
    WHERE store_id = v_sale.store_id AND variant_id = v_line.variant_id;
  END LOOP;

  SELECT COALESCE(SUM(amount), 0) INTO v_credit
  FROM payments WHERE sale_id = p_sale_id AND method = 'store_credit';

  IF v_credit > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customer_credits
    SET balance = balance + v_credit, updated_at = now()
    WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id;

    INSERT INTO customer_credits (organization_id, customer_id, balance)
    SELECT v_sale.organization_id, v_sale.customer_id, v_credit
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_credits
      WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id
    );

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (v_sale.organization_id, v_sale.customer_id, v_credit, 'Restored — void ' || p_reason, p_sale_id);
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_on_account
  FROM payments WHERE sale_id = p_sale_id AND method = 'on_account';

  IF v_on_account > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customer_receivables
    SET balance = GREATEST(balance - v_on_account, 0), updated_at = now()
    WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id;

    INSERT INTO receivable_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (
      v_sale.organization_id, v_sale.customer_id, -v_on_account,
      'Reversed — void ' || p_reason, p_sale_id
    );
  END IF;

  IF p_refund_method = 'store_credit' THEN
    IF v_sale.customer_id IS NULL THEN
      RAISE EXCEPTION 'Customer required for store credit refund';
    END IF;
    SELECT COALESCE(SUM(total), 0) INTO v_already_returned
    FROM sale_returns WHERE original_sale_id = p_sale_id;
    v_issue_credit := GREATEST(v_sale.total - v_credit - v_already_returned, 0);
    IF v_issue_credit > 0 THEN
      INSERT INTO customer_credits (organization_id, customer_id, balance)
      VALUES (v_sale.organization_id, v_sale.customer_id, v_issue_credit)
      ON CONFLICT (organization_id, customer_id)
      DO UPDATE SET balance = customer_credits.balance + v_issue_credit, updated_at = now();

      INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
      VALUES (
        v_sale.organization_id, v_sale.customer_id, v_issue_credit,
        'Refund credit — void ' || p_reason, p_sale_id
      );
    END IF;
  END IF;

  UPDATE sales SET status = 'voided', void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, v_user_id, 'sale', p_sale_id, 'voided',
    jsonb_build_object('reason', p_reason, 'refund_method', p_refund_method, 'source', 'backoffice')
  );

  PERFORM public.enqueue_refund_void_ledger_post(p_sale_id, p_refund_method);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_sale_pos(
  p_sale_id UUID,
  p_reason TEXT,
  p_session_token TEXT,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_line sale_lines%ROWTYPE;
  v_staff RECORD;
  v_credit NUMERIC;
  v_on_account NUMERIC;
  v_issue_credit NUMERIC;
  v_already_returned NUMERIC;
BEGIN
  IF p_refund_method NOT IN ('cash', 'store_credit') THEN
    RAISE EXCEPTION 'Invalid refund method';
  END IF;

  SELECT * INTO v_staff FROM public.validate_pos_staff_session(p_session_token);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid session';
  END IF;

  IF v_staff.role <> 'manager' THEN
    RAISE EXCEPTION 'Only managers can void sales';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.organization_id <> v_staff.organization_id THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Sale cannot be voided';
  END IF;

  FOR v_line IN SELECT * FROM sale_lines WHERE sale_id = p_sale_id
  LOOP
    UPDATE inventory_levels
    SET quantity = quantity + public._sale_line_restore_remaining_base(v_line.quantity, v_line.returned_quantity, v_line.qty_base), updated_at = now()
    WHERE store_id = v_sale.store_id AND variant_id = v_line.variant_id;
  END LOOP;

  SELECT COALESCE(SUM(amount), 0) INTO v_credit
  FROM payments WHERE sale_id = p_sale_id AND method = 'store_credit';

  IF v_credit > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customer_credits
    SET balance = balance + v_credit, updated_at = now()
    WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id;

    INSERT INTO customer_credits (organization_id, customer_id, balance)
    SELECT v_sale.organization_id, v_sale.customer_id, v_credit
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_credits
      WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id
    );

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (v_sale.organization_id, v_sale.customer_id, v_credit, 'Restored — void ' || p_reason, p_sale_id);
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_on_account
  FROM payments WHERE sale_id = p_sale_id AND method = 'on_account';

  IF v_on_account > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customer_receivables
    SET balance = GREATEST(balance - v_on_account, 0), updated_at = now()
    WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id;

    INSERT INTO receivable_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (
      v_sale.organization_id, v_sale.customer_id, -v_on_account,
      'Reversed — void ' || p_reason, p_sale_id
    );
  END IF;

  IF p_refund_method = 'store_credit' THEN
    IF v_sale.customer_id IS NULL THEN
      RAISE EXCEPTION 'Customer required for store credit refund';
    END IF;
    SELECT COALESCE(SUM(total), 0) INTO v_already_returned
    FROM sale_returns WHERE original_sale_id = p_sale_id;
    v_issue_credit := GREATEST(v_sale.total - v_credit - v_already_returned, 0);
    IF v_issue_credit > 0 THEN
      INSERT INTO customer_credits (organization_id, customer_id, balance)
      VALUES (v_sale.organization_id, v_sale.customer_id, v_issue_credit)
      ON CONFLICT (organization_id, customer_id)
      DO UPDATE SET balance = customer_credits.balance + v_issue_credit, updated_at = now();

      INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
      VALUES (
        v_sale.organization_id, v_sale.customer_id, v_issue_credit,
        'Refund credit — void ' || p_reason, p_sale_id
      );
    END IF;
  END IF;

  UPDATE sales SET status = 'voided', void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, NULL, 'sale', p_sale_id, 'voided',
    jsonb_build_object(
      'reason', p_reason,
      'pos_staff_id', v_staff.staff_id,
      'refund_method', p_refund_method
    )
  );

  PERFORM public.enqueue_refund_void_ledger_post(p_sale_id, p_refund_method);
END;
$$;

CREATE OR REPLACE FUNCTION public.partial_return_sale(
  p_sale_id UUID,
  p_lines JSONB,
  p_reason TEXT,
  p_session_token TEXT,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_staff RECORD;
  v_line JSONB;
  v_sale_line sale_lines%ROWTYPE;
  v_return_id UUID;
  v_return_qty NUMERIC;
  v_available NUMERIC;
  v_refund_subtotal NUMERIC := 0;
  v_refund_tax NUMERIC := 0;
  v_refund_total NUMERIC := 0;
  v_line_refund NUMERIC;
  v_all_returned BOOLEAN := true;
  v_sl sale_lines%ROWTYPE;
BEGIN
  IF p_refund_method NOT IN ('cash', 'store_credit') THEN
    RAISE EXCEPTION 'Invalid refund method';
  END IF;

  SELECT * INTO v_staff FROM public.validate_pos_staff_session(p_session_token);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid session';
  END IF;

  IF v_staff.role <> 'manager' THEN
    RAISE EXCEPTION 'Only managers can process returns';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.organization_id <> v_staff.organization_id THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF v_sale.status NOT IN ('completed', 'returned') THEN
    RAISE EXCEPTION 'Sale cannot be returned';
  END IF;

  IF p_refund_method = 'store_credit' AND v_sale.customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer required for store credit refund';
  END IF;

  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Select at least one line to return';
  END IF;

  INSERT INTO sale_returns (
    organization_id, original_sale_id, refund_method, reason, pos_staff_id
  ) VALUES (
    v_sale.organization_id, p_sale_id, p_refund_method, p_reason, v_staff.staff_id
  ) RETURNING id INTO v_return_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_return_qty := (v_line->>'quantity')::NUMERIC;
    IF v_return_qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be positive';
    END IF;

    SELECT * INTO v_sale_line
    FROM sale_lines
    WHERE id = (v_line->>'saleLineId')::UUID AND sale_id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale line not found';
    END IF;

    v_available := v_sale_line.quantity - v_sale_line.returned_quantity;
    IF v_return_qty > v_available THEN
      RAISE EXCEPTION 'Return quantity exceeds available for %', v_sale_line.product_name;
    END IF;

    v_line_refund := round(v_sale_line.line_total * (v_return_qty / v_sale_line.quantity), 2);
    v_refund_total := v_refund_total + v_line_refund;

    IF v_sale_line.tax_amount > 0 AND v_sale_line.quantity > 0 THEN
      v_refund_tax := v_refund_tax + round(
        v_sale_line.tax_amount * (v_return_qty / v_sale_line.quantity), 2
      );
    END IF;

    v_refund_subtotal := v_refund_subtotal + (v_line_refund - round(
      v_sale_line.tax_amount * (v_return_qty / v_sale_line.quantity), 2
    ));

    UPDATE sale_lines
    SET returned_quantity = returned_quantity + v_return_qty
    WHERE id = v_sale_line.id;

    UPDATE inventory_levels
    SET quantity = quantity + public._sale_line_return_to_base(v_return_qty, v_sale_line.quantity, v_sale_line.qty_base), updated_at = now()
    WHERE store_id = v_sale.store_id AND variant_id = v_sale_line.variant_id;

    INSERT INTO sale_return_lines (return_id, sale_line_id, variant_id, quantity, line_total)
    VALUES (v_return_id, v_sale_line.id, v_sale_line.variant_id, v_return_qty, v_line_refund);
  END LOOP;

  UPDATE sale_returns
  SET subtotal = v_refund_subtotal, tax_amount = v_refund_tax, total = v_refund_total
  WHERE id = v_return_id;

  IF p_refund_method = 'store_credit' AND v_refund_total > 0 THEN
    INSERT INTO customer_credits (organization_id, customer_id, balance)
    VALUES (v_sale.organization_id, v_sale.customer_id, v_refund_total)
    ON CONFLICT (organization_id, customer_id)
    DO UPDATE SET balance = customer_credits.balance + v_refund_total, updated_at = now();

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (
      v_sale.organization_id, v_sale.customer_id, v_refund_total,
      'Partial return — ' || p_reason, p_sale_id
    );
  END IF;

  FOR v_sl IN SELECT * FROM sale_lines WHERE sale_id = p_sale_id
  LOOP
    IF v_sl.returned_quantity < v_sl.quantity THEN
      v_all_returned := false;
      EXIT;
    END IF;
  END LOOP;

  UPDATE sales
  SET status = CASE WHEN v_all_returned THEN 'returned'::sale_status ELSE 'completed'::sale_status END,
      void_reason = CASE WHEN v_all_returned THEN p_reason ELSE COALESCE(void_reason, p_reason) END
  WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, NULL, 'sale', p_sale_id, 'partial_return',
    jsonb_build_object(
      'return_id', v_return_id,
      'total', v_refund_total,
      'refund_method', p_refund_method,
      'reason', p_reason,
      'pos_staff_id', v_staff.staff_id
    )
  );

  PERFORM public.enqueue_return_ledger_post(v_return_id);

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'refund_total', v_refund_total,
    'refund_method', p_refund_method,
    'fully_returned', v_all_returned
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.partial_return_sale_backoffice(
  p_sale_id UUID,
  p_lines JSONB,
  p_reason TEXT,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_user_id UUID;
  v_line JSONB;
  v_sale_line sale_lines%ROWTYPE;
  v_return_id UUID;
  v_return_qty NUMERIC;
  v_available NUMERIC;
  v_refund_subtotal NUMERIC := 0;
  v_refund_tax NUMERIC := 0;
  v_refund_total NUMERIC := 0;
  v_line_refund NUMERIC;
  v_all_returned BOOLEAN := true;
  v_sl sale_lines%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_refund_method NOT IN ('cash', 'store_credit') THEN
    RAISE EXCEPTION 'Invalid refund method';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF NOT public.user_can_manage(v_sale.organization_id) THEN
    RAISE EXCEPTION 'Only managers can process returns';
  END IF;

  IF v_sale.status NOT IN ('completed', 'returned') THEN
    RAISE EXCEPTION 'Sale cannot be returned';
  END IF;

  IF p_refund_method = 'store_credit' AND v_sale.customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer required for store credit refund';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Select at least one line to return';
  END IF;

  INSERT INTO sale_returns (
    organization_id, original_sale_id, refund_method, reason, pos_staff_id
  ) VALUES (
    v_sale.organization_id, p_sale_id, p_refund_method, p_reason, NULL
  ) RETURNING id INTO v_return_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_return_qty := (v_line->>'quantity')::NUMERIC;
    IF v_return_qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be positive';
    END IF;

    SELECT * INTO v_sale_line
    FROM sale_lines
    WHERE id = (v_line->>'saleLineId')::UUID AND sale_id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale line not found';
    END IF;

    v_available := v_sale_line.quantity - v_sale_line.returned_quantity;
    IF v_return_qty > v_available THEN
      RAISE EXCEPTION 'Return quantity exceeds available for %', v_sale_line.product_name;
    END IF;

    v_line_refund := round(v_sale_line.line_total * (v_return_qty / v_sale_line.quantity), 2);
    v_refund_total := v_refund_total + v_line_refund;

    IF v_sale_line.tax_amount > 0 AND v_sale_line.quantity > 0 THEN
      v_refund_tax := v_refund_tax + round(
        v_sale_line.tax_amount * (v_return_qty / v_sale_line.quantity), 2
      );
    END IF;

    v_refund_subtotal := v_refund_subtotal + (v_line_refund - round(
      v_sale_line.tax_amount * (v_return_qty / v_sale_line.quantity), 2
    ));

    UPDATE sale_lines
    SET returned_quantity = returned_quantity + v_return_qty
    WHERE id = v_sale_line.id;

    UPDATE inventory_levels
    SET quantity = quantity + public._sale_line_return_to_base(v_return_qty, v_sale_line.quantity, v_sale_line.qty_base), updated_at = now()
    WHERE store_id = v_sale.store_id AND variant_id = v_sale_line.variant_id;

    INSERT INTO sale_return_lines (return_id, sale_line_id, variant_id, quantity, line_total)
    VALUES (v_return_id, v_sale_line.id, v_sale_line.variant_id, v_return_qty, v_line_refund);
  END LOOP;

  UPDATE sale_returns
  SET subtotal = v_refund_subtotal, tax_amount = v_refund_tax, total = v_refund_total
  WHERE id = v_return_id;

  IF p_refund_method = 'store_credit' AND v_refund_total > 0 THEN
    INSERT INTO customer_credits (organization_id, customer_id, balance)
    VALUES (v_sale.organization_id, v_sale.customer_id, v_refund_total)
    ON CONFLICT (organization_id, customer_id)
    DO UPDATE SET balance = customer_credits.balance + v_refund_total, updated_at = now();

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (
      v_sale.organization_id, v_sale.customer_id, v_refund_total,
      'Partial return — ' || p_reason, p_sale_id
    );
  END IF;

  FOR v_sl IN SELECT * FROM sale_lines WHERE sale_id = p_sale_id
  LOOP
    IF v_sl.returned_quantity < v_sl.quantity THEN
      v_all_returned := false;
      EXIT;
    END IF;
  END LOOP;

  UPDATE sales
  SET status = CASE WHEN v_all_returned THEN 'returned'::sale_status ELSE 'completed'::sale_status END,
      void_reason = CASE WHEN v_all_returned THEN p_reason ELSE COALESCE(void_reason, p_reason) END
  WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, v_user_id, 'sale', p_sale_id, 'partial_return',
    jsonb_build_object(
      'return_id', v_return_id,
      'total', v_refund_total,
      'refund_method', p_refund_method,
      'reason', p_reason,
      'source', 'backoffice'
    )
  );

  PERFORM public.enqueue_return_ledger_post(v_return_id);

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'refund_total', v_refund_total,
    'refund_method', p_refund_method,
    'fully_returned', v_all_returned
  );
END;
$$;

-- Expose base UOM on inventory page rows for display / adjust conversion.
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
      pv.product_id,
      p.name AS product_name,
      p.sell_price,
      p.reorder_point,
      COALESCE(NULLIF(p.base_uom_code, ''), 'ea') AS base_uom_code
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

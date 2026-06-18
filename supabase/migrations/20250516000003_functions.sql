-- Business logic functions (SECURITY DEFINER where needed)

-- Create organization on signup (called after auth user exists)
CREATE OR REPLACE FUNCTION public.create_organization_with_owner(
  p_name TEXT,
  p_currency TEXT DEFAULT 'ETB',
  p_timezone TEXT DEFAULT 'Africa/Addis_Ababa',
  p_tax_rate NUMERIC DEFAULT 15,
  p_tax_inclusive BOOLEAN DEFAULT false,
  p_store_name TEXT DEFAULT 'Main Store',
  p_register_name TEXT DEFAULT 'Register 1'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_store_id UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO organizations (name, currency, timezone, tax_rate, tax_inclusive)
  VALUES (p_name, p_currency, p_timezone, p_tax_rate, p_tax_inclusive)
  RETURNING id INTO v_org_id;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  INSERT INTO stores (organization_id, name)
  VALUES (v_org_id, p_store_name)
  RETURNING id INTO v_store_id;

  INSERT INTO registers (store_id, organization_id, name)
  VALUES (v_store_id, v_org_id, p_register_name);

  INSERT INTO receipt_sequences (store_id, organization_id, last_number)
  VALUES (v_store_id, v_org_id, 0);

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization_with_owner TO authenticated;

-- Accept staff invite
CREATE OR REPLACE FUNCTION public.accept_staff_invite(p_invite_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite staff_invites%ROWTYPE;
  v_user_id UUID;
  v_email TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invite FROM staff_invites
  WHERE id = p_invite_id AND accepted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found or already accepted';
  END IF;

  IF lower(v_invite.email) <> lower(v_email) THEN
    RAISE EXCEPTION 'Invite email does not match your account';
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role, store_ids)
  VALUES (v_invite.organization_id, v_user_id, v_invite.role, v_invite.store_ids)
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET role = EXCLUDED.role, store_ids = EXCLUDED.store_ids, is_active = true;

  UPDATE staff_invites SET accepted_at = now() WHERE id = p_invite_id;

  RETURN v_invite.organization_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_staff_invite TO authenticated;

-- Next receipt number
CREATE OR REPLACE FUNCTION public.next_receipt_number(p_store_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_num INT;
  v_prefix TEXT;
BEGIN
  IF NOT public.user_has_org_access(
    (SELECT organization_id FROM stores WHERE id = p_store_id)
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE receipt_sequences
  SET last_number = last_number + 1
  WHERE store_id = p_store_id
  RETURNING last_number INTO v_num;

  SELECT o.receipt_prefix INTO v_prefix
  FROM organizations o
  JOIN stores s ON s.organization_id = o.id
  WHERE s.id = p_store_id;

  RETURN v_prefix || '-' || lpad(v_num::TEXT, 6, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_receipt_number TO authenticated;

-- Complete sale (transactional)
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
  p_payments JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_org organizations%ROWTYPE;
  v_receipt_no TEXT;
  v_sale_id UUID;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_line JSONB;
  v_variant_id UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_line_discount NUMERIC;
  v_line_subtotal NUMERIC;
  v_line_tax NUMERIC;
  v_line_total NUMERIC;
  v_tax_rate NUMERIC;
  v_payment_total NUMERIC := 0;
  v_payment JSONB;
  v_existing_sale UUID;
  v_stock NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT id INTO v_existing_sale FROM sales
  WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('sale_id', v_existing_sale, 'duplicate', true);
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;

  -- Validate open session
  IF NOT EXISTS (
    SELECT 1 FROM register_sessions
    WHERE id = p_session_id AND register_id = p_register_id AND closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Register session is not open';
  END IF;

  v_receipt_no := public.next_receipt_number(p_store_id);

  -- Calculate totals and validate stock
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant_id := (v_line->>'variantId')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;
    v_unit_price := (v_line->>'unitPrice')::NUMERIC;
    v_line_discount := COALESCE((v_line->>'discountAmount')::NUMERIC, 0);

    SELECT quantity INTO v_stock FROM inventory_levels
    WHERE store_id = p_store_id AND variant_id = v_variant_id
    FOR UPDATE;

    IF v_stock IS NULL THEN
      v_stock := 0;
    END IF;

    IF v_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for variant %', v_variant_id;
    END IF;

    v_line_subtotal := v_unit_price * v_qty - v_line_discount;
    v_tax_rate := COALESCE(
      (SELECT COALESCE(p.tax_rate, v_org.tax_rate) FROM products p
       JOIN product_variants pv ON pv.product_id = p.id WHERE pv.id = v_variant_id),
      v_org.tax_rate
    );

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

  v_total := v_subtotal + v_tax_total - COALESCE(p_discount_amount, 0);

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_payment_total := v_payment_total + (v_payment->>'amount')::NUMERIC;
  END LOOP;

  IF abs(v_payment_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'Payment total % does not match sale total %', v_payment_total, v_total;
  END IF;

  INSERT INTO sales (
    organization_id, store_id, register_id, session_id, receipt_no,
    subtotal, tax_amount, discount_amount, total,
    customer_name, customer_phone, idempotency_key, created_by
  ) VALUES (
    p_organization_id, p_store_id, p_register_id, p_session_id, v_receipt_no,
    v_subtotal, v_tax_total, COALESCE(p_discount_amount, 0), v_total,
    p_customer_name, p_customer_phone, p_idempotency_key, v_user_id
  ) RETURNING id INTO v_sale_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant_id := (v_line->>'variantId')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;
    v_unit_price := (v_line->>'unitPrice')::NUMERIC;
    v_line_discount := COALESCE((v_line->>'discountAmount')::NUMERIC, 0);
    v_line_subtotal := v_unit_price * v_qty - v_line_discount;
    v_tax_rate := COALESCE(
      (SELECT COALESCE(p.tax_rate, v_org.tax_rate) FROM products p
       JOIN product_variants pv ON pv.product_id = p.id WHERE pv.id = v_variant_id),
      v_org.tax_rate
    );
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

    UPDATE inventory_levels
    SET quantity = quantity - v_qty, updated_at = now()
    WHERE store_id = p_store_id AND variant_id = v_variant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventory record missing';
    END IF;
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    INSERT INTO payments (
      sale_id, organization_id, method, amount, status,
      reference, provider, phone, bank_name, cash_tendered, change_given
    ) VALUES (
      v_sale_id, p_organization_id,
      (v_payment->>'method')::payment_method,
      (v_payment->>'amount')::NUMERIC,
      'completed',
      v_payment->>'reference',
      NULLIF(v_payment->>'provider', '')::mobile_money_provider,
      v_payment->>'phone',
      v_payment->>'bankName',
      (v_payment->>'cashTendered')::NUMERIC,
      (v_payment->>'changeGiven')::NUMERIC
    );
  END LOOP;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (p_organization_id, v_user_id, 'sale', v_sale_id, 'completed',
    jsonb_build_object('receipt_no', v_receipt_no, 'total', v_total));

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'receipt_no', v_receipt_no,
    'total', v_total,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_sale TO authenticated;

-- Void sale
CREATE OR REPLACE FUNCTION public.void_sale(
  p_sale_id UUID,
  p_reason TEXT
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
BEGIN
  v_user_id := auth.uid();
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
    SET quantity = quantity + v_line.quantity, updated_at = now()
    WHERE store_id = v_sale.store_id AND variant_id = v_line.variant_id;
  END LOOP;

  UPDATE sales
  SET status = 'voided', void_reason = p_reason
  WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (v_sale.organization_id, v_user_id, 'sale', p_sale_id, 'voided',
    jsonb_build_object('reason', p_reason));
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale TO authenticated;

-- Adjust inventory
CREATE OR REPLACE FUNCTION public.adjust_inventory(
  p_store_id UUID,
  p_variant_id UUID,
  p_delta NUMERIC,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  SELECT organization_id INTO v_org_id FROM stores WHERE id = p_store_id;

  IF NOT public.user_can_manage(v_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (p_store_id, p_variant_id, v_org_id, GREATEST(0, p_delta))
  ON CONFLICT (store_id, variant_id)
  DO UPDATE SET quantity = inventory_levels.quantity + p_delta, updated_at = now();

  INSERT INTO inventory_adjustments (store_id, variant_id, organization_id, delta, reason, user_id)
  VALUES (p_store_id, p_variant_id, v_org_id, p_delta, p_reason, v_user_id);

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (v_org_id, v_user_id, 'inventory', p_variant_id, 'adjusted',
    jsonb_build_object('store_id', p_store_id, 'delta', p_delta, 'reason', p_reason));
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_inventory TO authenticated;

-- Dashboard stats for today
CREATE OR REPLACE FUNCTION public.dashboard_stats(p_organization_id UUID, p_store_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'sales_total', COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed'), 0),
    'transaction_count', COUNT(*) FILTER (WHERE s.status = 'completed'),
    'cash_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'cash'
        AND s2.created_at >= date_trunc('day', now() AT TIME ZONE (SELECT timezone FROM organizations WHERE id = p_organization_id))
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'mobile_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'mobile_money'
        AND s2.created_at >= date_trunc('day', now())
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'bank_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'bank_transfer'
        AND s2.created_at >= date_trunc('day', now())
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0)
  ) INTO v_result
  FROM sales s
  WHERE s.organization_id = p_organization_id
    AND s.created_at >= date_trunc('day', now())
    AND (p_store_id IS NULL OR s.store_id = p_store_id);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_stats TO authenticated;

-- Create product with default variant and optional initial stock
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
  p_initial_qty NUMERIC DEFAULT 0
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
  IF NOT public.user_can_manage(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price, tax_rate)
  VALUES (p_organization_id, p_category_id, p_name, p_sku, p_barcode, p_sell_price, p_cost_price, p_tax_rate)
  RETURNING id INTO v_product_id;

  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, p_organization_id, 'Default', p_sku, p_barcode, p_sell_price, p_cost_price)
  RETURNING id INTO v_variant_id;

  IF p_store_id IS NOT NULL AND p_initial_qty > 0 THEN
    INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
    VALUES (p_store_id, v_variant_id, p_organization_id, p_initial_qty)
    ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;
  ELSIF p_store_id IS NOT NULL THEN
    INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
    VALUES (p_store_id, v_variant_id, p_organization_id, 0)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('product_id', v_product_id, 'variant_id', v_variant_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_variant TO authenticated;

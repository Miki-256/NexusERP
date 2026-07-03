-- POS Phase B: promotion codes at checkout, partial returns, refund-as-store-credit.

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL;

ALTER TABLE sale_lines
  ADD COLUMN IF NOT EXISTS returned_quantity NUMERIC NOT NULL DEFAULT 0
  CHECK (returned_quantity >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_org_code
  ON promotions (organization_id, lower(code))
  WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS sale_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  original_sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT 'cash' CHECK (refund_method IN ('cash', 'store_credit')),
  reason TEXT NOT NULL,
  pos_staff_id UUID REFERENCES pos_staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_line_id UUID NOT NULL REFERENCES sale_lines(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  line_total NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sale_returns_org ON sale_returns(organization_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON sale_returns(original_sale_id);

ALTER TABLE sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_return_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_returns_select ON sale_returns;
CREATE POLICY sale_returns_select ON sale_returns FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS sale_return_lines_select ON sale_return_lines;
CREATE POLICY sale_return_lines_select ON sale_return_lines FOR SELECT
  USING (
    return_id IN (
      SELECT id FROM sale_returns
      WHERE organization_id IN (SELECT public.user_organization_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Promotion helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._pos_promotion_discount(
  p_promotion promotions,
  p_merch_subtotal NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_discount NUMERIC := 0;
BEGIN
  IF p_merch_subtotal <= 0 THEN
    RETURN 0;
  END IF;

  IF p_promotion.discount_type = 'percent' THEN
    v_discount := round(p_merch_subtotal * (p_promotion.discount_value / 100), 2);
  ELSE
    v_discount := p_promotion.discount_value;
  END IF;

  RETURN LEAST(GREATEST(v_discount, 0), p_merch_subtotal);
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_promotion_code(
  p_organization_id UUID,
  p_code TEXT,
  p_merch_subtotal NUMERIC,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo promotions%ROWTYPE;
  v_discount NUMERIC;
  v_org UUID;
BEGIN
  IF p_code IS NULL OR trim(p_code) = '' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Enter a promotion code');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT public.user_has_org_access(p_organization_id) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSIF p_session_token IS NOT NULL THEN
    SELECT organization_id INTO v_org
    FROM public.validate_pos_staff_session(p_session_token);
    IF NOT FOUND OR v_org <> p_organization_id THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_promo
  FROM promotions
  WHERE organization_id = p_organization_id
    AND code IS NOT NULL
    AND lower(code) = lower(trim(p_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Invalid promotion code');
  END IF;

  IF NOT v_promo.is_active THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Promotion is inactive');
  END IF;

  IF v_promo.starts_at IS NOT NULL AND v_promo.starts_at > now() THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Promotion has not started yet');
  END IF;

  IF v_promo.ends_at IS NOT NULL AND v_promo.ends_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Promotion has expired');
  END IF;

  IF p_merch_subtotal < COALESCE(v_promo.min_order_total, 0) THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message',
      format('Minimum order %s required', COALESCE(v_promo.min_order_total, 0))
    );
  END IF;

  v_discount := public._pos_promotion_discount(v_promo, p_merch_subtotal);

  RETURN jsonb_build_object(
    'valid', true,
    'promotion_id', v_promo.id,
    'name', v_promo.name,
    'code', v_promo.code,
    'discount_amount', v_discount,
    'discount_type', v_promo.discount_type,
    'discount_value', v_promo.discount_value
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_promotion_code(UUID, TEXT, NUMERIC, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- complete_sale with optional promotion code
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT, UUID
);

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
  p_promotion_code TEXT DEFAULT NULL
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
  v_merch_subtotal NUMERIC := 0;
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
  v_manual_discount NUMERIC := COALESCE(p_discount_amount, 0);
  v_promo_result JSONB;
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

  SELECT id INTO v_existing_sale FROM sales
  WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('sale_id', v_existing_sale, 'duplicate', true);
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;

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

  v_receipt_no := public.next_receipt_number(p_store_id);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant_id := (v_line->>'variantId')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;
    v_unit_price := (v_line->>'unitPrice')::NUMERIC;
    v_line_discount := COALESCE((v_line->>'discountAmount')::NUMERIC, 0);

    SELECT quantity INTO v_stock FROM inventory_levels
    WHERE store_id = p_store_id AND variant_id = v_variant_id
    FOR UPDATE;

    IF v_stock IS NULL THEN v_stock := 0; END IF;
    IF v_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for variant %', v_variant_id;
    END IF;

    v_line_subtotal := v_unit_price * v_qty - v_line_discount;
    v_merch_subtotal := v_merch_subtotal + v_line_subtotal;

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

  IF p_promotion_code IS NOT NULL AND trim(p_promotion_code) <> '' THEN
    v_promo_result := public.validate_promotion_code(
      p_organization_id, p_promotion_code, v_merch_subtotal, p_pos_session_token
    );
    IF NOT COALESCE((v_promo_result->>'valid')::BOOLEAN, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_promo_result->>'message', 'Invalid promotion');
    END IF;
    SELECT * INTO v_promo FROM promotions WHERE id = (v_promo_result->>'promotion_id')::UUID;
    v_promo_discount := (v_promo_result->>'discount_amount')::NUMERIC;
  END IF;

  v_total := v_subtotal + v_tax_total - v_manual_discount - v_promo_discount;
  IF v_total < 0 THEN v_total := 0; END IF;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_payment_total := v_payment_total + (v_payment->>'amount')::NUMERIC;
    IF v_payment->>'method' = 'store_credit' THEN
      v_credit_total := v_credit_total + (v_payment->>'amount')::NUMERIC;
    ELSIF v_payment->>'method' = 'on_account' THEN
      v_on_account_total := v_on_account_total + (v_payment->>'amount')::NUMERIC;
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

  INSERT INTO sales (
    organization_id, store_id, register_id, session_id, receipt_no,
    subtotal, tax_amount, discount_amount, total,
    customer_id, customer_name, customer_phone,
    idempotency_key, created_by, pos_staff_id, promotion_id
  ) VALUES (
    p_organization_id, p_store_id, p_register_id, p_session_id, v_receipt_no,
    v_subtotal, v_tax_total, v_manual_discount + v_promo_discount, v_total,
    p_customer_id,
    COALESCE(p_customer_name, v_cust_name),
    COALESCE(p_customer_phone, v_cust_phone),
    p_idempotency_key, v_user_id, v_staff_id,
    CASE WHEN v_promo.id IS NOT NULL THEN v_promo.id ELSE NULL END
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

    IF NOT FOUND THEN RAISE EXCEPTION 'Inventory record missing'; END IF;
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

  IF v_staff_id IS NOT NULL THEN
    UPDATE register_sessions SET active_staff_id = v_staff_id WHERE id = p_session_id;
  END IF;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
    VALUES (
      p_organization_id, v_user_id, 'sale', v_sale_id, 'completed',
      jsonb_build_object(
        'receipt_no', v_receipt_no, 'total', v_total, 'pos_staff_id', v_staff_id,
        'promotion_code', NULLIF(trim(p_promotion_code), '')
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'receipt_no', v_receipt_no,
    'total', v_total,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT
) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- void_sale_pos with optional refund-as-store-credit
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.void_sale_pos(UUID, TEXT, TEXT);

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
    SET quantity = quantity + (v_line.quantity - v_line.returned_quantity), updated_at = now()
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale_pos(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Partial return sale
-- ---------------------------------------------------------------------------

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
    SET quantity = quantity + v_return_qty, updated_at = now()
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

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'refund_total', v_refund_total,
    'refund_method', p_refund_method,
    'fully_returned', v_all_returned
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.partial_return_sale(UUID, JSONB, TEXT, TEXT, TEXT) TO anon, authenticated;

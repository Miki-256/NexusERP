-- Phase A security hardening: RLS lockdown, cashier discount enforcement, back-office void

-- ---------------------------------------------------------------------------
-- 1. payments — read-only for org members; writes via SECURITY DEFINER RPCs
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS payments_all ON payments;

CREATE POLICY payments_select ON payments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

-- ---------------------------------------------------------------------------
-- 2. payment_webhook_queue — deny client access
-- ---------------------------------------------------------------------------
ALTER TABLE payment_webhook_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_webhook_queue_deny ON payment_webhook_queue;
CREATE POLICY payment_webhook_queue_deny ON payment_webhook_queue
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 3. inventory — read for members; writes for managers only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS inventory_manage ON inventory_levels;
DROP POLICY IF EXISTS adjustments_all ON inventory_adjustments;

CREATE POLICY inventory_insert ON inventory_levels FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY inventory_update ON inventory_levels FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY inventory_delete ON inventory_levels FOR DELETE
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY adjustments_select ON inventory_adjustments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY adjustments_insert ON inventory_adjustments FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

-- ---------------------------------------------------------------------------
-- 4. registers / register_sessions — manager-only writes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS registers_all ON registers;
DROP POLICY IF EXISTS sessions_all ON register_sessions;

CREATE POLICY registers_select ON registers FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY registers_insert ON registers FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY registers_update ON registers FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY registers_delete ON registers FOR DELETE
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY sessions_select ON register_sessions FOR SELECT
  USING (
    register_id IN (
      SELECT id FROM registers
      WHERE organization_id IN (SELECT public.user_organization_ids())
    )
  );

CREATE POLICY sessions_insert ON register_sessions FOR INSERT
  WITH CHECK (
    register_id IN (
      SELECT id FROM registers
      WHERE organization_id IN (SELECT public.user_organization_ids())
        AND public.user_can_manage(organization_id)
    )
  );

CREATE POLICY sessions_update ON register_sessions FOR UPDATE
  USING (
    register_id IN (
      SELECT id FROM registers
      WHERE organization_id IN (SELECT public.user_organization_ids())
        AND public.user_can_manage(organization_id)
    )
  )
  WITH CHECK (
    register_id IN (
      SELECT id FROM registers
      WHERE organization_id IN (SELECT public.user_organization_ids())
        AND public.user_can_manage(organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Cashier discount limit enforcement helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enforce_cashier_discount_limit(
  p_organization_id UUID,
  p_register_id UUID,
  p_gross_merchandise NUMERIC,
  p_total_discount NUMERIC,
  p_pos_session_token TEXT,
  p_manager_discount_pin TEXT,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_max_pct NUMERIC;
  v_discount_pct NUMERIC;
  v_staff RECORD;
  v_pin_ok JSONB;
BEGIN
  IF p_gross_merchandise <= 0 OR p_total_discount <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(pos_max_cashier_discount_pct, 15) INTO v_max_pct
  FROM organizations WHERE id = p_organization_id;

  v_discount_pct := round((p_total_discount / p_gross_merchandise) * 100, 2);

  IF v_discount_pct <= v_max_pct + 0.01 THEN
    RETURN;
  END IF;

  IF p_user_id IS NOT NULL AND public.user_can_manage(p_organization_id) THEN
    RETURN;
  END IF;

  IF p_pos_session_token IS NOT NULL THEN
    SELECT * INTO v_staff FROM public.validate_pos_staff_session(p_pos_session_token);
    IF FOUND AND v_staff.organization_id = p_organization_id AND v_staff.role = 'manager' THEN
      RETURN;
    END IF;
  END IF;

  IF p_manager_discount_pin IS NOT NULL AND length(trim(p_manager_discount_pin)) >= 4 THEN
    v_pin_ok := public.verify_pos_manager_pin(p_register_id, p_manager_discount_pin);
    IF COALESCE((v_pin_ok->>'approved')::BOOLEAN, false) THEN
      RETURN;
    END IF;
  END IF;

  RAISE EXCEPTION 'Discount %.2f%% exceeds cashier limit of %.2f%%. Manager approval required.',
    v_discount_pct, v_max_pct;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. complete_sale — manager PIN param + server-side cashier discount limit
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, NUMERIC
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

  v_receipt_no := public.next_receipt_number(p_store_id);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant_id := (v_line->>'variantId')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;
    v_unit_price := (v_line->>'unitPrice')::NUMERIC;
    v_line_discount := COALESCE((v_line->>'discountAmount')::NUMERIC, 0);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity for variant %', v_variant_id;
    END IF;

    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid unit price for variant %', v_variant_id;
    END IF;

    IF v_line_discount < 0 THEN
      RAISE EXCEPTION 'Line discount cannot be negative';
    END IF;

    v_line_gross := round(v_unit_price * v_qty, 2);
    IF v_line_discount > v_line_gross + 0.01 THEN
      RAISE EXCEPTION 'Line discount exceeds line total for variant %', v_variant_id;
    END IF;

    SELECT quantity INTO v_stock FROM inventory_levels
    WHERE store_id = p_store_id AND variant_id = v_variant_id
    FOR UPDATE;

    IF v_stock IS NULL THEN v_stock := 0; END IF;
    IF v_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for variant %', v_variant_id;
    END IF;

    v_line_subtotal := v_line_gross - v_line_discount;
    IF v_line_subtotal < -0.01 THEN
      RAISE EXCEPTION 'Invalid line subtotal for variant %', v_variant_id;
    END IF;

    v_gross_merch := v_gross_merch + v_line_gross;
    v_line_discounts_total := v_line_discounts_total + v_line_discount;
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

  PERFORM public.maybe_auto_post_sale(v_sale_id);

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'receipt_no', v_receipt_no,
    'total', v_total,
    'tip_amount', v_tip,
    'duplicate', false,
    'payments_pending', v_has_pending_payments
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, NUMERIC, TEXT
) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. Back-office void — full reversal (credits, receivables, partial returns)
-- ---------------------------------------------------------------------------
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
    v_sale.organization_id, v_user_id, 'sale', p_sale_id, 'voided',
    jsonb_build_object('reason', p_reason, 'refund_method', p_refund_method, 'source', 'backoffice')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale_backoffice(UUID, TEXT, TEXT) TO authenticated;

-- Legacy wrapper — keep signature for any old callers
CREATE OR REPLACE FUNCTION public.void_sale(
  p_sale_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.void_sale_backoffice(p_sale_id, p_reason, 'cash');
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale(UUID, TEXT) TO authenticated;

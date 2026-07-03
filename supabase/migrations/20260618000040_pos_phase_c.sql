-- POS Phase C: ledger auto-post, webhook payment status, shift export RPCs.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS pos_auto_post_sales BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pos_mobile_pending_webhook BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- Ledger posting (internal — no auth check, for RPC chains)
-- ---------------------------------------------------------------------------

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
  v_net_revenue NUMERIC;
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

  v_net_revenue := v_sale.subtotal - v_sale.discount_amount;

  SELECT COALESCE(SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
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
      'accountId', CASE v_pay.method
        WHEN 'cash' THEN public.account_id_by_code(v_sale.organization_id, '1000')
        WHEN 'bank_transfer' THEN public.account_id_by_code(v_sale.organization_id, '1010')
        WHEN 'mobile_money' THEN public.account_id_by_code(v_sale.organization_id, '1020')
        WHEN 'store_credit' THEN public.account_id_by_code(v_sale.organization_id, '1000')
        WHEN 'on_account' THEN public.account_id_by_code(v_sale.organization_id, '1100')
        ELSE public.account_id_by_code(v_sale.organization_id, '1000')
      END,
      'debit', v_pay.amt, 'credit', 0, 'description', 'Receipt ' || v_sale.receipt_no));
  END LOOP;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'accountId', public.account_id_by_code(v_sale.organization_id, '4000'),
    'debit', 0, 'credit', v_net_revenue, 'description', 'Sales revenue'));

  IF v_sale.tax_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '2100'),
      'debit', 0, 'credit', v_sale.tax_amount, 'description', 'Tax collected'));
  END IF;

  IF v_cogs > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '5000'),
        'debit', v_cogs, 'credit', 0, 'description', 'COGS'),
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '1200'),
        'debit', 0, 'credit', v_cogs, 'description', 'Inventory relief'));
  END IF;

  v_entry_id := public.post_journal_entry(
    v_sale.organization_id, 'SAL', v_sale.created_at::date,
    'Sale ' || v_sale.receipt_no, 'sale', p_sale_id, v_lines
  );
  RETURN v_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.maybe_auto_post_sale(p_sale_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_org organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_sale.organization_id;
  IF NOT COALESCE(v_org.pos_auto_post_sales, false) THEN
    RETURN NULL;
  END IF;

  RETURN public.post_sale_to_ledger_internal(p_sale_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_sale_to_ledger(p_sale_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  IF NOT public.user_has_org_access(v_sale.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  RETURN public.post_sale_to_ledger_internal(p_sale_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_sale_to_ledger_internal(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.maybe_auto_post_sale(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_to_ledger(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public._pos_resolve_payment_status(
  p_method TEXT,
  p_reference TEXT,
  p_org organizations
)
RETURNS payment_status
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_method = 'mobile_money'
     AND COALESCE(p_org.pos_mobile_pending_webhook, true)
     AND NULLIF(trim(COALESCE(p_reference, '')), '') IS NOT NULL THEN
    RETURN 'pending'::payment_status;
  END IF;
  RETURN 'completed'::payment_status;
END;
$$;

-- Webhook confirmation completes payment and may trigger ledger post
CREATE OR REPLACE FUNCTION public.confirm_payment_webhook(
  p_organization_id UUID,
  p_reference TEXT,
  p_provider TEXT,
  p_amount NUMERIC DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
BEGIN
  SELECT p.* INTO v_payment
  FROM payments p
  WHERE p.organization_id = p_organization_id
    AND p.reference = p_reference
    AND p.method = 'mobile_money'
  ORDER BY p.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'Payment reference not found');
  END IF;

  IF p_amount IS NOT NULL AND abs(v_payment.amount - p_amount) > 0.02 THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'Amount mismatch',
      'expected', v_payment.amount,
      'received', p_amount
    );
  END IF;

  UPDATE payments
  SET webhook_confirmed_at = now(),
      status = 'completed',
      external_id = COALESCE(p_external_id, external_id),
      provider = COALESCE(NULLIF(p_provider, '')::mobile_money_provider, provider)
  WHERE id = v_payment.id;

  PERFORM public.maybe_auto_post_sale(v_payment.sale_id);

  RETURN jsonb_build_object(
    'matched', true,
    'payment_id', v_payment.id,
    'sale_id', v_payment.sale_id,
    'amount', v_payment.amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_webhook TO service_role;

-- Patch complete_sale: pending mobile payments + auto ledger post
DROP FUNCTION IF EXISTS public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT
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
    v_pay_status := public._pos_resolve_payment_status(
      v_payment->>'method', v_payment->>'reference', v_org
    );
    IF v_pay_status = 'pending' THEN
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
        'receipt_no', v_receipt_no, 'total', v_total, 'pos_staff_id', v_staff_id,
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
    'duplicate', false,
    'payments_pending', v_has_pending_payments
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT
) TO anon, authenticated;

-- Shift export data for CSV download
CREATE OR REPLACE FUNCTION public.get_pos_shift_export(
  p_session_id UUID,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess register_sessions%ROWTYPE;
  v_reg registers%ROWTYPE;
  v_store stores%ROWTYPE;
BEGIN
  SELECT * INTO v_sess FROM register_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT public.user_has_org_access(v_sess.organization_id) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSIF p_session_token IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.validate_pos_staff_session(p_session_token) s
      WHERE s.organization_id = v_sess.organization_id
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_reg FROM registers WHERE id = v_sess.register_id;
  SELECT * INTO v_store FROM stores WHERE id = v_reg.store_id;

  RETURN jsonb_build_object(
    'registerName', v_reg.name,
    'storeName', v_store.name,
    'openedAt', v_sess.opened_at,
    'closedAt', v_sess.closed_at,
    'openingFloat', v_sess.opening_float,
    'rows', COALESCE((
      SELECT jsonb_agg(row ORDER BY row->>'createdAt')
      FROM (
        SELECT jsonb_build_object(
          'receiptNo', s.receipt_no,
          'createdAt', s.created_at,
          'status', s.status,
          'customerName', s.customer_name,
          'productName', sl.product_name,
          'variantName', sl.variant_name,
          'quantity', sl.quantity,
          'unitPrice', sl.unit_price,
          'lineTotal', sl.line_total,
          'saleTotal', s.total,
          'paymentMethods', (
            SELECT string_agg(DISTINCT p.method::text, ', ' ORDER BY p.method::text)
            FROM payments p WHERE p.sale_id = s.id
          )
        ) AS row,
        s.created_at
        FROM sales s
        JOIN sale_lines sl ON sl.sale_id = s.id
        WHERE s.session_id = p_session_id
        ORDER BY s.created_at, sl.id
      ) sub
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_shift_export(UUID, TEXT) TO anon, authenticated;

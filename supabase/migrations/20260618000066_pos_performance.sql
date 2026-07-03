-- POS performance: single bootstrap RPC, async ledger posting, hot-path indexes.

-- ---------------------------------------------------------------------------
-- Ledger post queue — do not block checkout on GL writes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_ledger_post_queue (
  sale_id UUID PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sale_ledger_post_queue_org_time
  ON sale_ledger_post_queue(organization_id, enqueued_at);

ALTER TABLE sale_ledger_post_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_ledger_post_queue_select ON sale_ledger_post_queue;
CREATE POLICY sale_ledger_post_queue_select ON sale_ledger_post_queue FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE OR REPLACE FUNCTION public.enqueue_sale_ledger_post(p_sale_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND OR v_sale.status <> 'completed' THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM payments WHERE sale_id = p_sale_id AND status = 'pending') THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = v_sale.organization_id
      AND source_type = 'sale' AND source_id = p_sale_id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO sale_ledger_post_queue (sale_id, organization_id)
  VALUES (p_sale_id, v_sale.organization_id)
  ON CONFLICT (sale_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_sale_ledger_post_queue(p_limit INT DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_posted INT := 0;
  v_failed INT := 0;
  v_limit INT := GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
BEGIN
  FOR v_row IN
    SELECT q.sale_id
    FROM sale_ledger_post_queue q
    ORDER BY q.enqueued_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.post_sale_to_ledger_internal(v_row.sale_id);
      DELETE FROM sale_ledger_post_queue WHERE sale_id = v_row.sale_id;
      v_posted := v_posted + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE sale_ledger_post_queue
      SET attempts = attempts + 1, last_error = SQLERRM
      WHERE sale_id = v_row.sale_id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'posted', v_posted,
    'failed', v_failed,
    'pending', (SELECT COUNT(*)::INT FROM sale_ledger_post_queue)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_sale_ledger_post_queue(INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap RPC — one round trip for POS load
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pos_bootstrap(p_register_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg registers%ROWTYPE;
  v_store stores%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_staff JSONB;
  v_catalog JSONB;
  v_session JSONB;
BEGIN
  SELECT * INTO v_reg FROM registers WHERE id = p_register_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  SELECT * INTO v_store FROM stores WHERE id = v_reg.store_id AND is_active = true;
  SELECT * INTO v_org FROM organizations WHERE id = v_reg.organization_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', id, 'display_name', display_name, 'role', role)
    ORDER BY display_name
  ), '[]'::jsonb)
  INTO v_staff
  FROM pos_staff
  WHERE organization_id = v_reg.organization_id
    AND is_active = true
    AND (store_ids IS NULL OR v_reg.store_id = ANY(store_ids));

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'name'), '[]'::jsonb)
  INTO v_catalog
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
      'categoryName', c.name
    ) AS row,
    p.name
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN inventory_levels il ON il.variant_id = pv.id AND il.store_id = v_reg.store_id
    WHERE p.organization_id = v_reg.organization_id AND p.is_active = true
  ) sub;

  SELECT to_jsonb(rs.*)
  INTO v_session
  FROM register_sessions rs
  WHERE rs.register_id = p_register_id AND rs.closed_at IS NULL
  ORDER BY rs.opened_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'register_id', v_reg.id,
    'register_name', v_reg.name,
    'store_id', v_store.id,
    'store_name', v_store.name,
    'organization_id', v_org.id,
    'org_name', v_org.name,
    'currency', v_org.currency,
    'tax_rate', v_org.tax_rate,
    'tax_inclusive', v_org.tax_inclusive,
    'receipt_footer', v_org.receipt_footer,
    'pos_max_cashier_discount_pct', COALESCE(v_org.pos_max_cashier_discount_pct, 15),
    'pos_tips_enabled', COALESCE(v_org.pos_tips_enabled, false),
    'pos_tip_presets', COALESCE(v_org.pos_tip_presets, '[10,15,20]'::jsonb),
    'staff', v_staff,
    'catalog', v_catalog,
    'open_session', v_session
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_bootstrap(UUID) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- complete_sale — queue ledger post instead of blocking checkout
-- ---------------------------------------------------------------------------
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
  v_tax_rates JSONB := '{}'::jsonb;
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
    'payments_pending', v_has_pending_payments
  );
END;
$$;

-- When mobile-money payment confirms, queue ledger post (was synchronous maybe_auto_post_sale)
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

  PERFORM public.enqueue_sale_ledger_post(p_sale_id);
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Hot-path indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_org_active
  ON products(organization_id, name)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_variants_org_active
  ON product_variants(organization_id, product_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_register_sessions_open
  ON register_sessions(register_id, opened_at DESC)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_idempotency
  ON sales(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_session_completed
  ON sales(session_id, created_at DESC)
  WHERE status = 'completed';

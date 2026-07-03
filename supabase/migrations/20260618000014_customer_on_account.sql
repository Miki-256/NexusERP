-- Buy now, pay later (on-account) for POS customers

DO $$ BEGIN
  ALTER TYPE payment_method ADD VALUE 'on_account';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS on_account_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(14,2) CHECK (credit_limit IS NULL OR credit_limit >= 0);

CREATE TABLE IF NOT EXISTS customer_receivables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, customer_id)
);

CREATE TABLE IF NOT EXISTS receivable_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT,
  sale_id UUID REFERENCES sales(id),
  payment_method payment_method,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recv_tx_org ON receivable_transactions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recv_tx_customer ON receivable_transactions(customer_id, created_at DESC);

ALTER TABLE customer_receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivable_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY recv_select ON customer_receivables FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY recv_write ON customer_receivables FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY recv_tx_select ON receivable_transactions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY recv_tx_write ON receivable_transactions FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- POS customer search: include pay-later fields
CREATE OR REPLACE FUNCTION public.get_pos_customers(
  p_register_id UUID,
  p_query TEXT DEFAULT '',
  p_session_token TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_q TEXT := trim(COALESCE(p_query, ''));
BEGIN
  SELECT organization_id INTO v_org FROM registers WHERE id = p_register_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT public.user_has_org_access(v_org) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSIF p_session_token IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.validate_pos_staff_session(p_session_token) s
      WHERE s.organization_id = v_org
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY row->>'name')
    FROM (
      SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'phone', c.phone,
        'email', c.email,
        'creditBalance', COALESCE(cc.balance, 0),
        'receivableBalance', COALESCE(cr.balance, 0),
        'creditLimit', c.credit_limit,
        'onAccountEnabled', c.on_account_enabled,
        'creditAvailable', CASE
          WHEN NOT c.on_account_enabled THEN 0
          WHEN c.credit_limit IS NULL THEN NULL
          ELSE GREATEST(c.credit_limit - COALESCE(cr.balance, 0), 0)
        END
      ) AS row,
      c.name
      FROM customers c
      LEFT JOIN customer_credits cc
        ON cc.customer_id = c.id AND cc.organization_id = c.organization_id
      LEFT JOIN customer_receivables cr
        ON cr.customer_id = c.id AND cr.organization_id = c.organization_id
      WHERE c.organization_id = v_org
        AND (
          v_q = ''
          OR c.name ILIKE '%' || v_q || '%'
          OR c.phone ILIKE '%' || v_q || '%'
          OR COALESCE(c.email, '') ILIKE '%' || v_q || '%'
        )
      ORDER BY c.name
      LIMIT GREATEST(1, LEAST(p_limit, 50))
    ) sub
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_customers TO anon, authenticated;

-- Collect payment against customer balance
CREATE OR REPLACE FUNCTION public.collect_customer_receivable(
  p_org_id UUID,
  p_customer_id UUID,
  p_amount NUMERIC,
  p_payment_method payment_method,
  p_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_tx_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_payment_method = 'on_account' OR p_payment_method = 'store_credit' THEN
    RAISE EXCEPTION 'Invalid collection method';
  END IF;

  SELECT balance INTO v_balance
  FROM customer_receivables
  WHERE organization_id = p_org_id AND customer_id = p_customer_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance owed';
  END IF;

  INSERT INTO receivable_transactions (
    organization_id, customer_id, amount, reason, payment_method, created_by
  ) VALUES (
    p_org_id, p_customer_id, -p_amount,
    COALESCE(NULLIF(trim(p_reference), ''), 'Payment collected'),
    p_payment_method, auth.uid()
  ) RETURNING id INTO v_tx_id;

  UPDATE customer_receivables
  SET balance = balance - p_amount, updated_at = now()
  WHERE organization_id = p_org_id AND customer_id = p_customer_id;

  RETURN v_tx_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.collect_customer_receivable TO authenticated;

-- Enable pay-later terms for a customer
CREATE OR REPLACE FUNCTION public.update_customer_account_terms(
  p_org_id UUID,
  p_customer_id UUID,
  p_on_account_enabled BOOLEAN,
  p_credit_limit NUMERIC DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_credit_limit IS NOT NULL AND p_credit_limit < 0 THEN
    RAISE EXCEPTION 'Credit limit cannot be negative';
  END IF;

  UPDATE customers
  SET
    on_account_enabled = p_on_account_enabled,
    credit_limit = p_credit_limit,
    updated_at = now()
  WHERE id = p_customer_id AND organization_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_customer_account_terms TO authenticated;

-- Void sale: restore on-account balance
CREATE OR REPLACE FUNCTION public.void_sale_pos(
  p_sale_id UUID,
  p_reason TEXT,
  p_session_token TEXT
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
BEGIN
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
    SET quantity = quantity + v_line.quantity, updated_at = now()
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

  UPDATE sales SET status = 'voided', void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, NULL, 'sale', p_sale_id, 'voided',
    jsonb_build_object('reason', p_reason, 'pos_staff_id', v_staff.staff_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale_pos TO anon, authenticated;

-- complete_sale with on-account support
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
  p_customer_id UUID DEFAULT NULL
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
    idempotency_key, created_by, pos_staff_id
  ) VALUES (
    p_organization_id, p_store_id, p_register_id, p_session_id, v_receipt_no,
    v_subtotal, v_tax_total, COALESCE(p_discount_amount, 0), v_total,
    p_customer_id,
    COALESCE(p_customer_name, v_cust_name),
    COALESCE(p_customer_phone, v_cust_phone),
    p_idempotency_key, v_user_id, v_staff_id
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
      jsonb_build_object('receipt_no', v_receipt_no, 'total', v_total, 'pos_staff_id', v_staff_id)
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
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT, UUID
) TO anon, authenticated;

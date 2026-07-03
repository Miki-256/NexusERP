-- POS Tier 1: customer lookup, store credit, shift Z-report, void from register

ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);

ALTER TABLE register_sessions DROP CONSTRAINT IF EXISTS session_open_or_closed;
ALTER TABLE register_sessions ADD CONSTRAINT session_open_or_closed CHECK (
  (closed_at IS NULL AND closed_by IS NULL AND closed_by_staff_id IS NULL) OR
  (closed_at IS NOT NULL AND (closed_by IS NOT NULL OR closed_by_staff_id IS NOT NULL))
);

DO $$ BEGIN
  ALTER TYPE payment_method ADD VALUE 'store_credit';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Search customers from POS terminal
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
        'creditBalance', COALESCE(cc.balance, 0)
      ) AS row,
      c.name
      FROM customers c
      LEFT JOIN customer_credits cc
        ON cc.customer_id = c.id AND cc.organization_id = c.organization_id
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

-- Shift summary (Z-report data)
CREATE OR REPLACE FUNCTION public.get_pos_shift_summary(
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
  v_staff_name TEXT;
  v_sale_count INT;
  v_void_count INT;
  v_gross_total NUMERIC;
  v_payments JSONB;
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

  IF v_sess.active_staff_id IS NOT NULL THEN
    SELECT display_name INTO v_staff_name FROM pos_staff WHERE id = v_sess.active_staff_id;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'voided'),
    COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0)
  INTO v_sale_count, v_void_count, v_gross_total
  FROM sales WHERE session_id = p_session_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('method', method, 'total', total) ORDER BY method
  ), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT p.method::text AS method, SUM(p.amount) AS total
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    WHERE s.session_id = p_session_id AND s.status = 'completed'
    GROUP BY p.method
  ) agg;

  RETURN jsonb_build_object(
    'sessionId', v_sess.id,
    'registerId', v_sess.register_id,
    'openedAt', v_sess.opened_at,
    'closedAt', v_sess.closed_at,
    'openingFloat', v_sess.opening_float,
    'activeStaffName', v_staff_name,
    'saleCount', v_sale_count,
    'voidCount', v_void_count,
    'grossTotal', v_gross_total,
    'paymentBreakdown', v_payments,
    'expectedCash',
      v_sess.opening_float + COALESCE((
        SELECT SUM(p.amount)
        FROM payments p
        JOIN sales s ON s.id = p.sale_id
        WHERE s.session_id = p_session_id AND s.status = 'completed' AND p.method = 'cash'
      ), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_shift_summary TO anon, authenticated;

-- Close shift (authenticated manager)
CREATE OR REPLACE FUNCTION public.close_register_session_manager(
  p_session_id UUID,
  p_closing_cash NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess register_sessions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_sess FROM register_sessions WHERE id = p_session_id AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found or already closed';
  END IF;

  IF NOT public.user_has_org_access(v_sess.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE register_sessions
  SET closed_at = now(),
      closed_by = auth.uid(),
      closing_cash_counted = COALESCE(p_closing_cash, 0),
      active_staff_id = NULL
  WHERE id = p_session_id;

  RETURN public.get_pos_shift_summary(p_session_id, NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_register_session_manager TO authenticated;

-- Sales on current shift (for void/refund UI)
CREATE OR REPLACE FUNCTION public.get_pos_session_sales(
  p_session_id UUID,
  p_session_token TEXT DEFAULT NULL,
  p_limit INT DEFAULT 40
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM register_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
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
    SELECT jsonb_agg(row ORDER BY row->>'createdAt' DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', s.id,
        'receiptNo', s.receipt_no,
        'total', s.total,
        'status', s.status,
        'customerName', s.customer_name,
        'createdAt', s.created_at
      ) AS row,
      s.created_at
      FROM sales s
      WHERE s.session_id = p_session_id
      ORDER BY s.created_at DESC
      LIMIT GREATEST(1, LEAST(p_limit, 100))
    ) sub
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_session_sales TO anon, authenticated;

-- Void sale from POS (manager staff)
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

  UPDATE sales SET status = 'voided', void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, NULL, 'sale', p_sale_id, 'voided',
    jsonb_build_object('reason', p_reason, 'pos_staff_id', v_staff.staff_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale_pos TO anon, authenticated;

-- complete_sale with customer_id + store credit
DROP FUNCTION IF EXISTS public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT
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
    SELECT name, phone INTO v_cust_name, v_cust_phone
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
    END IF;
  END LOOP;

  IF abs(v_payment_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'Payment total % does not match sale total %', v_payment_total, v_total;
  END IF;

  IF v_credit_total > 0 AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer required for store credit payment';
  END IF;

  IF v_credit_total > 0 THEN
    SELECT balance INTO v_credit_balance FROM customer_credits
    WHERE organization_id = p_organization_id AND customer_id = p_customer_id
    FOR UPDATE;
    IF v_credit_balance IS NULL OR v_credit_balance < v_credit_total THEN
      RAISE EXCEPTION 'Insufficient store credit';
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

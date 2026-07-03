-- POS staff: name + PIN login on register (no email account for cashiers)

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Floor staff profiles (no auth.users row required)
CREATE TABLE pos_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role member_role NOT NULL DEFAULT 'cashier',
  store_ids UUID[] DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  failed_pin_attempts INT NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pos_staff_name_org UNIQUE (organization_id, display_name),
  CONSTRAINT pos_staff_role_check CHECK (role IN ('cashier', 'manager'))
);

CREATE INDEX idx_pos_staff_org ON pos_staff(organization_id) WHERE is_active = true;

-- Short-lived session after PIN verify (register device)
CREATE TABLE pos_staff_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  staff_id UUID NOT NULL REFERENCES pos_staff(id) ON DELETE CASCADE,
  register_id UUID NOT NULL REFERENCES registers(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pos_staff_sessions_token ON pos_staff_sessions(token);

-- Audit logs: allow POS staff actions without auth.users
ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL;

-- Track staff on shifts and sales
ALTER TABLE register_sessions
  ALTER COLUMN opened_by DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS opened_by_staff_id UUID REFERENCES pos_staff(id),
  ADD COLUMN IF NOT EXISTS closed_by_staff_id UUID REFERENCES pos_staff(id),
  ADD COLUMN IF NOT EXISTS active_staff_id UUID REFERENCES pos_staff(id);

ALTER TABLE sales
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS pos_staff_id UUID REFERENCES pos_staff(id);

CREATE INDEX idx_sales_pos_staff ON sales(pos_staff_id) WHERE pos_staff_id IS NOT NULL;

ALTER TABLE pos_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_staff_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_staff_select ON pos_staff FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY pos_staff_manage ON pos_staff FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

-- Sessions only via SECURITY DEFINER functions
CREATE POLICY pos_staff_sessions_deny ON pos_staff_sessions FOR ALL
  USING (false);

-- Helper: validate opaque POS session token
CREATE OR REPLACE FUNCTION public.validate_pos_staff_session(p_token TEXT)
RETURNS TABLE (
  staff_id UUID,
  register_id UUID,
  organization_id UUID,
  display_name TEXT,
  role member_role
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    ss.register_id,
    ss.organization_id,
    s.display_name,
    s.role
  FROM pos_staff_sessions ss
  JOIN pos_staff s ON s.id = ss.staff_id
  WHERE ss.token = p_token
    AND ss.expires_at > now()
    AND s.is_active = true;
END;
$$;

-- Register context for POS terminal (staff list names only)
CREATE OR REPLACE FUNCTION public.get_pos_register_context(p_register_id UUID)
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
    'staff', v_staff
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_register_context TO anon, authenticated;

-- Admin: create POS staff with PIN
CREATE OR REPLACE FUNCTION public.create_pos_staff(
  p_organization_id UUID,
  p_display_name TEXT,
  p_pin TEXT,
  p_role member_role DEFAULT 'cashier',
  p_store_ids UUID[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_can_manage(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF length(trim(p_display_name)) < 2 THEN
    RAISE EXCEPTION 'Name must be at least 2 characters';
  END IF;

  IF p_pin !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4–6 digits';
  END IF;

  IF p_role NOT IN ('cashier', 'manager') THEN
    RAISE EXCEPTION 'Invalid role for POS staff';
  END IF;

  INSERT INTO pos_staff (
    organization_id, display_name, pin_hash, role, store_ids, created_by
  ) VALUES (
    p_organization_id,
    trim(p_display_name),
    extensions.crypt(p_pin, extensions.gen_salt('bf')),
    p_role,
    p_store_ids,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pos_staff TO authenticated;

-- Admin: reset PIN
CREATE OR REPLACE FUNCTION public.reset_pos_staff_pin(
  p_staff_id UUID,
  p_pin TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM pos_staff WHERE id = p_staff_id;
  IF NOT FOUND OR NOT public.user_can_manage(v_org) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_pin !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4–6 digits';
  END IF;

  UPDATE pos_staff
  SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      failed_pin_attempts = 0,
      pin_locked_until = NULL,
      updated_at = now()
  WHERE id = p_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_pos_staff_pin TO authenticated;

-- Admin: activate/deactivate
CREATE OR REPLACE FUNCTION public.set_pos_staff_active(
  p_staff_id UUID,
  p_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM pos_staff WHERE id = p_staff_id;
  IF NOT FOUND OR NOT public.user_can_manage(v_org) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE pos_staff SET is_active = p_active, updated_at = now() WHERE id = p_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_pos_staff_active TO authenticated;

-- Cashier: verify PIN and issue session token (12h)
CREATE OR REPLACE FUNCTION public.verify_pos_staff_pin(
  p_register_id UUID,
  p_staff_id UUID,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_reg registers%ROWTYPE;
  v_staff pos_staff%ROWTYPE;
  v_token TEXT;
  v_session_id UUID;
BEGIN
  SELECT * INTO v_reg FROM registers WHERE id = p_register_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  SELECT * INTO v_staff FROM pos_staff
  WHERE id = p_staff_id
    AND organization_id = v_reg.organization_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid staff';
  END IF;

  IF v_staff.store_ids IS NOT NULL AND NOT (v_reg.store_id = ANY(v_staff.store_ids)) THEN
    RAISE EXCEPTION 'Staff not assigned to this store';
  END IF;

  IF v_staff.pin_locked_until IS NOT NULL AND v_staff.pin_locked_until > now() THEN
    RAISE EXCEPTION 'PIN locked. Try again later.';
  END IF;

  IF v_staff.pin_hash IS DISTINCT FROM extensions.crypt(p_pin, v_staff.pin_hash) THEN
    UPDATE pos_staff
    SET failed_pin_attempts = failed_pin_attempts + 1,
        pin_locked_until = CASE
          WHEN failed_pin_attempts + 1 >= 5 THEN now() + interval '15 minutes'
          ELSE pin_locked_until
        END,
        updated_at = now()
    WHERE id = p_staff_id;
    RAISE EXCEPTION 'Incorrect PIN';
  END IF;

  UPDATE pos_staff
  SET failed_pin_attempts = 0, pin_locked_until = NULL, updated_at = now()
  WHERE id = p_staff_id;

  -- Invalidate other sessions for this staff on same register
  DELETE FROM pos_staff_sessions
  WHERE staff_id = p_staff_id AND register_id = p_register_id;

  INSERT INTO pos_staff_sessions (staff_id, register_id, organization_id, expires_at)
  VALUES (p_staff_id, p_register_id, v_reg.organization_id, now() + interval '12 hours')
  RETURNING token, id INTO v_token, v_session_id;

  RETURN jsonb_build_object(
    'token', v_token,
    'staff_id', v_staff.id,
    'display_name', v_staff.display_name,
    'role', v_staff.role,
    'organization_id', v_reg.organization_id,
    'register_id', p_register_id,
    'expires_at', (now() + interval '12 hours')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_pos_staff_pin TO anon, authenticated;

-- Open shift as POS staff (no Supabase auth required)
CREATE OR REPLACE FUNCTION public.open_register_session_staff(
  p_register_id UUID,
  p_session_token TEXT,
  p_opening_float NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_session_id UUID;
BEGIN
  SELECT * INTO v_sess FROM public.validate_pos_staff_session(p_session_token);
  IF NOT FOUND OR v_sess.register_id <> p_register_id THEN
    RAISE EXCEPTION 'Invalid session';
  END IF;

  IF EXISTS (
    SELECT 1 FROM register_sessions
    WHERE register_id = p_register_id AND closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A shift is already open on this register';
  END IF;

  INSERT INTO register_sessions (
    register_id, organization_id, opened_by_staff_id, active_staff_id, opening_float
  ) VALUES (
    p_register_id, v_sess.organization_id, v_sess.staff_id, v_sess.staff_id,
    COALESCE(p_opening_float, 0)
  )
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'staff_id', v_sess.staff_id,
    'display_name', v_sess.display_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_register_session_staff TO anon, authenticated;

-- Close shift as POS staff
CREATE OR REPLACE FUNCTION public.close_register_session_staff(
  p_session_id UUID,
  p_session_token TEXT,
  p_closing_cash NUMERIC DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_reg_session register_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_sess FROM public.validate_pos_staff_session(p_session_token);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid session';
  END IF;

  SELECT * INTO v_reg_session FROM register_sessions
  WHERE id = p_session_id AND closed_at IS NULL;

  IF NOT FOUND OR v_reg_session.organization_id <> v_sess.organization_id THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  UPDATE register_sessions
  SET closed_at = now(),
      closed_by_staff_id = v_sess.staff_id,
      closing_cash_counted = COALESCE(p_closing_cash, 0),
      active_staff_id = NULL
  WHERE id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_register_session_staff TO anon, authenticated;

-- Catalog for POS terminal (anon-safe via register id)
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
      'categoryName', c.name
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

-- Open session for authenticated manager (existing flow + optional staff)
CREATE OR REPLACE FUNCTION public.open_register_session_manager(
  p_register_id UUID,
  p_organization_id UUID,
  p_opening_float NUMERIC DEFAULT 0,
  p_staff_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF EXISTS (
    SELECT 1 FROM register_sessions
    WHERE register_id = p_register_id AND closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A shift is already open on this register';
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pos_staff
    WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid staff';
  END IF;

  INSERT INTO register_sessions (
    register_id, organization_id, opened_by, opened_by_staff_id, active_staff_id, opening_float
  ) VALUES (
    p_register_id, p_organization_id, auth.uid(), p_staff_id, p_staff_id,
    COALESCE(p_opening_float, 0)
  )
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object('session_id', v_session_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_register_session_manager TO authenticated;

-- Replace complete_sale with POS staff support (drop old signature first)
DROP FUNCTION IF EXISTS public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB
);

-- Update complete_sale to accept POS staff session
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
  p_pos_session_token TEXT DEFAULT NULL
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
  END LOOP;

  IF abs(v_payment_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'Payment total % does not match sale total %', v_payment_total, v_total;
  END IF;

  INSERT INTO sales (
    organization_id, store_id, register_id, session_id, receipt_no,
    subtotal, tax_amount, discount_amount, total,
    customer_name, customer_phone, idempotency_key, created_by, pos_staff_id
  ) VALUES (
    p_organization_id, p_store_id, p_register_id, p_session_id, v_receipt_no,
    v_subtotal, v_tax_total, COALESCE(p_discount_amount, 0), v_total,
    p_customer_name, p_customer_phone, p_idempotency_key, v_user_id, v_staff_id
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
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT
) TO anon, authenticated;

-- Get open session for register (POS terminal)
CREATE OR REPLACE FUNCTION public.get_open_register_session(p_register_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row register_sessions%ROWTYPE;
  v_staff_name TEXT;
BEGIN
  SELECT * INTO v_row FROM register_sessions
  WHERE register_id = p_register_id AND closed_at IS NULL
  ORDER BY opened_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_row.active_staff_id IS NOT NULL THEN
    SELECT display_name INTO v_staff_name FROM pos_staff WHERE id = v_row.active_staff_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'opening_float', v_row.opening_float,
    'opened_at', v_row.opened_at,
    'active_staff_id', v_row.active_staff_id,
    'active_staff_name', v_staff_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_open_register_session TO anon, authenticated;

-- Allow receipt numbering when called from staff checkout (no auth.uid)
CREATE OR REPLACE FUNCTION public.next_receipt_number(p_store_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_num INT;
  v_prefix TEXT;
BEGIN
  SELECT organization_id INTO v_org_id FROM stores WHERE id = p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.user_has_org_access(v_org_id) THEN
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

-- Fetch sale receipt for POS (staff session or authenticated)
CREATE OR REPLACE FUNCTION public.get_pos_sale_receipt(
  p_sale_id UUID,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_org UUID;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT public.user_has_org_access(v_sale.organization_id) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSIF p_session_token IS NOT NULL THEN
    SELECT organization_id INTO v_org
    FROM public.validate_pos_staff_session(p_session_token);
    IF NOT FOUND OR v_org <> v_sale.organization_id THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'sale', to_jsonb(s.*),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(sl.*) ORDER BY sl.id)
        FROM sale_lines sl WHERE sl.sale_id = s.id
      ), '[]'::jsonb),
      'payments', COALESCE((
        SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.id)
        FROM payments p WHERE p.sale_id = s.id
      ), '[]'::jsonb)
    )
    FROM sales s WHERE s.id = p_sale_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_sale_receipt TO anon, authenticated;

-- Validate stored session token (no PIN re-entry)
CREATE OR REPLACE FUNCTION public.get_pos_staff_session(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM public.validate_pos_staff_session(p_token);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'token', p_token,
    'staff_id', v_sess.staff_id,
    'display_name', v_sess.display_name,
    'role', v_sess.role,
    'organization_id', v_sess.organization_id,
    'register_id', v_sess.register_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_staff_session TO anon, authenticated;

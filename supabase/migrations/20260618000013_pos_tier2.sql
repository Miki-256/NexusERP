-- POS Tier 2: live stats, manager PIN override, payment webhooks, org discount limit

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS pos_max_cashier_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 15;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS webhook_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payments_org_reference
  ON payments(organization_id, reference)
  WHERE reference IS NOT NULL;

-- Include discount limit in register context
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
    'pos_max_cashier_discount_pct', COALESCE(v_org.pos_max_cashier_discount_pct, 15),
    'staff', v_staff
  );
END;
$$;

-- Verify any floor manager PIN (override only — does not create staff session)
CREATE OR REPLACE FUNCTION public.verify_pos_manager_pin(
  p_register_id UUID,
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
BEGIN
  SELECT * INTO v_reg FROM registers WHERE id = p_register_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RETURN jsonb_build_object('approved', false, 'reason', 'Invalid PIN');
  END IF;

  FOR v_staff IN
    SELECT * FROM pos_staff
    WHERE organization_id = v_reg.organization_id
      AND role = 'manager'
      AND is_active = true
      AND (store_ids IS NULL OR v_reg.store_id = ANY(store_ids))
  LOOP
    IF v_staff.pin_locked_until IS NOT NULL AND v_staff.pin_locked_until > now() THEN
      CONTINUE;
    END IF;
    IF v_staff.pin_hash IS NOT NULL
       AND v_staff.pin_hash = extensions.crypt(p_pin, v_staff.pin_hash) THEN
      RETURN jsonb_build_object(
        'approved', true,
        'manager_id', v_staff.id,
        'manager_name', v_staff.display_name
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('approved', false, 'reason', 'Incorrect manager PIN');
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_pos_manager_pin TO anon, authenticated;

-- Live shift stats for POS header (lightweight)
CREATE OR REPLACE FUNCTION public.get_pos_live_stats(
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
  v_org UUID;
  v_sale_count INT;
  v_gross NUMERIC;
  v_payments JSONB;
  v_top JSONB;
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

  SELECT COUNT(*), COALESCE(SUM(total), 0)
  INTO v_sale_count, v_gross
  FROM sales
  WHERE session_id = p_session_id AND status = 'completed';

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('method', method, 'total', total) ORDER BY total DESC
  ), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT p.method::text AS method, SUM(p.amount) AS total
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    WHERE s.session_id = p_session_id AND s.status = 'completed'
    GROUP BY p.method
  ) agg;

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'qty')::numeric DESC), '[]'::jsonb)
  INTO v_top
  FROM (
    SELECT jsonb_build_object(
      'name', sl.product_name,
      'qty', SUM(sl.quantity),
      'total', SUM(sl.line_total)
    ) AS row,
    SUM(sl.quantity) AS qty
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    WHERE s.session_id = p_session_id AND s.status = 'completed'
    GROUP BY sl.product_name
    ORDER BY SUM(sl.quantity) DESC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'saleCount', v_sale_count,
    'grossTotal', v_gross,
    'paymentBreakdown', v_payments,
    'topProducts', v_top
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_live_stats TO anon, authenticated;

-- Mark mobile payment confirmed via provider webhook (service role / API)
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
      external_id = COALESCE(p_external_id, external_id),
      provider = COALESCE(NULLIF(p_provider, '')::mobile_money_provider, provider)
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'matched', true,
    'payment_id', v_payment.id,
    'sale_id', v_payment.sale_id,
    'amount', v_payment.amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_webhook TO service_role;

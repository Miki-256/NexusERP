-- Week 5: Gift cards and loyalty at POS.
-- Enum values are added here (idempotent). Compare via ::text in functions below so
-- new values work within the same migration transaction (PostgreSQL 55P04).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$ BEGIN
  ALTER TYPE payment_method ADD VALUE 'gift_card';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE payment_method ADD VALUE 'loyalty';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gift_card_status') THEN
    CREATE TYPE gift_card_status AS ENUM ('active', 'depleted', 'expired', 'voided');
  END IF;
END $$;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS pos_loyalty_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pos_loyalty_points_per NUMERIC(10,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pos_loyalty_spend_per_point NUMERIC(10,4) NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS pos_loyalty_min_redeem_points INT NOT NULL DEFAULT 100;

CREATE TABLE IF NOT EXISTS public.gift_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  initial_balance NUMERIC(14,2) NOT NULL CHECK (initial_balance > 0),
  balance NUMERIC(14,2) NOT NULL CHECK (balance >= 0),
  status gift_card_status NOT NULL DEFAULT 'active',
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_org_status ON gift_cards(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(organization_id, code);

CREATE TABLE IF NOT EXISTS public.gift_card_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT,
  sale_id UUID REFERENCES sales(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_card_tx_card ON gift_card_transactions(gift_card_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_loyalty (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points_balance INT NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  lifetime_points INT NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points INT NOT NULL,
  reason TEXT,
  sale_id UUID REFERENCES sales(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_org ON loyalty_transactions(organization_id, created_at DESC);

ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_loyalty ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gift_cards_select ON gift_cards;
CREATE POLICY gift_cards_select ON gift_cards FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS gift_cards_write ON gift_cards;
CREATE POLICY gift_cards_write ON gift_cards FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS gift_card_tx_select ON gift_card_transactions;
CREATE POLICY gift_card_tx_select ON gift_card_transactions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS customer_loyalty_select ON customer_loyalty;
CREATE POLICY customer_loyalty_select ON customer_loyalty FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS loyalty_tx_select ON loyalty_transactions;
CREATE POLICY loyalty_tx_select ON loyalty_transactions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

-- Gift card liability account
CREATE OR REPLACE FUNCTION public.ensure_default_accounts(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO accounts (organization_id, code, name, type) VALUES
    (p_org_id, '1000', 'Cash on Hand',        'asset'),
    (p_org_id, '1010', 'Bank',                'asset'),
    (p_org_id, '1020', 'Mobile Money',        'asset'),
    (p_org_id, '1100', 'Accounts Receivable', 'asset'),
    (p_org_id, '1200', 'Inventory',           'asset'),
    (p_org_id, '1500', 'Fixed Assets',        'asset'),
    (p_org_id, '1590', 'Accumulated Depreciation', 'asset'),
    (p_org_id, '2000', 'Accounts Payable',    'liability'),
    (p_org_id, '2100', 'Tax Payable',         'liability'),
    (p_org_id, '2300', 'Store Credit Liability', 'liability'),
    (p_org_id, '2310', 'Gift Card Liability', 'liability'),
    (p_org_id, '3000', 'Owner Equity',        'equity'),
    (p_org_id, '3900', 'Retained Earnings',   'equity'),
    (p_org_id, '4000', 'Sales Revenue',       'income'),
    (p_org_id, '5000', 'Cost of Goods Sold',  'expense'),
    (p_org_id, '6000', 'Operating Expenses',  'expense'),
    (p_org_id, '6100', 'Rent',                'expense'),
    (p_org_id, '6200', 'Utilities',           'expense'),
    (p_org_id, '6300', 'Maintenance',         'expense'),
    (p_org_id, '6400', 'Salaries',            'expense'),
    (p_org_id, '6510', 'Depreciation Expense', 'expense')
  ON CONFLICT (organization_id, code) DO NOTHING;

  INSERT INTO journals (organization_id, code, name, type) VALUES
    (p_org_id, 'SAL', 'Sales',     'sales'),
    (p_org_id, 'PUR', 'Purchases', 'purchase'),
    (p_org_id, 'CSH', 'Cash',      'cash'),
    (p_org_id, 'BNK', 'Bank',      'bank'),
    (p_org_id, 'GEN', 'General',   'general'),
    (p_org_id, 'DEP', 'Depreciation', 'general')
  ON CONFLICT (organization_id, code) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public._payment_method_account_code(p_method payment_method)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_method::text
    WHEN 'cash' THEN '1000'
    WHEN 'bank_transfer' THEN '1010'
    WHEN 'mobile_money' THEN '1020'
    WHEN 'store_credit' THEN '2300'
    WHEN 'gift_card' THEN '2310'
    WHEN 'loyalty' THEN '2300'
    WHEN 'on_account' THEN '1100'
    ELSE '1000'
  END;
$$;

CREATE OR REPLACE FUNCTION public._generate_gift_card_code()
RETURNS TEXT
LANGUAGE sql
SET search_path = public, extensions
AS $$
  SELECT 'GC-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 12));
$$;

CREATE OR REPLACE FUNCTION public._normalize_gift_card_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(trim(COALESCE(p_code, '')));
$$;

CREATE OR REPLACE FUNCTION public._loyalty_currency_per_point(p_org organizations)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(COALESCE(p_org.pos_loyalty_spend_per_point, 0.10), 0.01);
$$;

CREATE OR REPLACE FUNCTION public._loyalty_points_for_amount(p_org organizations, p_amount NUMERIC)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(ceil(p_amount / public._loyalty_currency_per_point(p_org))::INT, 0);
$$;

CREATE OR REPLACE FUNCTION public._loyalty_amount_for_points(p_org organizations, p_points INT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(GREATEST(p_points, 0) * public._loyalty_currency_per_point(p_org), 2);
$$;

CREATE OR REPLACE FUNCTION public._lock_validate_gift_card(
  p_org_id UUID,
  p_code TEXT,
  p_amount NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card gift_cards%ROWTYPE;
  v_code TEXT := public._normalize_gift_card_code(p_code);
BEGIN
  IF v_code = '' THEN
    RAISE EXCEPTION 'Gift card code is required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Gift card payment amount must be positive';
  END IF;

  SELECT * INTO v_card
  FROM gift_cards
  WHERE organization_id = p_org_id AND code = v_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  IF v_card.status = 'voided' THEN
    RAISE EXCEPTION 'Gift card has been voided';
  END IF;

  IF v_card.expires_at IS NOT NULL AND v_card.expires_at < now() THEN
    UPDATE gift_cards SET status = 'expired', updated_at = now() WHERE id = v_card.id;
    RAISE EXCEPTION 'Gift card has expired';
  END IF;

  IF v_card.balance < p_amount - 0.01 THEN
    RAISE EXCEPTION 'Insufficient gift card balance';
  END IF;

  RETURN v_card.id;
END;
$$;

CREATE OR REPLACE FUNCTION public._redeem_gift_card(
  p_org_id UUID,
  p_code TEXT,
  p_amount NUMERIC,
  p_sale_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card_id UUID;
  v_new_balance NUMERIC;
BEGIN
  v_card_id := public._lock_validate_gift_card(p_org_id, p_code, p_amount);

  UPDATE gift_cards
  SET balance = balance - p_amount,
      status = CASE WHEN balance - p_amount <= 0.01 THEN 'depleted'::gift_card_status ELSE status END,
      updated_at = now()
  WHERE id = v_card_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO gift_card_transactions (organization_id, gift_card_id, amount, reason, sale_id, created_by)
  VALUES (p_org_id, v_card_id, -p_amount, 'Redeemed at POS', p_sale_id, p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public._redeem_loyalty_points(
  p_org_id UUID,
  p_customer_id UUID,
  p_points INT,
  p_sale_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_balance INT;
BEGIN
  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT COALESCE(v_org.pos_loyalty_enabled, false) THEN
    RAISE EXCEPTION 'Loyalty program is not enabled';
  END IF;

  IF p_points < COALESCE(v_org.pos_loyalty_min_redeem_points, 100) THEN
    RAISE EXCEPTION 'Minimum loyalty redemption is % points', COALESCE(v_org.pos_loyalty_min_redeem_points, 100);
  END IF;

  SELECT points_balance INTO v_balance
  FROM customer_loyalty
  WHERE organization_id = p_org_id AND customer_id = p_customer_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_points THEN
    RAISE EXCEPTION 'Insufficient loyalty points';
  END IF;

  UPDATE customer_loyalty
  SET points_balance = points_balance - p_points, updated_at = now()
  WHERE organization_id = p_org_id AND customer_id = p_customer_id;

  INSERT INTO loyalty_transactions (organization_id, customer_id, points, reason, sale_id, created_by)
  VALUES (p_org_id, p_customer_id, -p_points, 'Redeemed at POS', p_sale_id, p_user_id);
END;
$$;


CREATE OR REPLACE FUNCTION public._validate_loyalty_redemption(
  p_org_id UUID,
  p_customer_id UUID,
  p_points INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_balance INT;
BEGIN
  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT COALESCE(v_org.pos_loyalty_enabled, false) THEN
    RAISE EXCEPTION 'Loyalty program is not enabled';
  END IF;
  IF p_points < COALESCE(v_org.pos_loyalty_min_redeem_points, 100) THEN
    RAISE EXCEPTION 'Minimum loyalty redemption is % points', COALESCE(v_org.pos_loyalty_min_redeem_points, 100);
  END IF;
  SELECT points_balance INTO v_balance
  FROM customer_loyalty
  WHERE organization_id = p_org_id AND customer_id = p_customer_id;
  IF COALESCE(v_balance, 0) < p_points THEN
    RAISE EXCEPTION 'Insufficient loyalty points';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._award_loyalty_points(
  p_org_id UUID,
  p_customer_id UUID,
  p_merch_subtotal NUMERIC,
  p_sale_id UUID,
  p_user_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_points INT;
BEGIN
  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT COALESCE(v_org.pos_loyalty_enabled, false) OR p_customer_id IS NULL THEN
    RETURN 0;
  END IF;

  v_points := GREATEST(
    floor(GREATEST(p_merch_subtotal, 0) * GREATEST(COALESCE(v_org.pos_loyalty_points_per, 1), 0))::INT,
    0
  );
  IF v_points <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO customer_loyalty (organization_id, customer_id, points_balance, lifetime_points)
  VALUES (p_org_id, p_customer_id, v_points, v_points)
  ON CONFLICT (organization_id, customer_id)
  DO UPDATE SET
    points_balance = customer_loyalty.points_balance + v_points,
    lifetime_points = customer_loyalty.lifetime_points + v_points,
    updated_at = now();

  INSERT INTO loyalty_transactions (organization_id, customer_id, points, reason, sale_id, created_by)
  VALUES (p_org_id, p_customer_id, v_points, 'Earned on POS sale', p_sale_id, p_user_id);

  RETURN v_points;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_gift_card(
  p_org_id UUID,
  p_amount NUMERIC,
  p_code TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_code TEXT;
  v_card gift_cards%ROWTYPE;
  v_attempts INT := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Gift card amount must be positive';
  END IF;

  v_code := public._normalize_gift_card_code(p_code);
  IF v_code = '' THEN
    LOOP
      v_code := public._generate_gift_card_code();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM gift_cards WHERE organization_id = p_org_id AND code = v_code
      );
      v_attempts := v_attempts + 1;
      IF v_attempts > 20 THEN
        RAISE EXCEPTION 'Could not generate unique gift card code';
      END IF;
    END LOOP;
  ELSIF EXISTS (SELECT 1 FROM gift_cards WHERE organization_id = p_org_id AND code = v_code) THEN
    RAISE EXCEPTION 'Gift card code already exists';
  END IF;

  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customers WHERE id = p_customer_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  INSERT INTO gift_cards (
    organization_id, code, initial_balance, balance, customer_id, expires_at, note, created_by
  ) VALUES (
    p_org_id, v_code, p_amount, p_amount, p_customer_id, p_expires_at, NULLIF(trim(p_note), ''), v_user_id
  ) RETURNING * INTO v_card;

  INSERT INTO gift_card_transactions (organization_id, gift_card_id, amount, reason, created_by)
  VALUES (p_org_id, v_card.id, p_amount, 'Issued', v_user_id);

  RETURN jsonb_build_object(
    'id', v_card.id,
    'code', v_card.code,
    'balance', v_card.balance,
    'expires_at', v_card.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_gift_card(p_org_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card gift_cards%ROWTYPE;
  v_code TEXT := public._normalize_gift_card_code(p_code);
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_card
  FROM gift_cards
  WHERE organization_id = p_org_id AND code = v_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Gift card not found');
  END IF;

  IF v_card.status = 'voided' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Gift card voided');
  END IF;

  IF v_card.expires_at IS NOT NULL AND v_card.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Gift card expired');
  END IF;

  IF v_card.balance <= 0 THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Gift card has no balance');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'id', v_card.id,
    'code', v_card.code,
    'balance', v_card.balance,
    'expires_at', v_card.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_gift_cards(
  p_org_id UUID,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_q TEXT := NULLIF(trim(p_search), '');
  v_total BIGINT;
  v_rows JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM gift_cards g
  WHERE g.organization_id = p_org_id
    AND (v_q IS NULL OR g.code ILIKE '%' || v_q || '%');

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at' DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', g.id,
      'code', g.code,
      'balance', g.balance,
      'initial_balance', g.initial_balance,
      'status', g.status,
      'expires_at', g.expires_at,
      'note', g.note,
      'customer_id', g.customer_id,
      'customer_name', c.name,
      'created_at', g.created_at
    ) AS row,
    g.created_at
    FROM gift_cards g
    LEFT JOIN customers c ON c.id = g.customer_id
    WHERE g.organization_id = p_org_id
      AND (v_q IS NULL OR g.code ILIKE '%' || v_q || '%')
    ORDER BY g.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_gift_card(p_gift_card_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card gift_cards%ROWTYPE;
BEGIN
  SELECT * INTO v_card FROM gift_cards WHERE id = p_gift_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  IF NOT public.user_can_manage(v_card.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_card.status = 'voided' THEN
    RETURN;
  END IF;

  UPDATE gift_cards
  SET status = 'voided', balance = 0, updated_at = now(), note = COALESCE(NULLIF(trim(p_reason), ''), note)
  WHERE id = p_gift_card_id;

  INSERT INTO gift_card_transactions (organization_id, gift_card_id, amount, reason, created_by)
  VALUES (
    v_card.organization_id, v_card.id, -v_card.balance,
    COALESCE(NULLIF(trim(p_reason), ''), 'Voided'), auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_gift_card(UUID, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_gift_card(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_gift_cards(UUID, INT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_gift_card(UUID, TEXT) TO authenticated;

-- Bootstrap: expose loyalty program settings to POS
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
  v_catalog_total INT;
BEGIN
  SELECT * INTO v_reg FROM registers WHERE id = p_register_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Register not found'; END IF;
  SELECT * INTO v_store FROM stores WHERE id = v_reg.store_id AND is_active = true;
  SELECT * INTO v_org FROM organizations WHERE id = v_reg.organization_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'role', role) ORDER BY display_name), '[]'::jsonb)
  INTO v_staff FROM pos_staff
  WHERE organization_id = v_reg.organization_id AND is_active = true
    AND (store_ids IS NULL OR v_reg.store_id = ANY(store_ids));

  SELECT COUNT(*)::INT INTO v_catalog_total
  FROM products p JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
  WHERE p.organization_id = v_reg.organization_id AND p.is_active = true;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'name'), '[]'::jsonb) INTO v_catalog
  FROM (
    SELECT jsonb_build_object(
      'productId', p.id, 'variantId', pv.id, 'name', p.name, 'variantName', pv.name,
      'sellPrice', COALESCE(pv.sell_price, p.sell_price), 'barcode', COALESCE(pv.barcode, p.barcode),
      'sku', COALESCE(pv.sku, p.sku), 'stock', COALESCE(il.quantity, 0),
      'categoryId', p.category_id, 'categoryName', c.name, 'imageUrl', p.image_url
    ) AS row, p.name
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN inventory_levels il ON il.variant_id = pv.id AND il.store_id = v_reg.store_id
    WHERE p.organization_id = v_reg.organization_id AND p.is_active = true
    ORDER BY p.name LIMIT 500
  ) sub;

  SELECT to_jsonb(rs.*) INTO v_session FROM register_sessions rs
  WHERE rs.register_id = p_register_id AND rs.closed_at IS NULL ORDER BY rs.opened_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'register_id', v_reg.id, 'register_name', v_reg.name,
    'store_id', v_store.id, 'store_name', v_store.name,
    'organization_id', v_org.id, 'org_name', v_org.name,
    'currency', v_org.currency, 'tax_rate', v_org.tax_rate,
    'tax_inclusive', v_org.tax_inclusive, 'receipt_footer', v_org.receipt_footer,
    'pos_max_cashier_discount_pct', COALESCE(v_org.pos_max_cashier_discount_pct, 15),
    'pos_tips_enabled', COALESCE(v_org.pos_tips_enabled, false),
    'pos_tip_presets', COALESCE(v_org.pos_tip_presets, '[10,15,20]'::jsonb),
    'pos_loyalty_enabled', COALESCE(v_org.pos_loyalty_enabled, false),
    'pos_loyalty_points_per', COALESCE(v_org.pos_loyalty_points_per, 1),
    'pos_loyalty_spend_per_point', COALESCE(v_org.pos_loyalty_spend_per_point, 0.10),
    'pos_loyalty_min_redeem_points', COALESCE(v_org.pos_loyalty_min_redeem_points, 100),
    'staff', v_staff, 'catalog', v_catalog,
    'catalog_total', v_catalog_total, 'catalog_truncated', v_catalog_total > 500,
    'open_session', v_session
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_bootstrap(UUID) TO anon, authenticated;

-- POS customer search includes loyalty balance
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
        'loyaltyPoints', COALESCE(cl.points_balance, 0),
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
      LEFT JOIN customer_loyalty cl
        ON cl.customer_id = c.id AND cl.organization_id = c.organization_id
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

-- complete_sale: gift card + loyalty payments
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
  v_dup_receipt TEXT;
  v_dup_total NUMERIC;
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
  v_gift_card_total NUMERIC := 0;
  v_loyalty_total NUMERIC := 0;
  v_loyalty_points_total INT := 0;
  v_loyalty_points_earned INT := 0;
  v_loyalty_pts INT;
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

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key is required';
  END IF;

  SELECT id, receipt_no, total
  INTO v_existing_sale, v_dup_receipt, v_dup_total
  FROM sales
  WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'sale_id', v_existing_sale,
      'receipt_no', v_dup_receipt,
      'total', v_dup_total,
      'duplicate', true
    );
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
    ELSIF v_payment->>'method' = 'gift_card' THEN
      v_gift_card_total := v_gift_card_total + v_payment_amount;
    ELSIF v_payment->>'method' = 'loyalty' THEN
      v_loyalty_total := v_loyalty_total + v_payment_amount;
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

  IF v_gift_card_total > 0 THEN
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      IF v_payment->>'method' = 'gift_card' THEN
        PERFORM public._lock_validate_gift_card(
          p_organization_id,
          v_payment->>'reference',
          COALESCE((v_payment->>'amount')::NUMERIC, 0)
        );
      END IF;
    END LOOP;
  END IF;

  IF v_loyalty_total > 0 THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Customer required for loyalty redemption';
    END IF;
    v_loyalty_points_total := 0;
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      IF v_payment->>'method' = 'loyalty' THEN
        v_loyalty_pts := COALESCE(NULLIF(trim(v_payment->>'reference'), '')::INT, 0);
        IF v_loyalty_pts <= 0 THEN
          v_loyalty_pts := public._loyalty_points_for_amount(
            v_org, COALESCE((v_payment->>'amount')::NUMERIC, 0)
          );
        END IF;
        v_loyalty_points_total := v_loyalty_points_total + v_loyalty_pts;
      END IF;
    END LOOP;
    PERFORM public._validate_loyalty_redemption(
      p_organization_id, p_customer_id, v_loyalty_points_total
    );
  END IF;

  BEGIN
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
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, receipt_no, total
      INTO v_existing_sale, v_dup_receipt, v_dup_total
      FROM sales
      WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'sale_id', v_existing_sale,
          'receipt_no', v_dup_receipt,
          'total', v_dup_total,
          'duplicate', true
        );
      END IF;
      RAISE;
  END;

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

  IF v_gift_card_total > 0 THEN
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      IF v_payment->>'method' = 'gift_card' THEN
        PERFORM public._redeem_gift_card(
          p_organization_id,
          v_payment->>'reference',
          COALESCE((v_payment->>'amount')::NUMERIC, 0),
          v_sale_id,
          v_user_id
        );
      END IF;
    END LOOP;
  END IF;

  IF v_loyalty_total > 0 AND v_loyalty_points_total > 0 THEN
    PERFORM public._redeem_loyalty_points(
      p_organization_id, p_customer_id, v_loyalty_points_total, v_sale_id, v_user_id
    );
  END IF;

  IF COALESCE(v_org.pos_loyalty_enabled, false) AND p_customer_id IS NOT NULL THEN
    v_loyalty_points_earned := public._award_loyalty_points(
      p_organization_id, p_customer_id, v_merch_subtotal, v_sale_id, v_user_id
    );
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
    'payments_pending', v_has_pending_payments,
    'loyalty_points_earned', v_loyalty_points_earned
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB,
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT
) TO anon, authenticated;

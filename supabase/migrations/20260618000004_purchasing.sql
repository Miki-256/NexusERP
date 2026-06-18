-- Phase 2: Purchasing (vendors, purchase orders, vendor bills) + inventory
-- valuation (moving-average cost) with ledger posting.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'po_status') THEN
    CREATE TYPE po_status AS ENUM ('draft', 'ordered', 'received', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bill_status') THEN
    CREATE TYPE bill_status AS ENUM ('open', 'paid');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendors(organization_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  status po_status NOT NULL DEFAULT 'draft',
  order_date DATE NOT NULL DEFAULT current_date,
  expected_date DATE,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  received_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_org ON purchase_orders(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  product_name TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pol_po ON purchase_order_lines(po_id);

CREATE TABLE IF NOT EXISTS vendor_bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  po_id UUID REFERENCES purchase_orders(id),
  bill_no TEXT,
  bill_date DATE NOT NULL DEFAULT current_date,
  due_date DATE,
  amount NUMERIC(14,2) NOT NULL,
  status bill_status NOT NULL DEFAULT 'open',
  journal_entry_id UUID REFERENCES journal_entries(id),
  paid_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bills_org ON vendor_bills(organization_id, bill_date DESC);

-- RLS
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendors_select ON vendors FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY vendors_write ON vendors FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY po_select ON purchase_orders FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY po_write ON purchase_orders FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY pol_select ON purchase_order_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY pol_write ON purchase_order_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY bills_select ON vendor_bills FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

-- ---------------------------------------------------------------------------
-- Create a purchase order with lines. p_lines: [{variantId, productName, quantity, unitCost}]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_org_id UUID,
  p_vendor_id UUID,
  p_store_id UUID,
  p_expected_date DATE,
  p_notes TEXT,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po_id UUID;
  v_line JSONB;
  v_total NUMERIC := 0;
  v_qty NUMERIC;
  v_cost NUMERIC;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO purchase_orders (organization_id, vendor_id, store_id, status, expected_date, notes, created_by)
  VALUES (p_org_id, p_vendor_id, p_store_id, 'ordered', p_expected_date, p_notes, auth.uid())
  RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (v_line->>'quantity')::NUMERIC;
    v_cost := (v_line->>'unitCost')::NUMERIC;
    INSERT INTO purchase_order_lines (po_id, organization_id, variant_id, product_name, quantity, unit_cost, line_total)
    VALUES (v_po_id, p_org_id, (v_line->>'variantId')::UUID, v_line->>'productName', v_qty, v_cost, v_qty * v_cost);
    v_total := v_total + v_qty * v_cost;
  END LOOP;

  UPDATE purchase_orders SET total = v_total WHERE id = v_po_id;
  RETURN v_po_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_purchase_order TO authenticated;

-- ---------------------------------------------------------------------------
-- Receive a purchase order: add stock (moving-average cost), create a vendor
-- bill (AP), and post Dr Inventory / Cr Accounts Payable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_po_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_line purchase_order_lines%ROWTYPE;
  v_bill_id UUID;
  v_entry_id UUID;
  v_on_hand NUMERIC;
  v_old_cost NUMERIC;
  v_new_cost NUMERIC;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  IF NOT public.user_can_manage(v_po.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_po.status = 'received' THEN
    RAISE EXCEPTION 'Purchase order already received';
  END IF;

  PERFORM public.ensure_default_accounts(v_po.organization_id);

  FOR v_line IN SELECT * FROM purchase_order_lines WHERE po_id = p_po_id LOOP
    -- Current total on-hand across all stores for moving-average valuation.
    SELECT COALESCE(SUM(quantity), 0) INTO v_on_hand
    FROM inventory_levels WHERE variant_id = v_line.variant_id;

    SELECT COALESCE(pv.cost_price, p.cost_price, 0) INTO v_old_cost
    FROM product_variants pv LEFT JOIN products p ON p.id = pv.product_id
    WHERE pv.id = v_line.variant_id;

    IF (v_on_hand + v_line.quantity) > 0 THEN
      v_new_cost := round(
        ((v_on_hand * COALESCE(v_old_cost, 0)) + (v_line.quantity * v_line.unit_cost))
        / (v_on_hand + v_line.quantity), 2);
    ELSE
      v_new_cost := v_line.unit_cost;
    END IF;

    UPDATE product_variants SET cost_price = v_new_cost WHERE id = v_line.variant_id;
    UPDATE products p SET cost_price = v_new_cost
      FROM product_variants pv WHERE pv.id = v_line.variant_id AND p.id = pv.product_id;

    -- Add stock at the receiving store.
    INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
    VALUES (v_po.store_id, v_line.variant_id, v_po.organization_id, v_line.quantity)
    ON CONFLICT (store_id, variant_id)
    DO UPDATE SET quantity = inventory_levels.quantity + v_line.quantity, updated_at = now();

    INSERT INTO inventory_adjustments (store_id, variant_id, organization_id, delta, reason, user_id)
    VALUES (v_po.store_id, v_line.variant_id, v_po.organization_id, v_line.quantity,
            'PO receipt ' || p_po_id::text, auth.uid());
  END LOOP;

  -- Vendor bill (accounts payable)
  INSERT INTO vendor_bills (organization_id, vendor_id, po_id, bill_date, amount, status)
  VALUES (v_po.organization_id, v_po.vendor_id, p_po_id, current_date, v_po.total, 'open')
  RETURNING id INTO v_bill_id;

  -- Ledger: Dr Inventory, Cr Accounts Payable
  IF v_po.total > 0 THEN
    v_entry_id := public.post_journal_entry(
      v_po.organization_id, 'PUR', current_date,
      'Goods receipt PO ' || p_po_id::text, 'purchase', p_po_id,
      jsonb_build_array(
        jsonb_build_object('accountId', public.account_id_by_code(v_po.organization_id, '1200'),
          'debit', v_po.total, 'credit', 0, 'description', 'Inventory received'),
        jsonb_build_object('accountId', public.account_id_by_code(v_po.organization_id, '2000'),
          'debit', 0, 'credit', v_po.total, 'description', 'Accounts payable')
      )
    );
    UPDATE vendor_bills SET journal_entry_id = v_entry_id WHERE id = v_bill_id;
  END IF;

  UPDATE purchase_orders SET status = 'received', received_at = now() WHERE id = p_po_id;
  RETURN v_bill_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order TO authenticated;

-- ---------------------------------------------------------------------------
-- Pay a vendor bill: Dr Accounts Payable, Cr Cash/Bank/Mobile.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_vendor_bill(
  p_bill_id UUID,
  p_payment_method payment_method
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill vendor_bills%ROWTYPE;
  v_pay_acct UUID;
  v_entry_id UUID;
BEGIN
  SELECT * INTO v_bill FROM vendor_bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;
  IF NOT public.user_can_manage(v_bill.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_bill.status = 'paid' THEN
    RAISE EXCEPTION 'Bill already paid';
  END IF;

  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(v_bill.organization_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(v_bill.organization_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(v_bill.organization_id, '1020')
    ELSE public.account_id_by_code(v_bill.organization_id, '1000')
  END;

  v_entry_id := public.post_journal_entry(
    v_bill.organization_id, 'PUR', current_date,
    'Vendor bill payment', 'bill_payment', p_bill_id,
    jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_bill.organization_id, '2000'),
        'debit', v_bill.amount, 'credit', 0, 'description', 'AP settled'),
      jsonb_build_object('accountId', v_pay_acct,
        'debit', 0, 'credit', v_bill.amount, 'description', 'Paid ' || p_payment_method::text)
    )
  );

  UPDATE vendor_bills SET status = 'paid', paid_entry_id = v_entry_id WHERE id = p_bill_id;
  RETURN v_entry_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.pay_vendor_bill TO authenticated;

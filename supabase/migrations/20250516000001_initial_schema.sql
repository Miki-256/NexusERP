-- Nex POS: Multi-tenant retail schema with RLS

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
CREATE TYPE member_role AS ENUM ('owner', 'manager', 'cashier');
CREATE TYPE sale_status AS ENUM ('completed', 'voided', 'returned');
CREATE TYPE payment_method AS ENUM ('cash', 'mobile_money', 'bank_transfer');
CREATE TYPE payment_status AS ENUM ('completed', 'pending');
CREATE TYPE mobile_money_provider AS ENUM ('mpesa', 'telebirr', 'cbe_birr', 'm_pesa', 'other');

-- Organizations (tenants)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ETB',
  timezone TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 15,
  tax_inclusive BOOLEAN NOT NULL DEFAULT false,
  receipt_prefix TEXT NOT NULL DEFAULT 'R',
  receipt_footer TEXT,
  address TEXT,
  tax_id TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Organization members
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'cashier',
  store_ids UUID[] DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_org_members_user ON organization_members(user_id);
CREATE INDEX idx_org_members_org ON organization_members(organization_id);

-- Stores
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stores_org ON stores(organization_id);

-- Registers
CREATE TABLE registers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_registers_store ON registers(store_id);
CREATE INDEX idx_registers_org ON registers(organization_id);

-- Register sessions (shifts)
CREATE TABLE register_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  register_id UUID NOT NULL REFERENCES registers(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES auth.users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_float NUMERIC(12,2) NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id),
  closing_cash_counted NUMERIC(12,2),
  notes TEXT,
  CONSTRAINT session_open_or_closed CHECK (
    (closed_at IS NULL AND closed_by IS NULL) OR
    (closed_at IS NOT NULL AND closed_by IS NOT NULL)
  )
);

CREATE INDEX idx_sessions_register ON register_sessions(register_id);
CREATE INDEX idx_sessions_open ON register_sessions(register_id) WHERE closed_at IS NULL;

-- Categories
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_org ON categories(organization_id);

-- Products
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  sell_price NUMERIC(12,2) NOT NULL,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_org ON products(organization_id);
CREATE INDEX idx_products_barcode ON products(organization_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_products_name ON products(organization_id, name);

-- Product variants (default variant created per product)
CREATE TABLE product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  sku TEXT,
  barcode TEXT,
  sell_price NUMERIC(12,2),
  cost_price NUMERIC(12,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_variants_org ON product_variants(organization_id);
CREATE INDEX idx_variants_barcode ON product_variants(organization_id, barcode) WHERE barcode IS NOT NULL;

-- Inventory per store
CREATE TABLE inventory_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, variant_id)
);

CREATE INDEX idx_inventory_store ON inventory_levels(store_id);
CREATE INDEX idx_inventory_variant ON inventory_levels(variant_id);

-- Inventory adjustments
CREATE TABLE inventory_adjustments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delta NUMERIC(12,3) NOT NULL,
  reason TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Receipt sequence per store
CREATE TABLE receipt_sequences (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  last_number INT NOT NULL DEFAULT 0
);

-- Sales
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id),
  register_id UUID NOT NULL REFERENCES registers(id),
  session_id UUID REFERENCES register_sessions(id),
  receipt_no TEXT NOT NULL,
  status sale_status NOT NULL DEFAULT 'completed',
  subtotal NUMERIC(12,2) NOT NULL,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  idempotency_key UUID,
  original_sale_id UUID REFERENCES sales(id),
  void_reason TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX idx_sales_org ON sales(organization_id);
CREATE INDEX idx_sales_store ON sales(store_id);
CREATE INDEX idx_sales_created ON sales(organization_id, created_at DESC);
CREATE INDEX idx_sales_receipt ON sales(store_id, receipt_no);

-- Sale lines
CREATE TABLE sale_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  product_name TEXT NOT NULL,
  variant_name TEXT,
  quantity NUMERIC(12,3) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL
);

CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id);

-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  method payment_method NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status payment_status NOT NULL DEFAULT 'completed',
  reference TEXT,
  provider mobile_money_provider,
  phone TEXT,
  bank_name TEXT,
  cash_tendered NUMERIC(12,2),
  change_given NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_sale ON payments(sale_id);

-- Customers (light v1)
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_org ON customers(organization_id);

-- Staff invites
CREATE TABLE staff_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role member_role NOT NULL DEFAULT 'cashier',
  store_ids UUID[],
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

-- Audit logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_org ON audit_logs(organization_id, created_at DESC);

-- Helper: get user's organization ids
CREATE OR REPLACE FUNCTION public.user_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM organization_members
  WHERE user_id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.user_has_org_access(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = auth.uid() AND organization_id = org_id AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.user_role_in_org(org_id UUID)
RETURNS member_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM organization_members
  WHERE user_id = auth.uid() AND organization_id = org_id AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = auth.uid()
      AND organization_id = org_id
      AND is_active = true
      AND role IN ('owner', 'manager')
  );
$$;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

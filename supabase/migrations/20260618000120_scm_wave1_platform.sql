-- SCM Wave 1: product & location platform — PIM extensions, warehouses, costing settings.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_lifecycle_status') THEN
    CREATE TYPE product_lifecycle_status AS ENUM (
      'draft', 'active', 'discontinued', 'obsolete'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'warehouse_type') THEN
    CREATE TYPE warehouse_type AS ENUM ('store', 'distribution', 'manufacturing', 'transit');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_location_type') THEN
    CREATE TYPE storage_location_type AS ENUM (
      'zone', 'aisle', 'rack', 'shelf', 'bin', 'staging', 'dock'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_costing_method') THEN
    CREATE TYPE inventory_costing_method AS ENUM (
      'moving_average', 'fifo', 'standard'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'barcode_type') THEN
    CREATE TYPE barcode_type AS ENUM ('ean13', 'upc', 'code128', 'qr', 'internal', 'other');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Organization inventory settings
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS inventory_costing_method inventory_costing_method NOT NULL DEFAULT 'moving_average',
  ADD COLUMN IF NOT EXISTS inventory_standard_cost_auto_update BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Product master extensions (PIM)
-- ---------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS lifecycle_status product_lifecycle_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS base_uom_code TEXT NOT NULL DEFAULT 'ea',
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS length_cm NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS width_cm NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS hs_code TEXT,
  ADD COLUMN IF NOT EXISTS country_of_origin TEXT,
  ADD COLUMN IF NOT EXISTS shelf_life_days INT,
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_products_org_lifecycle
  ON products(organization_id, lifecycle_status)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Additional barcodes per variant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_barcodes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  barcode_type barcode_type NOT NULL DEFAULT 'other',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, barcode)
);

CREATE INDEX IF NOT EXISTS idx_product_barcodes_variant
  ON product_barcodes(variant_id);

-- ---------------------------------------------------------------------------
-- Units of measure & conversions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_uoms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  uom_code TEXT NOT NULL,
  uom_name TEXT NOT NULL,
  conversion_factor NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  is_base BOOLEAN NOT NULL DEFAULT false,
  is_purchase BOOLEAN NOT NULL DEFAULT false,
  is_sale BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, uom_code)
);

CREATE INDEX IF NOT EXISTS idx_product_uoms_product ON product_uoms(product_id);

-- ---------------------------------------------------------------------------
-- Supplier catalog links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  supplier_sku TEXT,
  supplier_product_name TEXT,
  unit_cost NUMERIC(14,4),
  lead_time_days INT,
  is_preferred BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_product_suppliers_product ON product_suppliers(product_id);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_vendor ON product_suppliers(vendor_id);

-- ---------------------------------------------------------------------------
-- Warehouses (1:1 with stores for retail; extensible for DCs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID UNIQUE REFERENCES stores(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  warehouse_type warehouse_type NOT NULL DEFAULT 'store',
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_warehouses_org ON warehouses(organization_id, is_active);

-- ---------------------------------------------------------------------------
-- Storage location hierarchy (zone → … → bin)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES storage_locations(id) ON DELETE CASCADE,
  location_type storage_location_type NOT NULL DEFAULT 'bin',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_pickable BOOLEAN NOT NULL DEFAULT true,
  is_receivable BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, code)
);

CREATE INDEX IF NOT EXISTS idx_storage_locations_warehouse
  ON storage_locations(warehouse_id, parent_id);

-- ---------------------------------------------------------------------------
-- Warehouse-level permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse_user_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT true,
  can_receive BOOLEAN NOT NULL DEFAULT false,
  can_pick BOOLEAN NOT NULL DEFAULT false,
  can_adjust BOOLEAN NOT NULL DEFAULT false,
  can_manage BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_user_access_user
  ON warehouse_user_access(user_id, organization_id);

-- ---------------------------------------------------------------------------
-- FIFO cost layers (foundation for valuation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_cost_layers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity_remaining NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity_remaining >= 0),
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_type TEXT,
  source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_layers_variant_store
  ON inventory_cost_layers(variant_id, store_id, received_at)
  WHERE quantity_remaining > 0;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_cost_layers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_barcodes_select ON product_barcodes;
CREATE POLICY product_barcodes_select ON product_barcodes FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS product_barcodes_write ON product_barcodes;
CREATE POLICY product_barcodes_write ON product_barcodes FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS product_uoms_select ON product_uoms;
CREATE POLICY product_uoms_select ON product_uoms FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS product_uoms_write ON product_uoms;
CREATE POLICY product_uoms_write ON product_uoms FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS product_suppliers_select ON product_suppliers;
CREATE POLICY product_suppliers_select ON product_suppliers FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS product_suppliers_write ON product_suppliers;
CREATE POLICY product_suppliers_write ON product_suppliers FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS warehouses_select ON warehouses;
CREATE POLICY warehouses_select ON warehouses FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_org_access(organization_id)
  );

DROP POLICY IF EXISTS warehouses_write ON warehouses;
CREATE POLICY warehouses_write ON warehouses FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS storage_locations_select ON storage_locations;
CREATE POLICY storage_locations_select ON storage_locations FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_org_access(organization_id)
  );

DROP POLICY IF EXISTS storage_locations_write ON storage_locations;
CREATE POLICY storage_locations_write ON storage_locations FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS warehouse_user_access_select ON warehouse_user_access;
CREATE POLICY warehouse_user_access_select ON warehouse_user_access FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (user_id = auth.uid() OR public.user_can_manage(organization_id))
  );

DROP POLICY IF EXISTS warehouse_user_access_write ON warehouse_user_access;
CREATE POLICY warehouse_user_access_write ON warehouse_user_access FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS inventory_cost_layers_deny ON inventory_cost_layers;
CREATE POLICY inventory_cost_layers_deny ON inventory_cost_layers FOR ALL USING (false);

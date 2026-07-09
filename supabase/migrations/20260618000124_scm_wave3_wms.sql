-- SCM Wave 3: WMS & fulfillment — bin-level stock, pick/pack/ship, logistics.

-- ---------------------------------------------------------------------------
-- Movement types
-- ---------------------------------------------------------------------------
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'location_transfer';
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'fulfillment_shipment';

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fulfillment_order_status') THEN
    CREATE TYPE fulfillment_order_status AS ENUM (
      'draft', 'released', 'picking', 'picked', 'packed', 'shipped', 'cancelled'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fulfillment_priority') THEN
    CREATE TYPE fulfillment_priority AS ENUM ('normal', 'rush');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipment_status') THEN
    CREATE TYPE shipment_status AS ENUM ('pending', 'in_transit', 'delivered', 'cancelled');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Location barcode for mobile scan
-- ---------------------------------------------------------------------------
ALTER TABLE storage_locations
  ADD COLUMN IF NOT EXISTS location_barcode TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_locations_barcode
  ON storage_locations(organization_id, location_barcode)
  WHERE location_barcode IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Bin-level inventory (detail; store on-hand remains inventory_levels)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_location_balances_loc_variant_lot
  ON location_balances (location_id, variant_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_location_balances_store_variant
  ON location_balances(organization_id, store_id, variant_id);

CREATE INDEX IF NOT EXISTS idx_location_balances_location
  ON location_balances(location_id)
  WHERE quantity > 0;

ALTER TABLE stock_movement_lines
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES storage_locations(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Fulfillment orders (warehouse outbound — separate from POS instant deduct)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fulfillment_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  order_no TEXT NOT NULL,
  status fulfillment_order_status NOT NULL DEFAULT 'draft',
  priority fulfillment_priority NOT NULL DEFAULT 'normal',
  reference_type TEXT,
  reference_id UUID,
  ship_to_name TEXT,
  ship_to_phone TEXT,
  ship_to_address TEXT,
  notes TEXT,
  released_at TIMESTAMPTZ,
  picked_at TIMESTAMPTZ,
  packed_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfillment_orders_org_no
  ON fulfillment_orders(organization_id, order_no);

CREATE INDEX IF NOT EXISTS idx_fulfillment_orders_org_status
  ON fulfillment_orders(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS fulfillment_order_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fulfillment_order_id UUID NOT NULL REFERENCES fulfillment_orders(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  quantity_ordered NUMERIC(12,3) NOT NULL CHECK (quantity_ordered > 0),
  quantity_picked NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity_picked >= 0),
  quantity_shipped NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity_shipped >= 0),
  pick_location_id UUID REFERENCES storage_locations(id) ON DELETE SET NULL,
  lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL,
  line_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_order_lines_order
  ON fulfillment_order_lines(fulfillment_order_id);

-- ---------------------------------------------------------------------------
-- Shipments / logistics
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fulfillment_order_id UUID NOT NULL REFERENCES fulfillment_orders(id) ON DELETE CASCADE,
  carrier TEXT,
  tracking_number TEXT,
  status shipment_status NOT NULL DEFAULT 'pending',
  weight_kg NUMERIC(12,3),
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipments_fulfillment
  ON shipments(fulfillment_order_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE location_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS location_balances_select ON location_balances;
CREATE POLICY location_balances_select ON location_balances FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS location_balances_deny ON location_balances;
CREATE POLICY location_balances_deny ON location_balances FOR ALL USING (false);

DROP POLICY IF EXISTS fulfillment_orders_select ON fulfillment_orders;
CREATE POLICY fulfillment_orders_select ON fulfillment_orders FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS fulfillment_orders_write ON fulfillment_orders;
CREATE POLICY fulfillment_orders_write ON fulfillment_orders FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS fulfillment_order_lines_select ON fulfillment_order_lines;
CREATE POLICY fulfillment_order_lines_select ON fulfillment_order_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS fulfillment_order_lines_write ON fulfillment_order_lines;
CREATE POLICY fulfillment_order_lines_write ON fulfillment_order_lines FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS shipments_select ON shipments;
CREATE POLICY shipments_select ON shipments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS shipments_write ON shipments;
CREATE POLICY shipments_write ON shipments FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

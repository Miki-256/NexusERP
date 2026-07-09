-- SCM Wave 0: unified stock movement ledger (foundation for enterprise IMS/WMS).

-- ---------------------------------------------------------------------------
-- Movement types
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_movement_type') THEN
    CREATE TYPE stock_movement_type AS ENUM (
      'adjustment',
      'warehouse_transfer',
      'purchase_receipt',
      'sale_shipment',
      'sale_return',
      'sale_void',
      'production_issue',
      'production_receipt',
      'initial_stock',
      'import_receipt',
      'bulk_receive'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Stock movement header (immutable audit record)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  movement_type stock_movement_type NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  idempotency_key TEXT,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_idempotency
  ON stock_movements(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_org_created
  ON stock_movements(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
  ON stock_movements(reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_org_type
  ON stock_movements(organization_id, movement_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- Stock movement lines (signed quantity deltas per store × variant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movement_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  movement_id UUID NOT NULL REFERENCES stock_movements(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity_delta NUMERIC(12,3) NOT NULL,
  quantity_before NUMERIC(12,3) NOT NULL DEFAULT 0,
  quantity_after NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,4),
  line_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movement_lines_movement
  ON stock_movement_lines(movement_id);

CREATE INDEX IF NOT EXISTS idx_stock_movement_lines_org_store_variant
  ON stock_movement_lines(organization_id, store_id, variant_id);

CREATE INDEX IF NOT EXISTS idx_stock_movement_lines_variant_created
  ON stock_movement_lines(variant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Performance indexes on existing inventory tables
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inventory_levels_org_store
  ON inventory_levels(organization_id, store_id);

CREATE INDEX IF NOT EXISTS idx_inventory_levels_org_variant
  ON inventory_levels(organization_id, variant_id);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_org_created
  ON inventory_adjustments(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS — read for org members; writes via SECURITY DEFINER RPCs only
-- ---------------------------------------------------------------------------
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_movements_select ON stock_movements;
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_org_access(organization_id)
  );

DROP POLICY IF EXISTS stock_movement_lines_select ON stock_movement_lines;
CREATE POLICY stock_movement_lines_select ON stock_movement_lines FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_org_access(organization_id)
  );

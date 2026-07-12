-- SCM Wave 2: operations — lots, quality holds, cycle counting, MRP, procurement.

-- ---------------------------------------------------------------------------
-- Extend movement types
-- ---------------------------------------------------------------------------
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'cycle_count_adjustment';

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_lot_status') THEN
    CREATE TYPE inventory_lot_status AS ENUM ('available', 'quarantine', 'expired', 'consumed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quality_hold_status') THEN
    CREATE TYPE quality_hold_status AS ENUM ('active', 'released');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cycle_count_status') THEN
    CREATE TYPE cycle_count_status AS ENUM ('draft', 'in_progress', 'finalized', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'requisition_status') THEN
    CREATE TYPE requisition_status AS ENUM ('draft', 'submitted', 'approved', 'converted', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mrp_suggestion_source') THEN
    CREATE TYPE mrp_suggestion_source AS ENUM ('reorder_point', 'safety_stock', 'manufacturing', 'manual');
  END IF;
END $$;

ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'partially_received';

-- ---------------------------------------------------------------------------
-- Lot tracking flag on products
-- ---------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS track_lots BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Inventory lots & balances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_lots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  lot_number TEXT NOT NULL,
  expiry_date DATE,
  status inventory_lot_status NOT NULL DEFAULT 'available',
  source_type TEXT,
  source_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, lot_number)
);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_variant
  ON inventory_lots(variant_id, status);

CREATE TABLE IF NOT EXISTS lot_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES inventory_lots(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_lot_balances_org_store_variant
  ON lot_balances(organization_id, store_id, variant_id);

ALTER TABLE stock_movement_lines
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL;

ALTER TABLE inventory_cost_layers
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Quality holds
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quality_holds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL,
  status quality_hold_status NOT NULL DEFAULT 'active',
  reason TEXT NOT NULL,
  placed_by UUID REFERENCES auth.users(id),
  released_by UUID REFERENCES auth.users(id),
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_holds_active
  ON quality_holds(organization_id, store_id, variant_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Cycle counting
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_count_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status cycle_count_status NOT NULL DEFAULT 'draft',
  name TEXT NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  finalized_by UUID REFERENCES auth.users(id),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cycle_count_sessions_org
  ON cycle_count_sessions(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cycle_count_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES cycle_count_sessions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  expected_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  counted_qty NUMERIC(12,3),
  variance_qty NUMERIC(12,3),
  notes TEXT,
  counted_at TIMESTAMPTZ,
  UNIQUE (session_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_session
  ON cycle_count_lines(session_id);

-- ---------------------------------------------------------------------------
-- Purchase requisitions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status requisition_status NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_org
  ON purchase_requisitions(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requisition_id UUID NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  suggested_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  unit_cost_estimate NUMERIC(14,2),
  mrp_suggestion_id UUID,
  line_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchase_requisition_lines_req
  ON purchase_requisition_lines(requisition_id);

-- Partial PO receipt
ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS qty_received NUMERIC(12,3) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- MRP
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mrp_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  suggestion_count INT NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_mrp_runs_org
  ON mrp_runs(organization_id, run_at DESC);

CREATE TABLE IF NOT EXISTS mrp_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mrp_run_id UUID NOT NULL REFERENCES mrp_runs(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  source mrp_suggestion_source NOT NULL DEFAULT 'reorder_point',
  on_hand NUMERIC(12,3) NOT NULL DEFAULT 0,
  reorder_point NUMERIC(12,3) NOT NULL DEFAULT 0,
  suggested_qty NUMERIC(12,3) NOT NULL,
  preferred_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  is_dismissed BOOLEAN NOT NULL DEFAULT false,
  requisition_line_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mrp_suggestions_org_active
  ON mrp_suggestions(organization_id, store_id)
  WHERE NOT is_dismissed;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requisition_lines_mrp_suggestion_fkey'
  ) THEN
    ALTER TABLE purchase_requisition_lines
      ADD CONSTRAINT purchase_requisition_lines_mrp_suggestion_fkey
      FOREIGN KEY (mrp_suggestion_id) REFERENCES mrp_suggestions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mrp_suggestions_requisition_line_fkey'
  ) THEN
    ALTER TABLE mrp_suggestions
      ADD CONSTRAINT mrp_suggestions_requisition_line_fkey
      FOREIGN KEY (requisition_line_id) REFERENCES purchase_requisition_lines(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requisition_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrp_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrp_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_lots_select ON inventory_lots;
CREATE POLICY inventory_lots_select ON inventory_lots FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS inventory_lots_write ON inventory_lots;
CREATE POLICY inventory_lots_write ON inventory_lots FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS lot_balances_select ON lot_balances;
CREATE POLICY lot_balances_select ON lot_balances FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS lot_balances_deny ON lot_balances;
CREATE POLICY lot_balances_deny ON lot_balances FOR ALL USING (false);

DROP POLICY IF EXISTS quality_holds_select ON quality_holds;
CREATE POLICY quality_holds_select ON quality_holds FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS quality_holds_write ON quality_holds;
CREATE POLICY quality_holds_write ON quality_holds FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS cycle_count_sessions_select ON cycle_count_sessions;
CREATE POLICY cycle_count_sessions_select ON cycle_count_sessions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS cycle_count_sessions_write ON cycle_count_sessions;
CREATE POLICY cycle_count_sessions_write ON cycle_count_sessions FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS cycle_count_lines_select ON cycle_count_lines;
CREATE POLICY cycle_count_lines_select ON cycle_count_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS cycle_count_lines_write ON cycle_count_lines;
CREATE POLICY cycle_count_lines_write ON cycle_count_lines FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS purchase_requisitions_select ON purchase_requisitions;
CREATE POLICY purchase_requisitions_select ON purchase_requisitions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS purchase_requisitions_write ON purchase_requisitions;
CREATE POLICY purchase_requisitions_write ON purchase_requisitions FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS purchase_requisition_lines_select ON purchase_requisition_lines;
CREATE POLICY purchase_requisition_lines_select ON purchase_requisition_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS purchase_requisition_lines_write ON purchase_requisition_lines;
CREATE POLICY purchase_requisition_lines_write ON purchase_requisition_lines FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS mrp_runs_select ON mrp_runs;
CREATE POLICY mrp_runs_select ON mrp_runs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS mrp_runs_write ON mrp_runs;
CREATE POLICY mrp_runs_write ON mrp_runs FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS mrp_suggestions_select ON mrp_suggestions;
CREATE POLICY mrp_suggestions_select ON mrp_suggestions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS mrp_suggestions_write ON mrp_suggestions;
CREATE POLICY mrp_suggestions_write ON mrp_suggestions FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

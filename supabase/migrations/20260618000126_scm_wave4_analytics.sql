-- SCM Wave 4: analytics, forecasting, e-commerce sync foundation.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ecommerce_channel_type') THEN
    CREATE TYPE ecommerce_channel_type AS ENUM ('manual', 'shopify', 'woocommerce', 'custom');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ecommerce_sync_status') THEN
    CREATE TYPE ecommerce_sync_status AS ENUM ('pending', 'running', 'success', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forecast_method') THEN
    CREATE TYPE forecast_method AS ENUM ('moving_average', 'exponential_smoothing');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Daily inventory snapshots (trend / turnover history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_daily_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT current_date,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  inventory_value NUMERIC(16,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, variant_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_org_date
  ON inventory_daily_snapshots(organization_id, snapshot_date DESC);

-- ---------------------------------------------------------------------------
-- Demand forecasting
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_forecast_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  method forecast_method NOT NULL DEFAULT 'moving_average',
  history_days INT NOT NULL DEFAULT 90,
  horizon_days INT NOT NULL DEFAULT 30,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  line_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_inventory_forecast_runs_org
  ON inventory_forecast_runs(organization_id, run_at DESC);

CREATE TABLE IF NOT EXISTS inventory_forecast_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  forecast_run_id UUID NOT NULL REFERENCES inventory_forecast_runs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  avg_daily_demand NUMERIC(12,4) NOT NULL DEFAULT 0,
  forecast_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  on_hand NUMERIC(12,3) NOT NULL DEFAULT 0,
  days_of_supply NUMERIC(10,2),
  abc_class TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_forecast_lines_run
  ON inventory_forecast_lines(forecast_run_id);

-- ---------------------------------------------------------------------------
-- E-commerce channel sync
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ecommerce_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel_type ecommerce_channel_type NOT NULL DEFAULT 'manual',
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_channels_org
  ON ecommerce_channels(organization_id, is_active);

CREATE TABLE IF NOT EXISTS ecommerce_product_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES ecommerce_channels(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  external_sku TEXT,
  external_id TEXT,
  sync_inventory BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_mappings_channel
  ON ecommerce_product_mappings(channel_id);

CREATE TABLE IF NOT EXISTS ecommerce_sync_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES ecommerce_channels(id) ON DELETE CASCADE,
  status ecommerce_sync_status NOT NULL DEFAULT 'pending',
  items_synced INT NOT NULL DEFAULT 0,
  payload JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_sync_runs_channel
  ON ecommerce_sync_runs(channel_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_forecast_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_forecast_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_daily_snapshots_select ON inventory_daily_snapshots;
CREATE POLICY inventory_daily_snapshots_select ON inventory_daily_snapshots FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS inventory_daily_snapshots_deny ON inventory_daily_snapshots;
CREATE POLICY inventory_daily_snapshots_deny ON inventory_daily_snapshots FOR ALL USING (false);

DROP POLICY IF EXISTS inventory_forecast_runs_select ON inventory_forecast_runs;
CREATE POLICY inventory_forecast_runs_select ON inventory_forecast_runs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS inventory_forecast_runs_write ON inventory_forecast_runs;
CREATE POLICY inventory_forecast_runs_write ON inventory_forecast_runs FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS inventory_forecast_lines_select ON inventory_forecast_lines;
CREATE POLICY inventory_forecast_lines_select ON inventory_forecast_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS inventory_forecast_lines_deny ON inventory_forecast_lines;
CREATE POLICY inventory_forecast_lines_deny ON inventory_forecast_lines FOR ALL USING (false);

DROP POLICY IF EXISTS ecommerce_channels_select ON ecommerce_channels;
CREATE POLICY ecommerce_channels_select ON ecommerce_channels FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS ecommerce_channels_write ON ecommerce_channels;
CREATE POLICY ecommerce_channels_write ON ecommerce_channels FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS ecommerce_product_mappings_select ON ecommerce_product_mappings;
CREATE POLICY ecommerce_product_mappings_select ON ecommerce_product_mappings FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS ecommerce_product_mappings_write ON ecommerce_product_mappings;
CREATE POLICY ecommerce_product_mappings_write ON ecommerce_product_mappings FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

DROP POLICY IF EXISTS ecommerce_sync_runs_select ON ecommerce_sync_runs;
CREATE POLICY ecommerce_sync_runs_select ON ecommerce_sync_runs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS ecommerce_sync_runs_write ON ecommerce_sync_runs;
CREATE POLICY ecommerce_sync_runs_write ON ecommerce_sync_runs FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

-- EFM Wave 9 — FP&A (scenarios, rolling forecast) schema

-- ---------------------------------------------------------------------------
-- Planning scenarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fpa_scenarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scenario_type TEXT NOT NULL DEFAULT 'custom'
    CHECK (scenario_type IN ('baseline', 'optimistic', 'pessimistic', 'custom')),
  is_baseline BOOLEAN NOT NULL DEFAULT false,
  revenue_adjustment_pct NUMERIC(8,4) NOT NULL DEFAULT 0,
  expense_adjustment_pct NUMERIC(8,4) NOT NULL DEFAULT 0,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_fpa_scenarios_org ON fpa_scenarios(organization_id);

ALTER TABLE fpa_scenarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fpa_scenarios_select ON fpa_scenarios;
CREATE POLICY fpa_scenarios_select ON fpa_scenarios FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS fpa_scenarios_write ON fpa_scenarios;
CREATE POLICY fpa_scenarios_write ON fpa_scenarios FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Rolling forecast runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fpa_rolling_forecasts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES fpa_scenarios(id),
  name TEXT NOT NULL,
  as_of_date DATE NOT NULL DEFAULT current_date,
  horizon_months INT NOT NULL DEFAULT 12 CHECK (horizon_months BETWEEN 1 AND 36),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'superseded')),
  budget_id UUID REFERENCES budgets(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fpa_rolling_forecasts_org
  ON fpa_rolling_forecasts(organization_id, created_at DESC);

ALTER TABLE fpa_rolling_forecasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fpa_rolling_forecasts_select ON fpa_rolling_forecasts;
CREATE POLICY fpa_rolling_forecasts_select ON fpa_rolling_forecasts FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS fpa_rolling_forecasts_write ON fpa_rolling_forecasts;
CREATE POLICY fpa_rolling_forecasts_write ON fpa_rolling_forecasts FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Monthly forecast buckets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fpa_forecast_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  forecast_id UUID NOT NULL REFERENCES fpa_rolling_forecasts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  is_actual BOOLEAN NOT NULL DEFAULT false,
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  cogs NUMERIC(14,2) NOT NULL DEFAULT 0,
  operating_expenses NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  UNIQUE (forecast_id, period_month)
);
CREATE INDEX IF NOT EXISTS idx_fpa_forecast_periods_forecast
  ON fpa_forecast_periods(forecast_id, period_month);

ALTER TABLE fpa_forecast_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fpa_forecast_periods_select ON fpa_forecast_periods;
CREATE POLICY fpa_forecast_periods_select ON fpa_forecast_periods FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS fpa_forecast_periods_write ON fpa_forecast_periods;
CREATE POLICY fpa_forecast_periods_write ON fpa_forecast_periods FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

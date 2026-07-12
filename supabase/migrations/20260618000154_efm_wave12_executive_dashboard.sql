-- EFM Wave 12 — Executive dashboards & drill-down schema

-- ---------------------------------------------------------------------------
-- KPI targets for executive scorecard
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.executive_kpi_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kpi_key TEXT NOT NULL
    CHECK (kpi_key IN ('revenue', 'net_profit', 'cash', 'ar', 'ap', 'liquid', 'tax_payable', 'gross_profit')),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  target_value NUMERIC(14,2) NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from),
  UNIQUE (organization_id, kpi_key, period_from, period_to)
);
CREATE INDEX IF NOT EXISTS idx_executive_kpi_targets_org
  ON executive_kpi_targets(organization_id, period_to DESC);

ALTER TABLE executive_kpi_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS executive_kpi_targets_select ON executive_kpi_targets;
CREATE POLICY executive_kpi_targets_select ON executive_kpi_targets FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS executive_kpi_targets_write ON executive_kpi_targets;
CREATE POLICY executive_kpi_targets_write ON executive_kpi_targets FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Saved executive dashboard layouts (widget visibility/order)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.executive_dashboard_layouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_executive_dashboard_layouts_default
  ON executive_dashboard_layouts(organization_id)
  WHERE is_default;

ALTER TABLE executive_dashboard_layouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS executive_dashboard_layouts_select ON executive_dashboard_layouts;
CREATE POLICY executive_dashboard_layouts_select ON executive_dashboard_layouts FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS executive_dashboard_layouts_write ON executive_dashboard_layouts;
CREATE POLICY executive_dashboard_layouts_write ON executive_dashboard_layouts FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- EFM Wave 15 — Financial performance (report cache, partition policies, archive)

-- ---------------------------------------------------------------------------
-- Org-level performance controls
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS financial_cache_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS financial_cache_ttl_minutes INT NOT NULL DEFAULT 60
    CHECK (financial_cache_ttl_minutes >= 5 AND financial_cache_ttl_minutes <= 1440),
  ADD COLUMN IF NOT EXISTS financial_prefer_read_replica BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- Financial report result cache
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_report_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  report_type TEXT NOT NULL,
  period_from DATE,
  period_to DATE,
  as_of DATE,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  UNIQUE (organization_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_financial_report_cache_org_expires
  ON financial_report_cache(organization_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_report_cache_org_type
  ON financial_report_cache(organization_id, report_type, computed_at DESC);

ALTER TABLE financial_report_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_report_cache_select ON financial_report_cache;
CREATE POLICY financial_report_cache_select ON financial_report_cache FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS financial_report_cache_write ON financial_report_cache;
CREATE POLICY financial_report_cache_write ON financial_report_cache FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Partition / retention policies (metadata — ops orchestration)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_partition_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('brin_index', 'monthly_range', 'archive')),
  retention_months INT NOT NULL DEFAULT 84 CHECK (retention_months >= 12),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_maintenance_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, table_name)
);

CREATE INDEX IF NOT EXISTS idx_financial_partition_policies_org
  ON financial_partition_policies(organization_id, is_active);

ALTER TABLE financial_partition_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_partition_policies_select ON financial_partition_policies;
CREATE POLICY financial_partition_policies_select ON financial_partition_policies FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS financial_partition_policies_write ON financial_partition_policies;
CREATE POLICY financial_partition_policies_write ON financial_partition_policies FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Cold GL archive tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entries_archive (
  LIKE public.journal_entries INCLUDING DEFAULTS,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archive_month DATE
);

CREATE INDEX IF NOT EXISTS idx_je_archive_org_date
  ON journal_entries_archive(organization_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_je_archive_month
  ON journal_entries_archive(archive_month);

CREATE TABLE IF NOT EXISTS public.journal_entry_lines_archive (
  LIKE public.journal_entry_lines INCLUDING DEFAULTS,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jel_archive_entry
  ON journal_entry_lines_archive(entry_id);

ALTER TABLE public.journal_entries_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS je_archive_select ON journal_entries_archive;
CREATE POLICY je_archive_select ON journal_entries_archive FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS jel_archive_select ON journal_entry_lines_archive;
CREATE POLICY jel_archive_select ON journal_entry_lines_archive FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

-- ---------------------------------------------------------------------------
-- Scale indexes for time-range GL scans
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_je_entry_date_brin
  ON public.journal_entries USING BRIN (entry_date)
  WITH (pages_per_range = 128);

CREATE INDEX IF NOT EXISTS idx_jel_org_entry
  ON public.journal_entry_lines(organization_id, entry_id);

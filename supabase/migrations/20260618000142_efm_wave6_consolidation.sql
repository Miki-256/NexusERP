-- EFM Wave 6 — Consolidation & intercompany schema

-- ---------------------------------------------------------------------------
-- Consolidation group enhancements
-- ---------------------------------------------------------------------------
ALTER TABLE public.consolidation_groups
  ADD COLUMN IF NOT EXISTS reporting_currency TEXT,
  ADD COLUMN IF NOT EXISTS elimination_method TEXT NOT NULL DEFAULT 'virtual'
    CHECK (elimination_method IN ('virtual', 'posted'));

ALTER TABLE public.consolidation_group_members
  ADD COLUMN IF NOT EXISTS ownership_percent NUMERIC(5,2) NOT NULL DEFAULT 100
    CHECK (ownership_percent > 0 AND ownership_percent <= 100),
  ADD COLUMN IF NOT EXISTS member_role TEXT NOT NULL DEFAULT 'subsidiary'
    CHECK (member_role IN ('parent', 'subsidiary', 'associate'));

-- ---------------------------------------------------------------------------
-- Intercompany relationships (managed by parent org)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.intercompany_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  to_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receivable_account_id UUID REFERENCES accounts(id),
  payable_account_id UUID REFERENCES accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, from_org_id, to_org_id),
  CHECK (from_org_id <> to_org_id)
);
CREATE INDEX IF NOT EXISTS idx_intercompany_relationships_org
  ON intercompany_relationships(organization_id, from_org_id, to_org_id);

ALTER TABLE intercompany_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS intercompany_relationships_select ON intercompany_relationships;
CREATE POLICY intercompany_relationships_select ON intercompany_relationships FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS intercompany_relationships_write ON intercompany_relationships;
CREATE POLICY intercompany_relationships_write ON intercompany_relationships FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Intercompany transactions (paired AR/AP tracking)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.intercompany_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  to_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL DEFAULT current_date,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'matched', 'eliminated', 'cancelled')),
  from_journal_entry_id UUID REFERENCES journal_entries(id),
  to_journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_org_id <> to_org_id)
);
CREATE INDEX IF NOT EXISTS idx_intercompany_tx_org
  ON intercompany_transactions(organization_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_intercompany_tx_pair
  ON intercompany_transactions(from_org_id, to_org_id, status);

ALTER TABLE intercompany_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS intercompany_transactions_select ON intercompany_transactions;
CREATE POLICY intercompany_transactions_select ON intercompany_transactions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS intercompany_transactions_write ON intercompany_transactions;
CREATE POLICY intercompany_transactions_write ON intercompany_transactions FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Consolidation run audit (virtual elimination snapshots)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consolidation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES consolidation_groups(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL CHECK (run_type IN ('balance_sheet', 'profit_and_loss')),
  period_from DATE,
  period_to DATE,
  as_of_date DATE,
  reporting_currency TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consolidation_runs_group
  ON consolidation_runs(group_id, created_at DESC);

ALTER TABLE consolidation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consolidation_runs_select ON consolidation_runs;
CREATE POLICY consolidation_runs_select ON consolidation_runs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS consolidation_runs_write ON consolidation_runs;
CREATE POLICY consolidation_runs_write ON consolidation_runs FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

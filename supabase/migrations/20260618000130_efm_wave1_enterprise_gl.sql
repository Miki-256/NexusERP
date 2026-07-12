-- EFM Wave 1 — Enterprise GL schema (hierarchical COA, JE lifecycle, attachments, allocations)

-- ---------------------------------------------------------------------------
-- Chart of accounts hierarchy
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS parent_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_postable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_accounts_parent
  ON public.accounts(organization_id, parent_account_id);

-- ---------------------------------------------------------------------------
-- Journal entry reversal links
-- ---------------------------------------------------------------------------
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS reversal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_je_reversal
  ON public.journal_entries(reversed_entry_id)
  WHERE reversed_entry_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Journal entry attachments (metadata; file stored via documents / external URL)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entry_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_je_attachments_entry ON journal_entry_attachments(entry_id);

ALTER TABLE journal_entry_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS je_attachments_select ON journal_entry_attachments;
CREATE POLICY je_attachments_select ON journal_entry_attachments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS je_attachments_write ON journal_entry_attachments;
CREATE POLICY je_attachments_write ON journal_entry_attachments FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Immutable journal entry audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entry_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_je_audit_entry ON journal_entry_audit_log(entry_id, created_at DESC);

ALTER TABLE journal_entry_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS je_audit_select ON journal_entry_audit_log;
CREATE POLICY je_audit_select ON journal_entry_audit_log FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS je_audit_insert ON journal_entry_audit_log;
CREATE POLICY je_audit_insert ON journal_entry_audit_log FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

-- ---------------------------------------------------------------------------
-- Allocation rules (spread one source amount across target accounts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.allocation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  journal_code TEXT NOT NULL DEFAULT 'GEN',
  source_account_id UUID NOT NULL REFERENCES accounts(id),
  allocation_basis TEXT NOT NULL DEFAULT 'percent'
    CHECK (allocation_basis IN ('percent', 'equal')),
  targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_allocation_rules_org ON allocation_rules(organization_id);

ALTER TABLE allocation_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allocation_rules_select ON allocation_rules;
CREATE POLICY allocation_rules_select ON allocation_rules FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS allocation_rules_write ON allocation_rules;
CREATE POLICY allocation_rules_write ON allocation_rules FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Recurring journals — auto-reversal support (accruals)
-- ---------------------------------------------------------------------------
ALTER TABLE public.recurring_journal_templates
  ADD COLUMN IF NOT EXISTS auto_reverse BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reversal_days INT NOT NULL DEFAULT 1;

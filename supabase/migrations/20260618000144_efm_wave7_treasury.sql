-- EFM Wave 7 — Treasury & advanced banking schema

-- ---------------------------------------------------------------------------
-- Bank account treasury metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'operating'
    CHECK (account_type IN ('operating', 'savings', 'petty_cash', 'mobile_wallet')),
  ADD COLUMN IF NOT EXISTS target_balance NUMERIC(14,2) CHECK (target_balance IS NULL OR target_balance >= 0),
  ADD COLUMN IF NOT EXISTS minimum_balance NUMERIC(14,2) CHECK (minimum_balance IS NULL OR minimum_balance >= 0);

-- ---------------------------------------------------------------------------
-- Internal treasury transfers between bank accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.treasury_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
  to_bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
  transfer_date DATE NOT NULL DEFAULT current_date,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference TEXT,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('draft', 'posted', 'cancelled')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_bank_account_id <> to_bank_account_id)
);
CREATE INDEX IF NOT EXISTS idx_treasury_transfers_org
  ON treasury_transfers(organization_id, transfer_date DESC);

ALTER TABLE treasury_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS treasury_transfers_select ON treasury_transfers;
CREATE POLICY treasury_transfers_select ON treasury_transfers FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS treasury_transfers_write ON treasury_transfers;
CREATE POLICY treasury_transfers_write ON treasury_transfers FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

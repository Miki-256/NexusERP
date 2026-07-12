-- EFM Wave 5 — Multi-currency & FX revaluation schema

-- ---------------------------------------------------------------------------
-- Org multi-currency flag
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS multi_currency_enabled BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Exchange rates (foreign currency → functional / org.currency)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  currency_code TEXT NOT NULL CHECK (char_length(trim(currency_code)) = 3),
  rate_date DATE NOT NULL,
  rate NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  rate_type TEXT NOT NULL DEFAULT 'spot'
    CHECK (rate_type IN ('spot', 'month_end', 'average')),
  source TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, currency_code, rate_date, rate_type)
);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_org_date
  ON exchange_rates(organization_id, currency_code, rate_date DESC);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exchange_rates_select ON exchange_rates;
CREATE POLICY exchange_rates_select ON exchange_rates FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS exchange_rates_write ON exchange_rates;
CREATE POLICY exchange_rates_write ON exchange_rates FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Account / journal FX fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS currency_code TEXT CHECK (currency_code IS NULL OR char_length(trim(currency_code)) = 3);

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS transaction_currency TEXT CHECK (transaction_currency IS NULL OR char_length(trim(transaction_currency)) = 3),
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8) CHECK (exchange_rate IS NULL OR exchange_rate > 0);

ALTER TABLE public.journal_entry_lines
  ADD COLUMN IF NOT EXISTS transaction_currency TEXT CHECK (transaction_currency IS NULL OR char_length(trim(transaction_currency)) = 3),
  ADD COLUMN IF NOT EXISTS transaction_debit NUMERIC(14,2) CHECK (transaction_debit IS NULL OR transaction_debit >= 0),
  ADD COLUMN IF NOT EXISTS transaction_credit NUMERIC(14,2) CHECK (transaction_credit IS NULL OR transaction_credit >= 0),
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8) CHECK (exchange_rate IS NULL OR exchange_rate > 0);

-- ---------------------------------------------------------------------------
-- FX revaluation runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fx_revaluation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  as_of_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  total_gain NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_loss NUMERIC(14,2) NOT NULL DEFAULT 0,
  memo TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_fx_revaluation_runs_org
  ON fx_revaluation_runs(organization_id, as_of_date DESC);

ALTER TABLE fx_revaluation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_revaluation_runs_select ON fx_revaluation_runs;
CREATE POLICY fx_revaluation_runs_select ON fx_revaluation_runs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS fx_revaluation_runs_write ON fx_revaluation_runs;
CREATE POLICY fx_revaluation_runs_write ON fx_revaluation_runs FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE TABLE IF NOT EXISTS public.fx_revaluation_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES fx_revaluation_runs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  currency_code TEXT NOT NULL,
  foreign_balance NUMERIC(14,2) NOT NULL,
  book_balance NUMERIC(14,2) NOT NULL,
  closing_rate NUMERIC(18,8) NOT NULL,
  translated_balance NUMERIC(14,2) NOT NULL,
  adjustment NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fx_revaluation_lines_run ON fx_revaluation_lines(run_id);

ALTER TABLE fx_revaluation_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_revaluation_lines_select ON fx_revaluation_lines;
CREATE POLICY fx_revaluation_lines_select ON fx_revaluation_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS fx_revaluation_lines_write ON fx_revaluation_lines;
CREATE POLICY fx_revaluation_lines_write ON fx_revaluation_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

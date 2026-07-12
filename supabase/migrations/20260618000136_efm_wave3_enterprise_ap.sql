-- EFM Wave 3 — Enterprise AP schema
-- Requires 00135 (bill_status enum) applied first.

-- ---------------------------------------------------------------------------
-- Vendor payment terms
-- ---------------------------------------------------------------------------
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS payment_terms_days INT NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  ADD COLUMN IF NOT EXISTS early_pay_discount_percent NUMERIC(5,2) CHECK (early_pay_discount_percent IS NULL OR early_pay_discount_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS early_pay_discount_days INT CHECK (early_pay_discount_days IS NULL OR early_pay_discount_days >= 0);

-- ---------------------------------------------------------------------------
-- Vendor bill open balance + match metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.vendor_bills
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  ADD COLUMN IF NOT EXISTS match_status TEXT NOT NULL DEFAULT 'standalone'
    CHECK (match_status IN ('standalone', 'two_way', 'three_way', 'exception', 'unmatched')),
  ADD COLUMN IF NOT EXISTS duplicate_hash TEXT,
  ADD COLUMN IF NOT EXISTS memo TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'po_receipt'
    CHECK (source_type IN ('po_receipt', 'manual'));

CREATE INDEX IF NOT EXISTS idx_vendor_bills_open_ap
  ON public.vendor_bills(organization_id, vendor_id)
  WHERE status IN ('open', 'partially_paid');

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_bills_dup_hash
  ON public.vendor_bills(organization_id, duplicate_hash)
  WHERE duplicate_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Standalone bill lines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_bill_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id UUID NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  account_id UUID REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_bill_lines_bill ON vendor_bill_lines(bill_id);

ALTER TABLE vendor_bill_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_bill_lines_select ON vendor_bill_lines;
CREATE POLICY vendor_bill_lines_select ON vendor_bill_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS vendor_bill_lines_write ON vendor_bill_lines;
CREATE POLICY vendor_bill_lines_write ON vendor_bill_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Bill payment applications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_bill_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL DEFAULT current_date,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method payment_method NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  payment_run_id UUID,
  reference TEXT,
  discount_taken NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_taken >= 0),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_bill_payments_bill ON vendor_bill_payments(bill_id, payment_date DESC);

ALTER TABLE vendor_bill_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_bill_payments_select ON vendor_bill_payments;
CREATE POLICY vendor_bill_payments_select ON vendor_bill_payments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS vendor_bill_payments_write ON vendor_bill_payments;
CREATE POLICY vendor_bill_payments_write ON vendor_bill_payments FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Payment runs (batch AP)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ap_payment_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_date DATE NOT NULL DEFAULT current_date,
  payment_method payment_method NOT NULL DEFAULT 'bank_transfer',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'executed', 'cancelled')),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  memo TEXT,
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ap_payment_runs_org ON ap_payment_runs(organization_id, run_date DESC);

CREATE TABLE IF NOT EXISTS public.ap_payment_run_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES ap_payment_runs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES vendor_bills(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  UNIQUE (run_id, bill_id)
);
CREATE INDEX IF NOT EXISTS idx_ap_run_lines_run ON ap_payment_run_lines(run_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_bill_payments_run_fk'
  ) THEN
    ALTER TABLE vendor_bill_payments
      ADD CONSTRAINT vendor_bill_payments_run_fk
      FOREIGN KEY (payment_run_id) REFERENCES ap_payment_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE ap_payment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_payment_run_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ap_payment_runs_select ON ap_payment_runs;
CREATE POLICY ap_payment_runs_select ON ap_payment_runs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS ap_payment_runs_write ON ap_payment_runs;
CREATE POLICY ap_payment_runs_write ON ap_payment_runs FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS ap_payment_run_lines_select ON ap_payment_run_lines;
CREATE POLICY ap_payment_run_lines_select ON ap_payment_run_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS ap_payment_run_lines_write ON ap_payment_run_lines;
CREATE POLICY ap_payment_run_lines_write ON ap_payment_run_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
UPDATE vendor_bills
SET amount_paid = amount
WHERE status = 'paid' AND amount_paid = 0;

UPDATE vendor_bills
SET match_status = 'three_way', source_type = 'po_receipt'
WHERE po_id IS NOT NULL AND match_status = 'standalone';

UPDATE vendor_bills
SET source_type = 'po_receipt'
WHERE po_id IS NOT NULL AND source_type IS DISTINCT FROM 'manual';

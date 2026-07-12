-- EFM Wave 2 — Enterprise AR schema (open balance subledger, dunning, collections)
-- Requires 00132 (invoice_status enum) applied first.

-- ---------------------------------------------------------------------------
-- Customer payment terms + dunning policy link
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS payment_terms_days INT NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0);

-- ---------------------------------------------------------------------------
-- Invoice open balance tracking
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_invoices
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  ADD COLUMN IF NOT EXISTS amount_credited NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_credited >= 0),
  ADD COLUMN IF NOT EXISTS collection_status TEXT NOT NULL DEFAULT 'open'
    CHECK (collection_status IN ('open', 'promised', 'dispute', 'in_collections', 'written_off')),
  ADD COLUMN IF NOT EXISTS dunning_level INT NOT NULL DEFAULT 0 CHECK (dunning_level >= 0);

CREATE INDEX IF NOT EXISTS idx_invoices_open_ar
  ON public.customer_invoices(organization_id, customer_id)
  WHERE status IN ('posted', 'partially_paid');

-- ---------------------------------------------------------------------------
-- Credit note application tracking
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_credit_notes
  ADD COLUMN IF NOT EXISTS amount_applied NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_applied >= 0);

-- ---------------------------------------------------------------------------
-- Invoice payment applications (subledger)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_invoice_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL DEFAULT current_date,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method payment_method NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  reference TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_payments_invoice ON customer_invoice_payments(invoice_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_payments_org ON customer_invoice_payments(organization_id, payment_date DESC);

ALTER TABLE customer_invoice_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_payments_select ON customer_invoice_payments;
CREATE POLICY inv_payments_select ON customer_invoice_payments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS inv_payments_write ON customer_invoice_payments;
CREATE POLICY inv_payments_write ON customer_invoice_payments FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Credit note → invoice allocations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_credit_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  credit_note_id UUID NOT NULL REFERENCES customer_credit_notes(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_alloc_invoice ON customer_credit_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_alloc_cn ON customer_credit_allocations(credit_note_id);

ALTER TABLE customer_credit_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_alloc_select ON customer_credit_allocations;
CREATE POLICY credit_alloc_select ON customer_credit_allocations FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS credit_alloc_write ON customer_credit_allocations;
CREATE POLICY credit_alloc_write ON customer_credit_allocations FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Dunning policies & levels
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ar_dunning_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  grace_days INT NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_dunning_policy_org ON ar_dunning_policies(organization_id);

CREATE TABLE IF NOT EXISTS public.ar_dunning_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id UUID NOT NULL REFERENCES ar_dunning_policies(id) ON DELETE CASCADE,
  level_no INT NOT NULL CHECK (level_no > 0),
  days_overdue INT NOT NULL CHECK (days_overdue >= 0),
  template_code TEXT NOT NULL DEFAULT 'accounting.invoice_reminder',
  description TEXT,
  UNIQUE (policy_id, level_no),
  UNIQUE (policy_id, days_overdue)
);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS ar_dunning_policy_id UUID REFERENCES ar_dunning_policies(id) ON DELETE SET NULL;

ALTER TABLE ar_dunning_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_dunning_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dunning_policy_select ON ar_dunning_policies;
CREATE POLICY dunning_policy_select ON ar_dunning_policies FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS dunning_policy_write ON ar_dunning_policies;
CREATE POLICY dunning_policy_write ON ar_dunning_policies FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS dunning_level_select ON ar_dunning_levels;
CREATE POLICY dunning_level_select ON ar_dunning_levels FOR SELECT
  USING (
    policy_id IN (
      SELECT id FROM ar_dunning_policies
      WHERE organization_id IN (SELECT public.user_organization_ids())
    )
  );
DROP POLICY IF EXISTS dunning_level_write ON ar_dunning_levels;
CREATE POLICY dunning_level_write ON ar_dunning_levels FOR ALL
  USING (
    policy_id IN (
      SELECT id FROM ar_dunning_policies
      WHERE organization_id IN (SELECT public.user_organization_ids())
        AND public.user_can_manage(organization_id)
    )
  )
  WITH CHECK (
    policy_id IN (
      SELECT id FROM ar_dunning_policies
      WHERE organization_id IN (SELECT public.user_organization_ids())
        AND public.user_can_manage(organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Dunning event log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ar_dunning_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  policy_id UUID REFERENCES ar_dunning_policies(id),
  level_no INT NOT NULL,
  channel TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by UUID REFERENCES auth.users(id),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_dunning_events_invoice ON ar_dunning_events(invoice_id, sent_at DESC);

ALTER TABLE ar_dunning_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dunning_events_select ON ar_dunning_events;
CREATE POLICY dunning_events_select ON ar_dunning_events FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS dunning_events_write ON ar_dunning_events;
CREATE POLICY dunning_events_write ON ar_dunning_events FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Backfill open balance fields
-- ---------------------------------------------------------------------------
UPDATE customer_invoices
SET amount_paid = total
WHERE status = 'paid' AND amount_paid = 0;

UPDATE customer_invoices
SET collection_status = 'open'
WHERE collection_status IS NULL;

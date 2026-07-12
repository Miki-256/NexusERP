-- EFM Wave 8 — Tax compliance & e-invoicing schema

-- ---------------------------------------------------------------------------
-- Organization tax / e-invoicing settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS einvoice_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS einvoice_provider TEXT NOT NULL DEFAULT 'internal'
    CHECK (einvoice_provider IN ('internal', 'peppol', 'ethiopia_erca')),
  ADD COLUMN IF NOT EXISTS tax_filing_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (tax_filing_frequency IN ('monthly', 'quarterly', 'annual'));

-- ---------------------------------------------------------------------------
-- Extended tax codes (output / input / withholding)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tax_codes
  ADD COLUMN IF NOT EXISTS tax_type TEXT NOT NULL DEFAULT 'output'
    CHECK (tax_type IN ('output', 'input', 'withholding')),
  ADD COLUMN IF NOT EXISTS jurisdiction TEXT,
  ADD COLUMN IF NOT EXISTS is_recoverable BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- AP input tax on vendor bill lines
-- ---------------------------------------------------------------------------
ALTER TABLE public.vendor_bill_lines
  ADD COLUMN IF NOT EXISTS tax_code_id UUID REFERENCES tax_codes(id),
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.vendor_bills
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- VAT / tax return periods
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_return_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  return_type TEXT NOT NULL DEFAULT 'vat'
    CHECK (return_type IN ('vat', 'withholding')),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'filed', 'paid', 'cancelled')),
  output_tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  input_tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  filed_at TIMESTAMPTZ,
  filed_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from),
  UNIQUE (organization_id, return_type, period_from, period_to)
);
CREATE INDEX IF NOT EXISTS idx_tax_return_periods_org
  ON tax_return_periods(organization_id, period_to DESC);

ALTER TABLE tax_return_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_return_periods_select ON tax_return_periods;
CREATE POLICY tax_return_periods_select ON tax_return_periods FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS tax_return_periods_write ON tax_return_periods;
CREATE POLICY tax_return_periods_write ON tax_return_periods FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- E-invoice submission log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.einvoice_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('customer_invoice', 'customer_credit_note')),
  source_id UUID NOT NULL,
  document_number TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'accepted', 'rejected', 'cancelled')),
  external_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response JSONB,
  error_message TEXT,
  submitted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_einvoice_documents_org
  ON einvoice_documents(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_einvoice_documents_source
  ON einvoice_documents(organization_id, source_type, source_id);

ALTER TABLE einvoice_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS einvoice_documents_select ON einvoice_documents;
CREATE POLICY einvoice_documents_select ON einvoice_documents FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS einvoice_documents_write ON einvoice_documents;
CREATE POLICY einvoice_documents_write ON einvoice_documents FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Withholding tax rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.withholding_tax_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rate NUMERIC(8,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  applies_to TEXT NOT NULL DEFAULT 'vendor_payments'
    CHECK (applies_to IN ('vendor_payments', 'customer_invoices')),
  liability_account_id UUID REFERENCES accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_withholding_tax_rules_org
  ON withholding_tax_rules(organization_id);

ALTER TABLE withholding_tax_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS withholding_tax_rules_select ON withholding_tax_rules;
CREATE POLICY withholding_tax_rules_select ON withholding_tax_rules FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS withholding_tax_rules_write ON withholding_tax_rules;
CREATE POLICY withholding_tax_rules_write ON withholding_tax_rules FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

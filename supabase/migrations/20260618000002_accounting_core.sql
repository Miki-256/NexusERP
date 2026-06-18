-- Phase 1: Accounting core (double-entry) + Expenses
-- Fixes audit finding F3: real P&L that includes operating expenses.
-- Adds a chart of accounts, journals, double-entry journal entries, an Expenses
-- module that posts to the ledger, and financial-statement functions.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN
    CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_type') THEN
    CREATE TYPE journal_type AS ENUM ('sales', 'purchase', 'cash', 'bank', 'general');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type account_type NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_accounts_org ON accounts(organization_id);

-- Journals
CREATE TABLE IF NOT EXISTS journals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type journal_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_journals_org ON journals(organization_id);

-- Journal entries (balanced header) + lines
CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  journal_id UUID NOT NULL REFERENCES journals(id),
  entry_date DATE NOT NULL DEFAULT current_date,
  memo TEXT,
  reference TEXT,
  source_type TEXT,                 -- 'sale' | 'expense' | 'refund' | 'manual'
  source_id UUID,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_je_org_date ON journal_entries(organization_id, entry_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_je_source
  ON journal_entries(organization_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description TEXT,
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX IF NOT EXISTS idx_jel_entry ON journal_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_id);

-- ---------------------------------------------------------------------------
-- Expenses module
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_id UUID REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  vendor_name TEXT,
  description TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method payment_method NOT NULL DEFAULT 'cash',
  expense_date DATE NOT NULL DEFAULT current_date,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_org_date ON expenses(organization_id, expense_date DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Read for org members; writes for managers (ledger writes happen via SECURITY DEFINER fns).
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY accounts_write ON accounts FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY journals_select ON journals FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY journals_write ON journals FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY je_select ON journal_entries FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY jel_select ON journal_entry_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY expcat_select ON expense_categories FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY expcat_write ON expense_categories FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY expenses_select ON expenses FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

-- ---------------------------------------------------------------------------
-- Seed a standard chart of accounts + journals for an organization (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_accounts(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO accounts (organization_id, code, name, type) VALUES
    (p_org_id, '1000', 'Cash on Hand',        'asset'),
    (p_org_id, '1010', 'Bank',                'asset'),
    (p_org_id, '1020', 'Mobile Money',        'asset'),
    (p_org_id, '1100', 'Accounts Receivable', 'asset'),
    (p_org_id, '1200', 'Inventory',           'asset'),
    (p_org_id, '2000', 'Accounts Payable',    'liability'),
    (p_org_id, '2100', 'Tax Payable',         'liability'),
    (p_org_id, '3000', 'Owner Equity',        'equity'),
    (p_org_id, '3900', 'Retained Earnings',   'equity'),
    (p_org_id, '4000', 'Sales Revenue',       'income'),
    (p_org_id, '5000', 'Cost of Goods Sold',  'expense'),
    (p_org_id, '6000', 'Operating Expenses',  'expense'),
    (p_org_id, '6100', 'Rent',                'expense'),
    (p_org_id, '6200', 'Utilities',           'expense'),
    (p_org_id, '6300', 'Maintenance',         'expense'),
    (p_org_id, '6400', 'Salaries',            'expense')
  ON CONFLICT (organization_id, code) DO NOTHING;

  INSERT INTO journals (organization_id, code, name, type) VALUES
    (p_org_id, 'SAL', 'Sales',     'sales'),
    (p_org_id, 'PUR', 'Purchases', 'purchase'),
    (p_org_id, 'CSH', 'Cash',      'cash'),
    (p_org_id, 'BNK', 'Bank',      'bank'),
    (p_org_id, 'GEN', 'General',   'general')
  ON CONFLICT (organization_id, code) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_accounts TO authenticated;

-- Helper to resolve an account id by code
CREATE OR REPLACE FUNCTION public.account_id_by_code(p_org_id UUID, p_code TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM accounts WHERE organization_id = p_org_id AND code = p_code;
$$;

-- ---------------------------------------------------------------------------
-- Post a balanced manual journal entry. p_lines: [{accountId, debit, credit, description}]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_org_id UUID,
  p_journal_code TEXT,
  p_date DATE,
  p_memo TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journal_id UUID;
  v_entry_id UUID;
  v_line JSONB;
  v_debits NUMERIC := 0;
  v_credits NUMERIC := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT id INTO v_journal_id FROM journals WHERE organization_id = p_org_id AND code = p_journal_code;
  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'Journal % not found', p_journal_code;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_debits  := v_debits  + COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_credits := v_credits + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF abs(v_debits - v_credits) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry not balanced: debits % vs credits %', v_debits, v_credits;
  END IF;

  INSERT INTO journal_entries (organization_id, journal_id, entry_date, memo, source_type, source_id, created_by)
  VALUES (p_org_id, v_journal_id, COALESCE(p_date, current_date), p_memo, p_source_type, p_source_id, auth.uid())
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO journal_entry_lines (entry_id, organization_id, account_id, debit, credit, description)
    VALUES (
      v_entry_id, p_org_id,
      (v_line->>'accountId')::UUID,
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description'
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_journal_entry TO authenticated;

-- ---------------------------------------------------------------------------
-- Record an expense and post it to the ledger (Dr expense acct, Cr cash/bank/mobile)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_expense(
  p_org_id UUID,
  p_store_id UUID,
  p_category_id UUID,
  p_vendor_name TEXT,
  p_description TEXT,
  p_amount NUMERIC,
  p_payment_method payment_method,
  p_expense_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id UUID;
  v_entry_id UUID;
  v_expense_acct UUID;
  v_pay_acct UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  PERFORM public.ensure_default_accounts(p_org_id);

  -- expense account: category's mapped account, else generic Operating Expenses (6000)
  SELECT COALESCE(ec.account_id, public.account_id_by_code(p_org_id, '6000'))
    INTO v_expense_acct
  FROM (SELECT 1) x
  LEFT JOIN expense_categories ec ON ec.id = p_category_id;
  IF v_expense_acct IS NULL THEN
    v_expense_acct := public.account_id_by_code(p_org_id, '6000');
  END IF;

  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(p_org_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(p_org_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(p_org_id, '1020')
    ELSE public.account_id_by_code(p_org_id, '1000')
  END;

  INSERT INTO expenses (organization_id, store_id, category_id, vendor_name, description, amount, payment_method, expense_date, created_by)
  VALUES (p_org_id, p_store_id, p_category_id, p_vendor_name, p_description, p_amount, p_payment_method, COALESCE(p_expense_date, current_date), auth.uid())
  RETURNING id INTO v_expense_id;

  v_entry_id := public.post_journal_entry(
    p_org_id, 'GEN', COALESCE(p_expense_date, current_date),
    COALESCE('Expense: ' || p_description, 'Expense'),
    'expense', v_expense_id,
    jsonb_build_array(
      jsonb_build_object('accountId', v_expense_acct, 'debit', p_amount, 'credit', 0, 'description', p_description),
      jsonb_build_object('accountId', v_pay_acct,     'debit', 0, 'credit', p_amount, 'description', 'Paid ' || p_payment_method::text)
    )
  );

  UPDATE expenses SET journal_entry_id = v_entry_id WHERE id = v_expense_id;
  RETURN v_expense_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_expense TO authenticated;

-- ---------------------------------------------------------------------------
-- Post a completed sale to the ledger (idempotent via unique source index).
-- Dr Cash/Bank/Mobile/AR (payments), Cr Sales Revenue (net), Cr Tax Payable.
-- Plus COGS: Dr COGS, Cr Inventory using variant cost.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_sale_to_ledger(p_sale_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_cogs NUMERIC := 0;
  v_net_revenue NUMERIC;
  v_entry_id UUID;
  v_pay RECORD;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  IF NOT public.user_has_org_access(v_sale.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_sale.status <> 'completed' THEN
    RETURN NULL;
  END IF;

  -- Idempotency: skip if already posted
  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = v_sale.organization_id AND source_type = 'sale' AND source_id = p_sale_id
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.ensure_default_accounts(v_sale.organization_id);

  v_net_revenue := v_sale.subtotal - v_sale.discount_amount;

  -- COGS from line variant costs
  SELECT COALESCE(SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
    INTO v_cogs
  FROM sale_lines sl
  LEFT JOIN product_variants pv ON pv.id = sl.variant_id
  LEFT JOIN products p ON p.id = pv.product_id
  WHERE sl.sale_id = p_sale_id;

  -- Debit side: payments to their asset accounts
  FOR v_pay IN
    SELECT method, SUM(amount) AS amt FROM payments WHERE sale_id = p_sale_id GROUP BY method
  LOOP
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', CASE v_pay.method
        WHEN 'cash' THEN public.account_id_by_code(v_sale.organization_id, '1000')
        WHEN 'bank_transfer' THEN public.account_id_by_code(v_sale.organization_id, '1010')
        WHEN 'mobile_money' THEN public.account_id_by_code(v_sale.organization_id, '1020')
        ELSE public.account_id_by_code(v_sale.organization_id, '1000')
      END,
      'debit', v_pay.amt, 'credit', 0, 'description', 'Receipt ' || v_sale.receipt_no));
  END LOOP;

  -- Credit revenue (net) and tax payable
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'accountId', public.account_id_by_code(v_sale.organization_id, '4000'),
    'debit', 0, 'credit', v_net_revenue, 'description', 'Sales revenue'));
  IF v_sale.tax_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '2100'),
      'debit', 0, 'credit', v_sale.tax_amount, 'description', 'Tax collected'));
  END IF;

  -- COGS / inventory relief
  IF v_cogs > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '5000'),
        'debit', v_cogs, 'credit', 0, 'description', 'COGS'),
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '1200'),
        'debit', 0, 'credit', v_cogs, 'description', 'Inventory relief'));
  END IF;

  v_entry_id := public.post_journal_entry(
    v_sale.organization_id, 'SAL', v_sale.created_at::date,
    'Sale ' || v_sale.receipt_no, 'sale', p_sale_id, v_lines
  );
  RETURN v_entry_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_sale_to_ledger TO authenticated;

-- ---------------------------------------------------------------------------
-- Financial statements
-- ---------------------------------------------------------------------------

-- Profit & Loss (computed from operational tables so it is correct even before
-- full ledger backfill). Includes operating expenses -> fixes finding F3.
CREATE OR REPLACE FUNCTION public.profit_and_loss(
  p_org_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revenue NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_cogs NUMERIC := 0;
  v_opex NUMERIC := 0;
  v_gross NUMERIC := 0;
  v_net NUMERIC := 0;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(SUM(s.subtotal - s.discount_amount), 0), COALESCE(SUM(s.tax_amount), 0)
    INTO v_revenue, v_tax
  FROM sales s
  WHERE s.organization_id = p_org_id
    AND s.status = 'completed'
    AND s.created_at::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
    INTO v_cogs
  FROM sale_lines sl
  JOIN sales s ON s.id = sl.sale_id
  LEFT JOIN product_variants pv ON pv.id = sl.variant_id
  LEFT JOIN products p ON p.id = pv.product_id
  WHERE s.organization_id = p_org_id
    AND s.status = 'completed'
    AND s.created_at::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(e.amount), 0) INTO v_opex
  FROM expenses e
  WHERE e.organization_id = p_org_id
    AND e.expense_date BETWEEN p_from AND p_to;

  v_gross := v_revenue - v_cogs;
  v_net := v_gross - v_opex;

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenue', v_revenue,
    'tax_collected', v_tax,
    'cogs', v_cogs,
    'gross_profit', v_gross,
    'gross_margin_pct', CASE WHEN v_revenue > 0 THEN round((v_gross / v_revenue) * 100, 1) ELSE 0 END,
    'operating_expenses', v_opex,
    'net_profit', v_net,
    'net_margin_pct', CASE WHEN v_revenue > 0 THEN round((v_net / v_revenue) * 100, 1) ELSE 0 END
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.profit_and_loss TO authenticated;

-- Trial balance from the ledger.
CREATE OR REPLACE FUNCTION public.trial_balance(
  p_org_id UUID,
  p_to DATE DEFAULT current_date
)
RETURNS TABLE (
  account_code TEXT,
  account_name TEXT,
  account_type account_type,
  debit NUMERIC,
  credit NUMERIC,
  balance NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.code, a.name, a.type,
    COALESCE(SUM(jel.debit), 0) AS debit,
    COALESCE(SUM(jel.credit), 0) AS credit,
    COALESCE(SUM(jel.debit - jel.credit), 0) AS balance
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.entry_date <= p_to
  WHERE a.organization_id = p_org_id
    AND public.user_has_org_access(p_org_id)
  GROUP BY a.code, a.name, a.type
  ORDER BY a.code;
$$;
GRANT EXECUTE ON FUNCTION public.trial_balance TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed default accounts for existing organizations.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_accounts(r.id);
  END LOOP;
END $$;

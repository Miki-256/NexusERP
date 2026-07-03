-- Invoice posting uses journal code 'INV' but ensure_default_accounts never created it.

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
    (p_org_id, 'SAL', 'Sales',              'sales'),
    (p_org_id, 'INV', 'Customer Invoices',  'sales'),
    (p_org_id, 'PUR', 'Purchases',          'purchase'),
    (p_org_id, 'CSH', 'Cash',               'cash'),
    (p_org_id, 'BNK', 'Bank',               'bank'),
    (p_org_id, 'GEN', 'General',            'general')
  ON CONFLICT (organization_id, code) DO NOTHING;
END;
$$;

-- Backfill for organizations created before this fix.
INSERT INTO journals (organization_id, code, name, type)
SELECT o.id, 'INV', 'Customer Invoices', 'sales'::journal_type
FROM organizations o
ON CONFLICT (organization_id, code) DO NOTHING;

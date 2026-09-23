-- Tips GL split (Tip Payable) + tips_total on dashboard / daily rollups.
-- Note: 2150 is Intercompany Payable (Wave 6); Tip Payable uses 2160.

-- ---------------------------------------------------------------------------
-- Chart of accounts: Tip Payable (liability)
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
    (p_org_id, '1150', 'Intercompany Receivable', 'asset'),
    (p_org_id, '1200', 'Inventory',           'asset'),
    (p_org_id, '1500', 'Fixed Assets',        'asset'),
    (p_org_id, '1590', 'Accumulated Depreciation', 'asset'),
    (p_org_id, '2000', 'Accounts Payable',    'liability'),
    (p_org_id, '2100', 'Tax Payable',         'liability'),
    (p_org_id, '2150', 'Intercompany Payable', 'liability'),
    (p_org_id, '2160', 'Tip Payable',         'liability'),
    (p_org_id, '2300', 'Store Credit Liability', 'liability'),
    (p_org_id, '2310', 'Gift Card Liability', 'liability'),
    (p_org_id, '3000', 'Owner Equity',        'equity'),
    (p_org_id, '3900', 'Retained Earnings',   'equity'),
    (p_org_id, '4000', 'Sales Revenue',       'income'),
    (p_org_id, '4910', 'Unrealized FX Gain',  'income'),
    (p_org_id, '4920', 'Unrealized FX Loss',  'expense'),
    (p_org_id, '5000', 'Cost of Goods Sold',  'expense'),
    (p_org_id, '6000', 'Operating Expenses',  'expense'),
    (p_org_id, '6100', 'Rent',                'expense'),
    (p_org_id, '6200', 'Utilities',           'expense'),
    (p_org_id, '6300', 'Maintenance',         'expense'),
    (p_org_id, '6400', 'Salaries',            'expense'),
    (p_org_id, '6510', 'Depreciation Expense', 'expense')
  ON CONFLICT (organization_id, code) DO NOTHING;

  INSERT INTO journals (organization_id, code, name, type) VALUES
    (p_org_id, 'SAL', 'Sales',     'sales'),
    (p_org_id, 'PUR', 'Purchases', 'purchase'),
    (p_org_id, 'CSH', 'Cash',      'cash'),
    (p_org_id, 'BNK', 'Bank',      'bank'),
    (p_org_id, 'GEN', 'General',   'general'),
    (p_org_id, 'DEP', 'Depreciation', 'general'),
    (p_org_id, 'FX',  'Foreign Exchange', 'general'),
    (p_org_id, 'IC',  'Intercompany', 'general')
  ON CONFLICT (organization_id, code) DO NOTHING;
END;
$$;

INSERT INTO accounts (organization_id, code, name, type)
SELECT o.id, '2160', 'Tip Payable', 'liability'
FROM organizations o
ON CONFLICT (organization_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Sale → ledger: merchandise → 4000; tip → 2160 Tip Payable
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_sale_to_ledger_internal(p_sale_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_cogs NUMERIC := 0;
  v_merch_revenue NUMERIC;
  v_tip NUMERIC;
  v_entry_id UUID;
  v_pay RECORD;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND OR v_sale.status <> 'completed' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM payments WHERE sale_id = p_sale_id AND status = 'pending') THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = v_sale.organization_id AND source_type = 'sale' AND source_id = p_sale_id
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.ensure_default_accounts(v_sale.organization_id);

  v_merch_revenue := v_sale.subtotal - v_sale.discount_amount;
  v_tip := GREATEST(COALESCE(v_sale.tip_amount, 0), 0);

  SELECT COALESCE(SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
    INTO v_cogs
  FROM sale_lines sl
  LEFT JOIN product_variants pv ON pv.id = sl.variant_id
  LEFT JOIN products p ON p.id = pv.product_id
  WHERE sl.sale_id = p_sale_id;

  FOR v_pay IN
    SELECT method, SUM(amount) AS amt FROM payments
    WHERE sale_id = p_sale_id AND status = 'completed'
    GROUP BY method
  LOOP
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, public._payment_method_account_code(v_pay.method)),
      'debit', v_pay.amt, 'credit', 0, 'description', 'Receipt ' || v_sale.receipt_no,
      'storeId', v_sale.store_id));
  END LOOP;

  IF v_merch_revenue > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '4000'),
      'debit', 0, 'credit', v_merch_revenue, 'description', 'Sales revenue',
      'storeId', v_sale.store_id));
  END IF;

  IF v_tip > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '2160'),
      'debit', 0, 'credit', v_tip, 'description', 'Tip payable',
      'storeId', v_sale.store_id));
  END IF;

  IF v_sale.tax_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '2100'),
      'debit', 0, 'credit', v_sale.tax_amount, 'description', 'Tax collected',
      'storeId', v_sale.store_id));
  END IF;

  IF v_cogs > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '5000'),
        'debit', v_cogs, 'credit', 0, 'description', 'COGS', 'storeId', v_sale.store_id),
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '1200'),
        'debit', 0, 'credit', v_cogs, 'description', 'Inventory relief', 'storeId', v_sale.store_id));
  END IF;

  v_entry_id := public._post_journal_entry_balanced(
    v_sale.organization_id, 'SAL', v_sale.created_at::date,
    'Sale ' || v_sale.receipt_no, 'sale', p_sale_id, v_lines, auth.uid()
  );
  RETURN v_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard today KPI: tips_total
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_stats(p_organization_id UUID, p_store_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_bounds RECORD;
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_bounds FROM public._org_local_day_bounds(p_organization_id);

  SELECT jsonb_build_object(
    'sales_total', COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed'), 0),
    'tips_total', COALESCE(SUM(COALESCE(s.tip_amount, 0)) FILTER (WHERE s.status = 'completed'), 0),
    'transaction_count', COUNT(*) FILTER (WHERE s.status = 'completed'),
    'cash_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'cash'
        AND s2.created_at >= v_bounds.day_start
        AND s2.created_at < v_bounds.day_end
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'mobile_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'mobile_money'
        AND s2.created_at >= v_bounds.day_start
        AND s2.created_at < v_bounds.day_end
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'bank_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'bank_transfer'
        AND s2.created_at >= v_bounds.day_start
        AND s2.created_at < v_bounds.day_end
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0)
  ) INTO v_result
  FROM sales s
  WHERE s.organization_id = p_organization_id
    AND s.created_at >= v_bounds.day_start
    AND s.created_at < v_bounds.day_end
    AND (p_store_id IS NULL OR s.store_id = p_store_id);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Daily rollup: tips_total (sales_total still includes tips in receipt total;
-- revenue remains merchandise net of discount)
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_daily_sales_summary
  ADD COLUMN IF NOT EXISTS tips_total NUMERIC(14, 2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.refresh_org_daily_summaries(p_days_back INT DEFAULT 7)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from DATE;
  v_rows INT := 0;
BEGIN
  v_from := (current_date - GREATEST(1, LEAST(COALESCE(p_days_back, 7), 90)));

  INSERT INTO org_daily_sales_summary (
    organization_id, summary_date, store_id,
    transaction_count, sales_total, revenue, tax_collected, cogs,
    cash_total, mobile_total, bank_total, tips_total, refreshed_at
  )
  WITH sale_days AS (
    SELECT
      s.id AS sale_id,
      s.organization_id,
      (s.created_at AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date AS summary_date,
      COALESCE(s.store_id, '00000000-0000-0000-0000-000000000000'::uuid) AS store_id,
      s.status,
      s.total,
      s.subtotal,
      s.discount_amount,
      s.tax_amount,
      COALESCE(s.tip_amount, 0) AS tip_amount
    FROM sales s
    JOIN organizations o ON o.id = s.organization_id
    WHERE (s.created_at AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date >= v_from
  ),
  sale_cogs AS (
    SELECT
      sd.sale_id,
      SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)) AS line_cogs
    FROM sale_days sd
    JOIN sale_lines sl ON sl.sale_id = sd.sale_id
    LEFT JOIN product_variants pv ON pv.id = sl.variant_id
    LEFT JOIN products p ON p.id = pv.product_id
    WHERE sd.status = 'completed'
    GROUP BY sd.sale_id
  ),
  sale_payments AS (
    SELECT
      sd.sale_id,
      COALESCE(SUM(pay.amount) FILTER (WHERE pay.method = 'cash'), 0) AS cash_total,
      COALESCE(SUM(pay.amount) FILTER (WHERE pay.method = 'mobile_money'), 0) AS mobile_total,
      COALESCE(SUM(pay.amount) FILTER (WHERE pay.method = 'bank_transfer'), 0) AS bank_total
    FROM sale_days sd
    JOIN payments pay ON pay.sale_id = sd.sale_id
    WHERE sd.status = 'completed'
    GROUP BY sd.sale_id
  )
  SELECT
    sd.organization_id,
    sd.summary_date,
    sd.store_id,
    COUNT(*) FILTER (WHERE sd.status = 'completed')::bigint,
    COALESCE(SUM(sd.total) FILTER (WHERE sd.status = 'completed'), 0),
    COALESCE(SUM(sd.subtotal - sd.discount_amount) FILTER (WHERE sd.status = 'completed'), 0),
    COALESCE(SUM(sd.tax_amount) FILTER (WHERE sd.status = 'completed'), 0),
    COALESCE(SUM(sc.line_cogs), 0),
    COALESCE(SUM(sp.cash_total), 0),
    COALESCE(SUM(sp.mobile_total), 0),
    COALESCE(SUM(sp.bank_total), 0),
    COALESCE(SUM(sd.tip_amount) FILTER (WHERE sd.status = 'completed'), 0),
    now()
  FROM sale_days sd
  LEFT JOIN sale_cogs sc ON sc.sale_id = sd.sale_id
  LEFT JOIN sale_payments sp ON sp.sale_id = sd.sale_id
  GROUP BY sd.organization_id, sd.summary_date, sd.store_id
  ON CONFLICT (organization_id, summary_date, store_id) DO UPDATE SET
    transaction_count = EXCLUDED.transaction_count,
    sales_total = EXCLUDED.sales_total,
    revenue = EXCLUDED.revenue,
    tax_collected = EXCLUDED.tax_collected,
    cogs = EXCLUDED.cogs,
    cash_total = EXCLUDED.cash_total,
    mobile_total = EXCLUDED.mobile_total,
    bank_total = EXCLUDED.bank_total,
    tips_total = EXCLUDED.tips_total,
    refreshed_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO org_daily_sales_summary (
    organization_id, summary_date, store_id,
    transaction_count, sales_total, revenue, tax_collected, cogs,
    cash_total, mobile_total, bank_total, tips_total, refreshed_at
  )
  SELECT
    organization_id,
    summary_date,
    '00000000-0000-0000-0000-000000000000'::uuid,
    SUM(transaction_count),
    SUM(sales_total),
    SUM(revenue),
    SUM(tax_collected),
    SUM(cogs),
    SUM(cash_total),
    SUM(mobile_total),
    SUM(bank_total),
    SUM(tips_total),
    now()
  FROM org_daily_sales_summary
  WHERE summary_date >= v_from
    AND store_id <> '00000000-0000-0000-0000-000000000000'::uuid
  GROUP BY organization_id, summary_date
  ON CONFLICT (organization_id, summary_date, store_id) DO UPDATE SET
    transaction_count = EXCLUDED.transaction_count,
    sales_total = EXCLUDED.sales_total,
    revenue = EXCLUDED.revenue,
    tax_collected = EXCLUDED.tax_collected,
    cogs = EXCLUDED.cogs,
    cash_total = EXCLUDED.cash_total,
    mobile_total = EXCLUDED.mobile_total,
    bank_total = EXCLUDED.bank_total,
    tips_total = EXCLUDED.tips_total,
    refreshed_at = now();

  RETURN v_rows;
END;
$$;

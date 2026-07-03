-- Phase A — Financial integrity: sale JE fixes, refund posting, AR collections, batch post, GL P&L mode.

-- ---------------------------------------------------------------------------
-- Chart of accounts: store credit liability
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
    (p_org_id, '2300', 'Store Credit Liability', 'liability'),
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

-- ---------------------------------------------------------------------------
-- Internal balanced JE writer (no auth — for SECURITY DEFINER chains)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._post_journal_entry_balanced(
  p_org_id UUID,
  p_journal_code TEXT,
  p_date DATE,
  p_memo TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_lines JSONB,
  p_created_by UUID DEFAULT NULL
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
  VALUES (p_org_id, v_journal_id, COALESCE(p_date, current_date), p_memo, p_source_type, p_source_id, p_created_by)
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
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN public._post_journal_entry_balanced(
    p_org_id, p_journal_code, p_date, p_memo, p_source_type, p_source_id, p_lines, auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._payment_method_account_code(p_method payment_method)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_method
    WHEN 'cash' THEN '1000'
    WHEN 'bank_transfer' THEN '1010'
    WHEN 'mobile_money' THEN '1020'
    WHEN 'store_credit' THEN '2300'
    WHEN 'on_account' THEN '1100'
    ELSE '1000'
  END;
$$;

-- ---------------------------------------------------------------------------
-- Sale posting: tips in revenue, store credit → liability (2300)
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
  v_net_revenue NUMERIC;
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

  v_net_revenue := v_sale.subtotal - v_sale.discount_amount + COALESCE(v_sale.tip_amount, 0);

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
      'debit', v_pay.amt, 'credit', 0, 'description', 'Receipt ' || v_sale.receipt_no));
  END LOOP;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'accountId', public.account_id_by_code(v_sale.organization_id, '4000'),
    'debit', 0, 'credit', v_net_revenue, 'description', 'Sales revenue'));

  IF v_sale.tax_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '2100'),
      'debit', 0, 'credit', v_sale.tax_amount, 'description', 'Tax collected'));
  END IF;

  IF v_cogs > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '5000'),
        'debit', v_cogs, 'credit', 0, 'description', 'COGS'),
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '1200'),
        'debit', 0, 'credit', v_cogs, 'description', 'Inventory relief'));
  END IF;

  v_entry_id := public._post_journal_entry_balanced(
    v_sale.organization_id, 'SAL', v_sale.created_at::date,
    'Sale ' || v_sale.receipt_no, 'sale', p_sale_id, v_lines, auth.uid()
  );
  RETURN v_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Void reversal JE (mirror original sale entry)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_refund_void_to_ledger(
  p_sale_id UUID,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_original_entry_id UUID;
  v_lines JSONB := '[]'::jsonb;
  v_line RECORD;
  v_entry_id UUID;
  v_acct_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_acct_code TEXT;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_original_entry_id
  FROM journal_entries
  WHERE organization_id = v_sale.organization_id
    AND source_type = 'sale' AND source_id = p_sale_id;

  IF v_original_entry_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = v_sale.organization_id
      AND source_type = 'sale_void' AND source_id = p_sale_id
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.ensure_default_accounts(v_sale.organization_id);

  FOR v_line IN
    SELECT jel.account_id, jel.debit, jel.credit, jel.description, a.code AS acct_code
    FROM journal_entry_lines jel
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.entry_id = v_original_entry_id
  LOOP
    v_acct_id := v_line.account_id;
    v_debit := v_line.credit;
    v_credit := v_line.debit;
    v_acct_code := v_line.acct_code;

    IF p_refund_method = 'store_credit'
      AND v_acct_code IN ('1000', '1010', '1020')
      AND v_credit > 0
    THEN
      v_acct_id := public.account_id_by_code(v_sale.organization_id, '2300');
    END IF;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_acct_id,
      'debit', v_debit,
      'credit', v_credit,
      'description', COALESCE(v_line.description, 'Void reversal')));
  END LOOP;

  v_entry_id := public._post_journal_entry_balanced(
    v_sale.organization_id, 'SAL', current_date,
    'Void sale ' || v_sale.receipt_no, 'sale_void', p_sale_id, v_lines, auth.uid()
  );

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_refund_void_to_ledger(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Partial return JE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_partial_return_to_ledger(p_return_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ret sale_returns%ROWTYPE;
  v_sale sales%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_cogs NUMERIC := 0;
  v_pay_acct UUID;
  v_entry_id UUID;
BEGIN
  SELECT * INTO v_ret FROM sale_returns WHERE id = p_return_id;
  IF NOT FOUND OR v_ret.total <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = v_ret.original_sale_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = v_sale.organization_id
      AND source_type = 'sale' AND source_id = v_sale.id
  ) THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = v_sale.organization_id
      AND source_type = 'sale_return' AND source_id = p_return_id
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.ensure_default_accounts(v_sale.organization_id);

  SELECT COALESCE(SUM(
    srl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)
  ), 0)
    INTO v_cogs
  FROM sale_return_lines srl
  JOIN sale_lines sl ON sl.id = srl.sale_line_id
  LEFT JOIN product_variants pv ON pv.id = srl.variant_id
  LEFT JOIN products p ON p.id = pv.product_id
  WHERE srl.return_id = p_return_id;

  v_pay_acct := public.account_id_by_code(
    v_sale.organization_id,
    CASE WHEN v_ret.refund_method = 'store_credit' THEN '2300' ELSE '1000' END
  );

  IF v_ret.subtotal > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '4000'),
      'debit', v_ret.subtotal, 'credit', 0, 'description', 'Return revenue reversal'));
  END IF;

  IF v_ret.tax_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', public.account_id_by_code(v_sale.organization_id, '2100'),
      'debit', v_ret.tax_amount, 'credit', 0, 'description', 'Return tax reversal'));
  END IF;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'accountId', v_pay_acct,
    'debit', 0, 'credit', v_ret.total, 'description', 'Refund ' || v_ret.refund_method));

  IF v_cogs > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '1200'),
        'debit', v_cogs, 'credit', 0, 'description', 'Inventory restored'),
      jsonb_build_object('accountId', public.account_id_by_code(v_sale.organization_id, '5000'),
        'debit', 0, 'credit', v_cogs, 'description', 'COGS reversal'));
  END IF;

  v_entry_id := public._post_journal_entry_balanced(
    v_sale.organization_id, 'SAL', current_date,
    'Return on ' || v_sale.receipt_no, 'sale_return', p_return_id, v_lines, auth.uid()
  );

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_partial_return_to_ledger(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- AR collection → Dr cash/bank/mobile, Cr AR
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collect_customer_receivable(
  p_org_id UUID,
  p_customer_id UUID,
  p_amount NUMERIC,
  p_payment_method payment_method,
  p_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_tx_id UUID;
  v_pay_acct UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_payment_method = 'on_account' OR p_payment_method = 'store_credit' THEN
    RAISE EXCEPTION 'Invalid collection method';
  END IF;

  SELECT balance INTO v_balance
  FROM customer_receivables
  WHERE organization_id = p_org_id AND customer_id = p_customer_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance owed';
  END IF;

  INSERT INTO receivable_transactions (
    organization_id, customer_id, amount, reason, payment_method, created_by
  ) VALUES (
    p_org_id, p_customer_id, -p_amount,
    COALESCE(NULLIF(trim(p_reference), ''), 'Payment collected'),
    p_payment_method, auth.uid()
  ) RETURNING id INTO v_tx_id;

  UPDATE customer_receivables
  SET balance = balance - p_amount, updated_at = now()
  WHERE organization_id = p_org_id AND customer_id = p_customer_id;

  PERFORM public.ensure_default_accounts(p_org_id);

  v_pay_acct := public.account_id_by_code(p_org_id, public._payment_method_account_code(p_payment_method));

  PERFORM public._post_journal_entry_balanced(
    p_org_id, 'CSH', current_date,
    COALESCE(NULLIF(trim(p_reference), ''), 'AR collection'),
    'receivable_collection', v_tx_id,
    jsonb_build_array(
      jsonb_build_object('accountId', v_pay_acct, 'debit', p_amount, 'credit', 0, 'description', 'Payment received'),
      jsonb_build_object('accountId', public.account_id_by_code(p_org_id, '1100'),
        'debit', 0, 'credit', p_amount, 'description', 'Accounts receivable')
    ),
    auth.uid()
  );

  RETURN v_tx_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Batch post unposted completed sales
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_unposted_sales(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN (
    SELECT COUNT(*)::INT
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.sale_id = s.id AND p.status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.organization_id = s.organization_id
          AND je.source_type = 'sale' AND je.source_id = s.id
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_unposted_sales(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_unposted_sales_batch(
  p_org_id UUID,
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID;
  v_posted INT := 0;
  v_skipped INT := 0;
  v_entry_id UUID;
  v_limit INT := GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_sale_id IN
    SELECT s.id
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.sale_id = s.id AND p.status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.organization_id = s.organization_id
          AND je.source_type = 'sale' AND je.source_id = s.id
      )
    ORDER BY s.created_at ASC
    LIMIT v_limit
  LOOP
    BEGIN
      v_entry_id := public.post_sale_to_ledger_internal(v_sale_id);
      IF v_entry_id IS NOT NULL THEN
        v_posted := v_posted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'posted', v_posted,
    'skipped', v_skipped,
    'remaining', public.count_unposted_sales(p_org_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_unposted_sales_batch(UUID, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- P&L: operational (default) or GL-only from journal lines
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.profit_and_loss(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION public.profit_and_loss(
  p_org_id UUID,
  p_from DATE,
  p_to DATE,
  p_mode TEXT DEFAULT 'operational'
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
  v_tz TEXT;
  v_today DATE;
  v_mode TEXT := lower(COALESCE(p_mode, 'operational'));
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_mode = 'gl' THEN
    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
      INTO v_revenue
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.organization_id = p_org_id
      AND je.entry_date BETWEEN p_from AND p_to
      AND a.type = 'income';

    SELECT COALESCE(SUM(jel.debit - jel.credit), 0)
      INTO v_cogs
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.organization_id = p_org_id
      AND je.entry_date BETWEEN p_from AND p_to
      AND a.code = '5000';

    SELECT COALESCE(SUM(jel.debit - jel.credit), 0)
      INTO v_opex
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.organization_id = p_org_id
      AND je.entry_date BETWEEN p_from AND p_to
      AND a.type = 'expense'
      AND a.code <> '5000';

    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
      INTO v_tax
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.organization_id = p_org_id
      AND je.entry_date BETWEEN p_from AND p_to
      AND a.code = '2100';

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
      'net_margin_pct', CASE WHEN v_revenue > 0 THEN round((v_net / v_revenue) * 100, 1) ELSE 0 END,
      'source', 'gl'
    );
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM organizations WHERE id = p_org_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT
    COALESCE(SUM(revenue), 0),
    COALESCE(SUM(tax_collected), 0),
    COALESCE(SUM(cogs), 0)
  INTO v_revenue, v_tax, v_cogs
  FROM org_daily_sales_summary
  WHERE organization_id = p_org_id
    AND store_id = '00000000-0000-0000-0000-000000000000'::uuid
    AND summary_date BETWEEN p_from AND p_to
    AND summary_date < v_today;

  IF p_to >= v_today AND p_from <= v_today THEN
    SELECT
      v_revenue + COALESCE(SUM(s.subtotal - s.discount_amount), 0),
      v_tax + COALESCE(SUM(s.tax_amount), 0)
    INTO v_revenue, v_tax
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_tz)::date = v_today;

    SELECT v_cogs + COALESCE(SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
    INTO v_cogs
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    LEFT JOIN product_variants pv ON pv.id = sl.variant_id
    LEFT JOIN products p ON p.id = pv.product_id
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_tz)::date = v_today;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_daily_sales_summary
    WHERE organization_id = p_org_id AND summary_date BETWEEN p_from AND LEAST(p_to, v_today - 1)
  ) AND p_from < v_today THEN
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
  END IF;

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
    'net_margin_pct', CASE WHEN v_revenue > 0 THEN round((v_net / v_revenue) * 100, 1) ELSE 0 END,
    'source', CASE
      WHEN EXISTS (
        SELECT 1 FROM org_daily_sales_summary
        WHERE organization_id = p_org_id AND summary_date BETWEEN p_from AND p_to
      ) THEN 'rollup'
      ELSE 'live'
    END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Wire refund/void flows to ledger (append GL posting hooks)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.void_sale_backoffice(
  p_sale_id UUID,
  p_reason TEXT,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_line sale_lines%ROWTYPE;
  v_user_id UUID;
  v_credit NUMERIC;
  v_on_account NUMERIC;
  v_issue_credit NUMERIC;
  v_already_returned NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_refund_method NOT IN ('cash', 'store_credit') THEN
    RAISE EXCEPTION 'Invalid refund method';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF NOT public.user_can_manage(v_sale.organization_id) THEN
    RAISE EXCEPTION 'Only managers can void sales';
  END IF;

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Sale cannot be voided';
  END IF;

  FOR v_line IN SELECT * FROM sale_lines WHERE sale_id = p_sale_id
  LOOP
    UPDATE inventory_levels
    SET quantity = quantity + (v_line.quantity - v_line.returned_quantity), updated_at = now()
    WHERE store_id = v_sale.store_id AND variant_id = v_line.variant_id;
  END LOOP;

  SELECT COALESCE(SUM(amount), 0) INTO v_credit
  FROM payments WHERE sale_id = p_sale_id AND method = 'store_credit';

  IF v_credit > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customer_credits
    SET balance = balance + v_credit, updated_at = now()
    WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id;

    INSERT INTO customer_credits (organization_id, customer_id, balance)
    SELECT v_sale.organization_id, v_sale.customer_id, v_credit
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_credits
      WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id
    );

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (v_sale.organization_id, v_sale.customer_id, v_credit, 'Restored — void ' || p_reason, p_sale_id);
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_on_account
  FROM payments WHERE sale_id = p_sale_id AND method = 'on_account';

  IF v_on_account > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customer_receivables
    SET balance = GREATEST(balance - v_on_account, 0), updated_at = now()
    WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id;

    INSERT INTO receivable_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (
      v_sale.organization_id, v_sale.customer_id, -v_on_account,
      'Reversed — void ' || p_reason, p_sale_id
    );
  END IF;

  IF p_refund_method = 'store_credit' THEN
    IF v_sale.customer_id IS NULL THEN
      RAISE EXCEPTION 'Customer required for store credit refund';
    END IF;
    SELECT COALESCE(SUM(total), 0) INTO v_already_returned
    FROM sale_returns WHERE original_sale_id = p_sale_id;
    v_issue_credit := GREATEST(v_sale.total - v_credit - v_already_returned, 0);
    IF v_issue_credit > 0 THEN
      INSERT INTO customer_credits (organization_id, customer_id, balance)
      VALUES (v_sale.organization_id, v_sale.customer_id, v_issue_credit)
      ON CONFLICT (organization_id, customer_id)
      DO UPDATE SET balance = customer_credits.balance + v_issue_credit, updated_at = now();

      INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
      VALUES (
        v_sale.organization_id, v_sale.customer_id, v_issue_credit,
        'Refund credit — void ' || p_reason, p_sale_id
      );
    END IF;
  END IF;

  UPDATE sales SET status = 'voided', void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, v_user_id, 'sale', p_sale_id, 'voided',
    jsonb_build_object('reason', p_reason, 'refund_method', p_refund_method, 'source', 'backoffice')
  );

  PERFORM public.post_refund_void_to_ledger(p_sale_id, p_refund_method);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_sale_pos(
  p_sale_id UUID,
  p_reason TEXT,
  p_session_token TEXT,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_line sale_lines%ROWTYPE;
  v_staff RECORD;
  v_credit NUMERIC;
  v_on_account NUMERIC;
  v_issue_credit NUMERIC;
  v_already_returned NUMERIC;
BEGIN
  IF p_refund_method NOT IN ('cash', 'store_credit') THEN
    RAISE EXCEPTION 'Invalid refund method';
  END IF;

  SELECT * INTO v_staff FROM public.validate_pos_staff_session(p_session_token);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid session';
  END IF;

  IF v_staff.role <> 'manager' THEN
    RAISE EXCEPTION 'Only managers can void sales';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.organization_id <> v_staff.organization_id THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Sale cannot be voided';
  END IF;

  FOR v_line IN SELECT * FROM sale_lines WHERE sale_id = p_sale_id
  LOOP
    UPDATE inventory_levels
    SET quantity = quantity + (v_line.quantity - v_line.returned_quantity), updated_at = now()
    WHERE store_id = v_sale.store_id AND variant_id = v_line.variant_id;
  END LOOP;

  SELECT COALESCE(SUM(amount), 0) INTO v_credit
  FROM payments WHERE sale_id = p_sale_id AND method = 'store_credit';

  IF v_credit > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customer_credits
    SET balance = balance + v_credit, updated_at = now()
    WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id;

    INSERT INTO customer_credits (organization_id, customer_id, balance)
    SELECT v_sale.organization_id, v_sale.customer_id, v_credit
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_credits
      WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id
    );

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (v_sale.organization_id, v_sale.customer_id, v_credit, 'Restored — void ' || p_reason, p_sale_id);
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_on_account
  FROM payments WHERE sale_id = p_sale_id AND method = 'on_account';

  IF v_on_account > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customer_receivables
    SET balance = GREATEST(balance - v_on_account, 0), updated_at = now()
    WHERE organization_id = v_sale.organization_id AND customer_id = v_sale.customer_id;

    INSERT INTO receivable_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (
      v_sale.organization_id, v_sale.customer_id, -v_on_account,
      'Reversed — void ' || p_reason, p_sale_id
    );
  END IF;

  IF p_refund_method = 'store_credit' THEN
    IF v_sale.customer_id IS NULL THEN
      RAISE EXCEPTION 'Customer required for store credit refund';
    END IF;
    SELECT COALESCE(SUM(total), 0) INTO v_already_returned
    FROM sale_returns WHERE original_sale_id = p_sale_id;
    v_issue_credit := GREATEST(v_sale.total - v_credit - v_already_returned, 0);
    IF v_issue_credit > 0 THEN
      INSERT INTO customer_credits (organization_id, customer_id, balance)
      VALUES (v_sale.organization_id, v_sale.customer_id, v_issue_credit)
      ON CONFLICT (organization_id, customer_id)
      DO UPDATE SET balance = customer_credits.balance + v_issue_credit, updated_at = now();

      INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
      VALUES (
        v_sale.organization_id, v_sale.customer_id, v_issue_credit,
        'Refund credit — void ' || p_reason, p_sale_id
      );
    END IF;
  END IF;

  UPDATE sales SET status = 'voided', void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, NULL, 'sale', p_sale_id, 'voided',
    jsonb_build_object(
      'reason', p_reason,
      'pos_staff_id', v_staff.staff_id,
      'refund_method', p_refund_method
    )
  );

  PERFORM public.post_refund_void_to_ledger(p_sale_id, p_refund_method);
END;
$$;

CREATE OR REPLACE FUNCTION public.partial_return_sale(
  p_sale_id UUID,
  p_lines JSONB,
  p_reason TEXT,
  p_session_token TEXT,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_staff RECORD;
  v_line JSONB;
  v_sale_line sale_lines%ROWTYPE;
  v_return_id UUID;
  v_return_qty NUMERIC;
  v_available NUMERIC;
  v_refund_subtotal NUMERIC := 0;
  v_refund_tax NUMERIC := 0;
  v_refund_total NUMERIC := 0;
  v_line_refund NUMERIC;
  v_all_returned BOOLEAN := true;
  v_sl sale_lines%ROWTYPE;
BEGIN
  IF p_refund_method NOT IN ('cash', 'store_credit') THEN
    RAISE EXCEPTION 'Invalid refund method';
  END IF;

  SELECT * INTO v_staff FROM public.validate_pos_staff_session(p_session_token);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid session';
  END IF;

  IF v_staff.role <> 'manager' THEN
    RAISE EXCEPTION 'Only managers can process returns';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.organization_id <> v_staff.organization_id THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF v_sale.status NOT IN ('completed', 'returned') THEN
    RAISE EXCEPTION 'Sale cannot be returned';
  END IF;

  IF p_refund_method = 'store_credit' AND v_sale.customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer required for store credit refund';
  END IF;

  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Select at least one line to return';
  END IF;

  INSERT INTO sale_returns (
    organization_id, original_sale_id, refund_method, reason, pos_staff_id
  ) VALUES (
    v_sale.organization_id, p_sale_id, p_refund_method, p_reason, v_staff.staff_id
  ) RETURNING id INTO v_return_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_return_qty := (v_line->>'quantity')::NUMERIC;
    IF v_return_qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be positive';
    END IF;

    SELECT * INTO v_sale_line
    FROM sale_lines
    WHERE id = (v_line->>'saleLineId')::UUID AND sale_id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale line not found';
    END IF;

    v_available := v_sale_line.quantity - v_sale_line.returned_quantity;
    IF v_return_qty > v_available THEN
      RAISE EXCEPTION 'Return quantity exceeds available for %', v_sale_line.product_name;
    END IF;

    v_line_refund := round(v_sale_line.line_total * (v_return_qty / v_sale_line.quantity), 2);
    v_refund_total := v_refund_total + v_line_refund;

    IF v_sale_line.tax_amount > 0 AND v_sale_line.quantity > 0 THEN
      v_refund_tax := v_refund_tax + round(
        v_sale_line.tax_amount * (v_return_qty / v_sale_line.quantity), 2
      );
    END IF;

    v_refund_subtotal := v_refund_subtotal + (v_line_refund - round(
      v_sale_line.tax_amount * (v_return_qty / v_sale_line.quantity), 2
    ));

    UPDATE sale_lines
    SET returned_quantity = returned_quantity + v_return_qty
    WHERE id = v_sale_line.id;

    UPDATE inventory_levels
    SET quantity = quantity + v_return_qty, updated_at = now()
    WHERE store_id = v_sale.store_id AND variant_id = v_sale_line.variant_id;

    INSERT INTO sale_return_lines (return_id, sale_line_id, variant_id, quantity, line_total)
    VALUES (v_return_id, v_sale_line.id, v_sale_line.variant_id, v_return_qty, v_line_refund);
  END LOOP;

  UPDATE sale_returns
  SET subtotal = v_refund_subtotal, tax_amount = v_refund_tax, total = v_refund_total
  WHERE id = v_return_id;

  IF p_refund_method = 'store_credit' AND v_refund_total > 0 THEN
    INSERT INTO customer_credits (organization_id, customer_id, balance)
    VALUES (v_sale.organization_id, v_sale.customer_id, v_refund_total)
    ON CONFLICT (organization_id, customer_id)
    DO UPDATE SET balance = customer_credits.balance + v_refund_total, updated_at = now();

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (
      v_sale.organization_id, v_sale.customer_id, v_refund_total,
      'Partial return — ' || p_reason, p_sale_id
    );
  END IF;

  FOR v_sl IN SELECT * FROM sale_lines WHERE sale_id = p_sale_id
  LOOP
    IF v_sl.returned_quantity < v_sl.quantity THEN
      v_all_returned := false;
      EXIT;
    END IF;
  END LOOP;

  UPDATE sales
  SET status = CASE WHEN v_all_returned THEN 'returned'::sale_status ELSE 'completed'::sale_status END,
      void_reason = CASE WHEN v_all_returned THEN p_reason ELSE COALESCE(void_reason, p_reason) END
  WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, NULL, 'sale', p_sale_id, 'partial_return',
    jsonb_build_object(
      'return_id', v_return_id,
      'total', v_refund_total,
      'refund_method', p_refund_method,
      'reason', p_reason,
      'pos_staff_id', v_staff.staff_id
    )
  );

  PERFORM public.post_partial_return_to_ledger(v_return_id);

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'refund_total', v_refund_total,
    'refund_method', p_refund_method,
    'fully_returned', v_all_returned
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.partial_return_sale_backoffice(
  p_sale_id UUID,
  p_lines JSONB,
  p_reason TEXT,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_user_id UUID;
  v_line JSONB;
  v_sale_line sale_lines%ROWTYPE;
  v_return_id UUID;
  v_return_qty NUMERIC;
  v_available NUMERIC;
  v_refund_subtotal NUMERIC := 0;
  v_refund_tax NUMERIC := 0;
  v_refund_total NUMERIC := 0;
  v_line_refund NUMERIC;
  v_all_returned BOOLEAN := true;
  v_sl sale_lines%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_refund_method NOT IN ('cash', 'store_credit') THEN
    RAISE EXCEPTION 'Invalid refund method';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF NOT public.user_can_manage(v_sale.organization_id) THEN
    RAISE EXCEPTION 'Only managers can process returns';
  END IF;

  IF v_sale.status NOT IN ('completed', 'returned') THEN
    RAISE EXCEPTION 'Sale cannot be returned';
  END IF;

  IF p_refund_method = 'store_credit' AND v_sale.customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer required for store credit refund';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Select at least one line to return';
  END IF;

  INSERT INTO sale_returns (
    organization_id, original_sale_id, refund_method, reason, pos_staff_id
  ) VALUES (
    v_sale.organization_id, p_sale_id, p_refund_method, p_reason, NULL
  ) RETURNING id INTO v_return_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_return_qty := (v_line->>'quantity')::NUMERIC;
    IF v_return_qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be positive';
    END IF;

    SELECT * INTO v_sale_line
    FROM sale_lines
    WHERE id = (v_line->>'saleLineId')::UUID AND sale_id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale line not found';
    END IF;

    v_available := v_sale_line.quantity - v_sale_line.returned_quantity;
    IF v_return_qty > v_available THEN
      RAISE EXCEPTION 'Return quantity exceeds available for %', v_sale_line.product_name;
    END IF;

    v_line_refund := round(v_sale_line.line_total * (v_return_qty / v_sale_line.quantity), 2);
    v_refund_total := v_refund_total + v_line_refund;

    IF v_sale_line.tax_amount > 0 AND v_sale_line.quantity > 0 THEN
      v_refund_tax := v_refund_tax + round(
        v_sale_line.tax_amount * (v_return_qty / v_sale_line.quantity), 2
      );
    END IF;

    v_refund_subtotal := v_refund_subtotal + (v_line_refund - round(
      v_sale_line.tax_amount * (v_return_qty / v_sale_line.quantity), 2
    ));

    UPDATE sale_lines
    SET returned_quantity = returned_quantity + v_return_qty
    WHERE id = v_sale_line.id;

    UPDATE inventory_levels
    SET quantity = quantity + v_return_qty, updated_at = now()
    WHERE store_id = v_sale.store_id AND variant_id = v_sale_line.variant_id;

    INSERT INTO sale_return_lines (return_id, sale_line_id, variant_id, quantity, line_total)
    VALUES (v_return_id, v_sale_line.id, v_sale_line.variant_id, v_return_qty, v_line_refund);
  END LOOP;

  UPDATE sale_returns
  SET subtotal = v_refund_subtotal, tax_amount = v_refund_tax, total = v_refund_total
  WHERE id = v_return_id;

  IF p_refund_method = 'store_credit' AND v_refund_total > 0 THEN
    INSERT INTO customer_credits (organization_id, customer_id, balance)
    VALUES (v_sale.organization_id, v_sale.customer_id, v_refund_total)
    ON CONFLICT (organization_id, customer_id)
    DO UPDATE SET balance = customer_credits.balance + v_refund_total, updated_at = now();

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (
      v_sale.organization_id, v_sale.customer_id, v_refund_total,
      'Partial return — ' || p_reason, p_sale_id
    );
  END IF;

  FOR v_sl IN SELECT * FROM sale_lines WHERE sale_id = p_sale_id
  LOOP
    IF v_sl.returned_quantity < v_sl.quantity THEN
      v_all_returned := false;
      EXIT;
    END IF;
  END LOOP;

  UPDATE sales
  SET status = CASE WHEN v_all_returned THEN 'returned'::sale_status ELSE 'completed'::sale_status END,
      void_reason = CASE WHEN v_all_returned THEN p_reason ELSE COALESCE(void_reason, p_reason) END
  WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, v_user_id, 'sale', p_sale_id, 'partial_return',
    jsonb_build_object(
      'return_id', v_return_id,
      'total', v_refund_total,
      'refund_method', p_refund_method,
      'reason', p_reason,
      'source', 'backoffice'
    )
  );

  PERFORM public.post_partial_return_to_ledger(v_return_id);

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'refund_total', v_refund_total,
    'refund_method', p_refund_method,
    'fully_returned', v_all_returned
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.profit_and_loss(UUID, DATE, DATE, TEXT) TO authenticated;

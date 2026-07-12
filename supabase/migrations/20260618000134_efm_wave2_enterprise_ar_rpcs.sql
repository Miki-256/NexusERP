-- EFM Wave 2 — Enterprise AR RPCs (requires 00132 enum + 00133 schema)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._invoice_balance_due(
  p_total NUMERIC,
  p_amount_paid NUMERIC,
  p_amount_credited NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(COALESCE(p_total, 0) - COALESCE(p_amount_paid, 0) - COALESCE(p_amount_credited, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public._customer_ar_exposure(
  p_org_id UUID,
  p_customer_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_open NUMERIC := 0;
  v_on_account NUMERIC := 0;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited)), 0)
  INTO v_invoice_open
  FROM customer_invoices ci
  WHERE ci.organization_id = p_org_id
    AND ci.customer_id = p_customer_id
    AND ci.status IN ('posted', 'partially_paid');

  SELECT COALESCE(cr.balance, 0) INTO v_on_account
  FROM customer_receivables cr
  WHERE cr.organization_id = p_org_id AND cr.customer_id = p_customer_id;

  RETURN COALESCE(v_invoice_open, 0) + COALESCE(v_on_account, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public._assert_customer_credit_limit(
  p_org_id UUID,
  p_customer_id UUID,
  p_additional_amount NUMERIC DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit NUMERIC;
  v_exposure NUMERIC;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  SELECT credit_limit INTO v_limit
  FROM customers
  WHERE id = p_customer_id AND organization_id = p_org_id;

  IF v_limit IS NULL THEN
    RETURN;
  END IF;

  v_exposure := public._customer_ar_exposure(p_org_id, p_customer_id) + COALESCE(p_additional_amount, 0);

  IF v_exposure > v_limit THEN
    RAISE EXCEPTION 'Credit limit exceeded: exposure % exceeds limit %', round(v_exposure, 2), round(v_limit, 2);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._refresh_invoice_payment_status(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_balance NUMERIC;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.status NOT IN ('posted', 'partially_paid', 'paid') THEN
    RETURN;
  END IF;

  v_balance := public._invoice_balance_due(v_inv.total, v_inv.amount_paid, v_inv.amount_credited);

  IF v_balance <= 0.01 THEN
    UPDATE customer_invoices
    SET status = 'paid'::invoice_status,
        amount_paid = LEAST(v_inv.total - v_inv.amount_credited, v_inv.total),
        collection_status = 'open'
    WHERE id = p_invoice_id;
  ELSIF v_inv.amount_paid + v_inv.amount_credited > 0.01 THEN
    UPDATE customer_invoices
    SET status = 'partially_paid'::invoice_status
    WHERE id = p_invoice_id;
  ELSE
    UPDATE customer_invoices
    SET status = 'posted'::invoice_status
    WHERE id = p_invoice_id AND status <> 'posted'::invoice_status;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Default dunning policy seed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_ar_dunning_policy(p_org_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy_id UUID;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT id INTO v_policy_id
  FROM ar_dunning_policies
  WHERE organization_id = p_org_id AND is_default = true
  LIMIT 1;

  IF v_policy_id IS NOT NULL THEN
    RETURN v_policy_id;
  END IF;

  INSERT INTO ar_dunning_policies (organization_id, name, is_default, is_active, grace_days)
  VALUES (p_org_id, 'Standard', true, true, 0)
  RETURNING id INTO v_policy_id;

  INSERT INTO ar_dunning_levels (policy_id, level_no, days_overdue, template_code, description)
  VALUES
    (v_policy_id, 1, 7, 'accounting.invoice_reminder', 'First reminder — 7 days overdue'),
    (v_policy_id, 2, 21, 'accounting.invoice_reminder', 'Second reminder — 21 days overdue'),
    (v_policy_id, 3, 45, 'accounting.invoice_reminder', 'Final notice — 45 days overdue')
  ON CONFLICT DO NOTHING;

  RETURN v_policy_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_default_ar_dunning_policy(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Post invoice — enforce credit limit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_customer_invoice(p_invoice_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_entry_id UUID;
  v_net NUMERIC;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_inv.status <> 'draft' THEN RAISE EXCEPTION 'Invoice is not draft'; END IF;

  PERFORM public._assert_customer_credit_limit(v_inv.organization_id, v_inv.customer_id, v_inv.total);

  PERFORM public.ensure_default_accounts(v_inv.organization_id);
  v_net := v_inv.subtotal;

  v_entry_id := public.post_journal_entry(
    v_inv.organization_id, 'INV', v_inv.invoice_date,
    'Invoice ' || v_inv.invoice_no, 'invoice', p_invoice_id,
    jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '1100'),
        'debit', v_inv.total, 'credit', 0, 'description', 'Accounts receivable'),
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '4000'),
        'debit', 0, 'credit', v_net, 'description', 'Sales revenue'),
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '2100'),
        'debit', 0, 'credit', v_inv.tax_amount, 'description', 'Tax payable')
    )
  );

  UPDATE customer_invoices
  SET status = 'posted', journal_entry_id = v_entry_id, collection_status = 'open'
  WHERE id = p_invoice_id;

  RETURN v_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Pay invoice — full or partial
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pay_customer_invoice(UUID, payment_method);

CREATE OR REPLACE FUNCTION public.pay_customer_invoice(
  p_invoice_id UUID,
  p_payment_method payment_method,
  p_amount NUMERIC DEFAULT NULL,
  p_payment_date DATE DEFAULT NULL,
  p_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_pay_acct UUID;
  v_entry_id UUID;
  v_balance NUMERIC;
  v_pay_amount NUMERIC;
  v_payment_id UUID;
  v_date DATE;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_inv.status NOT IN ('posted', 'partially_paid') THEN
    RAISE EXCEPTION 'Invoice must be posted with an open balance';
  END IF;
  IF p_payment_method = 'on_account' OR p_payment_method = 'store_credit' THEN
    RAISE EXCEPTION 'Invalid payment method for invoice collection';
  END IF;

  v_balance := public._invoice_balance_due(v_inv.total, v_inv.amount_paid, v_inv.amount_credited);
  IF v_balance <= 0.01 THEN
    RAISE EXCEPTION 'Invoice has no balance due';
  END IF;

  v_pay_amount := COALESCE(p_amount, v_balance);
  IF v_pay_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;
  IF v_pay_amount > v_balance + 0.01 THEN
    RAISE EXCEPTION 'Payment amount % exceeds balance due %', v_pay_amount, v_balance;
  END IF;

  v_date := COALESCE(p_payment_date, current_date);

  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(v_inv.organization_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(v_inv.organization_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(v_inv.organization_id, '1020')
    ELSE public.account_id_by_code(v_inv.organization_id, '1000')
  END;

  v_entry_id := public._post_journal_entry_balanced(
    v_inv.organization_id, 'INV', v_date,
    'Payment ' || v_inv.invoice_no || COALESCE(' — ' || NULLIF(trim(p_reference), ''), ''),
    'invoice_payment', p_invoice_id,
    jsonb_build_array(
      jsonb_build_object('accountId', v_pay_acct, 'debit', v_pay_amount, 'credit', 0, 'description', 'Payment received'),
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '1100'),
        'debit', 0, 'credit', v_pay_amount, 'description', 'AR cleared')
    ),
    auth.uid()
  );

  INSERT INTO customer_invoice_payments (
    organization_id, invoice_id, payment_date, amount, payment_method,
    journal_entry_id, reference, created_by
  ) VALUES (
    v_inv.organization_id, p_invoice_id, v_date, v_pay_amount, p_payment_method,
    v_entry_id, NULLIF(trim(p_reference), ''), auth.uid()
  ) RETURNING id INTO v_payment_id;

  UPDATE customer_invoices
  SET amount_paid = amount_paid + v_pay_amount,
      paid_entry_id = COALESCE(paid_entry_id, v_entry_id)
  WHERE id = p_invoice_id;

  PERFORM public._refresh_invoice_payment_status(p_invoice_id);

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_customer_invoice(UUID, payment_method, NUMERIC, DATE, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Apply posted credit note to invoice (subledger; GL already posted on CN)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_credit_to_invoice(
  p_invoice_id UUID,
  p_credit_note_id UUID,
  p_amount NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_cn customer_credit_notes%ROWTYPE;
  v_cn_remaining NUMERIC;
  v_inv_balance NUMERIC;
  v_apply NUMERIC;
  v_alloc_id UUID;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  SELECT * INTO v_cn FROM customer_credit_notes WHERE id = p_credit_note_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credit note not found'; END IF;

  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_inv.organization_id <> v_cn.organization_id THEN RAISE EXCEPTION 'Invoice and credit note org mismatch'; END IF;
  IF v_inv.customer_id IS DISTINCT FROM v_cn.customer_id THEN RAISE EXCEPTION 'Customer mismatch'; END IF;
  IF v_cn.status <> 'posted' THEN RAISE EXCEPTION 'Credit note must be posted'; END IF;
  IF v_cn.settlement_method <> 'ar' THEN
    RAISE EXCEPTION 'Only AR-settlement credit notes can be applied to invoices';
  END IF;
  IF v_inv.status NOT IN ('posted', 'partially_paid') THEN
    RAISE EXCEPTION 'Invoice must have an open balance';
  END IF;

  v_cn_remaining := v_cn.total - v_cn.amount_applied;
  v_inv_balance := public._invoice_balance_due(v_inv.total, v_inv.amount_paid, v_inv.amount_credited);

  IF v_cn_remaining <= 0.01 THEN RAISE EXCEPTION 'Credit note has no remaining balance'; END IF;
  IF v_inv_balance <= 0.01 THEN RAISE EXCEPTION 'Invoice has no balance due'; END IF;

  v_apply := LEAST(COALESCE(p_amount, v_inv_balance), v_cn_remaining, v_inv_balance);
  IF v_apply <= 0 THEN RAISE EXCEPTION 'Application amount must be positive'; END IF;

  INSERT INTO customer_credit_allocations (
    organization_id, invoice_id, credit_note_id, amount, created_by
  ) VALUES (
    v_inv.organization_id, p_invoice_id, p_credit_note_id, v_apply, auth.uid()
  ) RETURNING id INTO v_alloc_id;

  UPDATE customer_invoices
  SET amount_credited = amount_credited + v_apply
  WHERE id = p_invoice_id;

  UPDATE customer_credit_notes
  SET amount_applied = amount_applied + v_apply
  WHERE id = p_credit_note_id;

  PERFORM public._refresh_invoice_payment_status(p_invoice_id);

  RETURN v_alloc_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_credit_to_invoice(UUID, UUID, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- Customer statement of account
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_statement(
  p_org_id UUID,
  p_customer_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from DATE := COALESCE(p_from, date_trunc('year', current_date)::date);
  v_to DATE := COALESCE(p_to, current_date);
  v_customer customers%ROWTYPE;
  v_opening NUMERIC := 0;
  v_lines JSONB := '[]'::jsonb;
  v_closing NUMERIC := 0;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;

  SELECT COALESCE(SUM(public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited)), 0)
  INTO v_opening
  FROM customer_invoices ci
  WHERE ci.organization_id = p_org_id
    AND ci.customer_id = p_customer_id
    AND ci.status IN ('posted', 'partially_paid', 'paid')
    AND ci.invoice_date < v_from;

  SELECT COALESCE(cr.balance, 0) INTO v_closing
  FROM customer_receivables cr
  WHERE cr.organization_id = p_org_id AND cr.customer_id = p_customer_id;

  v_opening := v_opening + COALESCE(v_closing, 0);

  v_lines := COALESCE((
    SELECT jsonb_agg(row_data ORDER BY row_data->>'txn_date', row_data->>'sort_key')
    FROM (
      SELECT jsonb_build_object(
        'txn_date', ci.invoice_date,
        'sort_key', 'inv:' || ci.invoice_no,
        'type', 'invoice',
        'reference', ci.invoice_no,
        'description', 'Invoice',
        'debit', ci.total,
        'credit', 0,
        'balance_effect', ci.total
      ) AS row_data
      FROM customer_invoices ci
      WHERE ci.organization_id = p_org_id
        AND ci.customer_id = p_customer_id
        AND ci.status IN ('posted', 'partially_paid', 'paid')
        AND ci.invoice_date BETWEEN v_from AND v_to

      UNION ALL

      SELECT jsonb_build_object(
        'txn_date', cip.payment_date,
        'sort_key', 'pay:' || cip.id::text,
        'type', 'payment',
        'reference', COALESCE(cip.reference, ci.invoice_no),
        'description', 'Payment — ' || ci.invoice_no,
        'debit', 0,
        'credit', cip.amount,
        'balance_effect', -cip.amount
      )
      FROM customer_invoice_payments cip
      JOIN customer_invoices ci ON ci.id = cip.invoice_id
      WHERE cip.organization_id = p_org_id
        AND ci.customer_id = p_customer_id
        AND cip.payment_date BETWEEN v_from AND v_to

      UNION ALL

      SELECT jsonb_build_object(
        'txn_date', cn.credit_date,
        'sort_key', 'cn:' || cn.credit_note_no,
        'type', 'credit_note',
        'reference', cn.credit_note_no,
        'description', 'Credit note applied',
        'debit', 0,
        'credit', cca.amount,
        'balance_effect', -cca.amount
      )
      FROM customer_credit_allocations cca
      JOIN customer_credit_notes cn ON cn.id = cca.credit_note_id
      JOIN customer_invoices ci ON ci.id = cca.invoice_id
      WHERE cca.organization_id = p_org_id
        AND ci.customer_id = p_customer_id
        AND cn.credit_date BETWEEN v_from AND v_to

      UNION ALL

      SELECT jsonb_build_object(
        'txn_date', rt.created_at::date,
        'sort_key', 'oa:' || rt.id::text,
        'type', 'on_account',
        'reference', COALESCE(rt.reason, 'On-account'),
        'description', rt.reason,
        'debit', CASE WHEN rt.amount > 0 THEN rt.amount ELSE 0 END,
        'credit', CASE WHEN rt.amount < 0 THEN abs(rt.amount) ELSE 0 END,
        'balance_effect', rt.amount
      )
      FROM receivable_transactions rt
      WHERE rt.organization_id = p_org_id
        AND rt.customer_id = p_customer_id
        AND rt.created_at::date BETWEEN v_from AND v_to
    ) sub
  ), '[]'::jsonb);

  SELECT v_opening + COALESCE(SUM((l->>'balance_effect')::NUMERIC), 0)
  INTO v_closing
  FROM jsonb_array_elements(v_lines) l;

  RETURN jsonb_build_object(
    'customer_id', p_customer_id,
    'customer_name', v_customer.name,
    'from', v_from,
    'to', v_to,
    'opening_balance', round(v_opening, 2),
    'closing_balance', round(v_closing, 2),
    'current_exposure', round(public._customer_ar_exposure(p_org_id, p_customer_id), 2),
    'lines', v_lines
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_statement(UUID, UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Open invoices list
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_customer_open_invoices(
  p_org_id UUID,
  p_customer_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_total INT;
  v_rows JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM customer_invoices ci
  WHERE ci.organization_id = p_org_id
    AND ci.status IN ('posted', 'partially_paid')
    AND public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited) > 0.01
    AND (p_customer_id IS NULL OR ci.customer_id = p_customer_id);

  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'due_date', row_data->>'invoice_no'), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', ci.id,
      'invoice_no', ci.invoice_no,
      'invoice_date', ci.invoice_date,
      'due_date', ci.due_date,
      'customer_id', ci.customer_id,
      'customer_name', c.name,
      'total', ci.total,
      'amount_paid', ci.amount_paid,
      'amount_credited', ci.amount_credited,
      'balance_due', public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited),
      'days_overdue', GREATEST(current_date - COALESCE(ci.due_date, ci.invoice_date), 0),
      'collection_status', ci.collection_status,
      'dunning_level', ci.dunning_level
    ) AS row_data
    FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = p_org_id
      AND ci.status IN ('posted', 'partially_paid')
      AND public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited) > 0.01
      AND (p_customer_id IS NULL OR ci.customer_id = p_customer_id)
    ORDER BY ci.due_date NULLS LAST, ci.invoice_no
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('total', v_total, 'invoices', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_customer_open_invoices(UUID, UUID, INT, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Customer AR summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_customers_ar_summary(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_data ORDER BY row_data->>'customer_name')
    FROM (
      SELECT jsonb_build_object(
        'customer_id', c.id,
        'customer_name', c.name,
        'invoice_open', COALESCE(inv.open_total, 0),
        'on_account_balance', COALESCE(cr.balance, 0),
        'total_exposure', COALESCE(inv.open_total, 0) + COALESCE(cr.balance, 0),
        'credit_limit', c.credit_limit,
        'credit_available', CASE
          WHEN c.credit_limit IS NULL THEN NULL
          ELSE GREATEST(c.credit_limit - COALESCE(inv.open_total, 0) - COALESCE(cr.balance, 0), 0)
        END,
        'overdue_amount', COALESCE(inv.overdue_total, 0),
        'open_invoice_count', COALESCE(inv.open_count, 0)
      ) AS row_data,
      c.name
      FROM customers c
      LEFT JOIN (
        SELECT
          ci.customer_id,
          SUM(public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited)) AS open_total,
          SUM(CASE
            WHEN COALESCE(ci.due_date, ci.invoice_date) < current_date
            THEN public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited)
            ELSE 0
          END) AS overdue_total,
          COUNT(*)::INT AS open_count
        FROM customer_invoices ci
        WHERE ci.organization_id = p_org_id
          AND ci.status IN ('posted', 'partially_paid')
          AND public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited) > 0.01
        GROUP BY ci.customer_id
      ) inv ON inv.customer_id = c.id
      LEFT JOIN customer_receivables cr
        ON cr.customer_id = c.id AND cr.organization_id = p_org_id
      WHERE c.organization_id = p_org_id
        AND (COALESCE(inv.open_total, 0) + COALESCE(cr.balance, 0)) > 0.01
    ) sub
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_customers_ar_summary(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- AR aging — open balance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accounts_receivable_aging(
  p_org_id UUID,
  p_as_of DATE DEFAULT current_date
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB := '[]'::jsonb;
  v_current NUMERIC := 0;
  v_1_30 NUMERIC := 0;
  v_31_60 NUMERIC := 0;
  v_61_90 NUMERIC := 0;
  v_over_90 NUMERIC := 0;
  v_total NUMERIC := 0;
  v_days INT;
  v_bucket TEXT;
  v_amt NUMERIC;
  r RECORD;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR r IN
    SELECT
      'invoice'::text AS kind,
      ci.id,
      ci.invoice_no AS reference,
      c.name AS customer_name,
      public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited) AS amount,
      COALESCE(ci.due_date, ci.invoice_date) AS due_date
    FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = p_org_id
      AND ci.status IN ('posted', 'partially_paid')
      AND public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited) > 0.01

    UNION ALL

    SELECT
      'on_account'::text,
      cr.customer_id,
      'On-account balance'::text,
      c.name,
      cr.balance,
      p_as_of
    FROM customer_receivables cr
    JOIN customers c ON c.id = cr.customer_id
    WHERE cr.organization_id = p_org_id AND cr.balance > 0
  LOOP
    v_amt := COALESCE(r.amount, 0);
    IF v_amt <= 0 THEN CONTINUE; END IF;

    v_days := p_as_of - r.due_date;
    IF r.kind = 'on_account' OR v_days <= 0 THEN
      v_bucket := 'current';
      v_current := v_current + v_amt;
    ELSIF v_days <= 30 THEN
      v_bucket := 'days_1_30';
      v_1_30 := v_1_30 + v_amt;
    ELSIF v_days <= 60 THEN
      v_bucket := 'days_31_60';
      v_31_60 := v_31_60 + v_amt;
    ELSIF v_days <= 90 THEN
      v_bucket := 'days_61_90';
      v_61_90 := v_61_90 + v_amt;
    ELSE
      v_bucket := 'over_90';
      v_over_90 := v_over_90 + v_amt;
    END IF;

    v_total := v_total + v_amt;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'kind', r.kind,
      'id', r.id,
      'reference', r.reference,
      'customer_name', r.customer_name,
      'amount', v_amt,
      'due_date', r.due_date,
      'days_overdue', GREATEST(v_days, 0),
      'bucket', v_bucket
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'as_of', p_as_of,
    'buckets', jsonb_build_object(
      'current', v_current,
      'days_1_30', v_1_30,
      'days_31_60', v_31_60,
      'days_61_90', v_61_90,
      'over_90', v_over_90
    ),
    'total', v_total,
    'rows', v_rows
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Paginated invoices — include open balance fields
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_customer_invoices_page(
  p_org_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_q TEXT := NULLIF(trim(p_search), '');
  v_total INT;
  v_rows JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM customer_invoices ci
  LEFT JOIN customers c ON c.id = ci.customer_id
  WHERE ci.organization_id = p_org_id
    AND (p_from IS NULL OR ci.invoice_date >= p_from)
    AND (p_to IS NULL OR ci.invoice_date <= p_to)
    AND (p_status IS NULL OR ci.status::text = p_status)
    AND (
      v_q IS NULL
      OR ci.invoice_no ILIKE '%' || v_q || '%'
      OR c.name ILIKE '%' || v_q || '%'
    );

  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'invoice_date' DESC, row_data->>'invoice_no' DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', ci.id,
      'invoice_no', ci.invoice_no,
      'invoice_date', ci.invoice_date,
      'due_date', ci.due_date,
      'status', ci.status,
      'subtotal', ci.subtotal,
      'tax_amount', ci.tax_amount,
      'total', ci.total,
      'amount_paid', ci.amount_paid,
      'amount_credited', ci.amount_credited,
      'balance_due', public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited),
      'collection_status', ci.collection_status,
      'dunning_level', ci.dunning_level,
      'customer_id', ci.customer_id,
      'customer_name', c.name,
      'journal_entry_id', ci.journal_entry_id,
      'paid_entry_id', ci.paid_entry_id,
      'created_at', ci.created_at
    ) AS row_data
    FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = p_org_id
      AND (p_from IS NULL OR ci.invoice_date >= p_from)
      AND (p_to IS NULL OR ci.invoice_date <= p_to)
      AND (p_status IS NULL OR ci.status::text = p_status)
      AND (
        v_q IS NULL
        OR ci.invoice_no ILIKE '%' || v_q || '%'
        OR c.name ILIKE '%' || v_q || '%'
      )
    ORDER BY ci.invoice_date DESC, ci.invoice_no DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('total', v_total, 'invoices', v_rows);
END;
$$;

-- ---------------------------------------------------------------------------
-- Reminders — open balance aware
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_invoices_needing_reminder(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', ci.id,
        'invoice_no', ci.invoice_no,
        'customer_name', c.name,
        'customer_email', c.email,
        'due_date', ci.due_date,
        'total', ci.total,
        'balance_due', public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited),
        'days_overdue', current_date - ci.due_date,
        'dunning_level', ci.dunning_level,
        'last_reminded_at', (
          SELECT MAX(sent_at) FROM ar_dunning_events ade WHERE ade.invoice_id = ci.id
        )
      ) ORDER BY ci.due_date
    )
    FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = p_org_id
      AND ci.status IN ('posted', 'partially_paid')
      AND public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited) > 0.01
      AND ci.due_date IS NOT NULL
      AND ci.due_date < current_date
      AND NOT EXISTS (
        SELECT 1 FROM ar_dunning_events ade
        WHERE ade.invoice_id = ci.id
          AND ade.sent_at > now() - INTERVAL '7 days'
      )
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Dunning policies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_ar_dunning_policies(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_ar_dunning_policy(p_org_id);

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'is_default', p.is_default,
        'is_active', p.is_active,
        'grace_days', p.grace_days,
        'levels', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', l.id,
              'level_no', l.level_no,
              'days_overdue', l.days_overdue,
              'template_code', l.template_code,
              'description', l.description
            ) ORDER BY l.level_no
          )
          FROM ar_dunning_levels l WHERE l.policy_id = p.id
        ), '[]'::jsonb)
      ) ORDER BY p.is_default DESC, p.name
    )
    FROM ar_dunning_policies p
    WHERE p.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_ar_dunning_policies(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_ar_dunning_policy(
  p_org_id UUID,
  p_policy_id UUID,
  p_name TEXT,
  p_is_default BOOLEAN DEFAULT false,
  p_is_active BOOLEAN DEFAULT true,
  p_grace_days INT DEFAULT 0,
  p_levels JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_level JSONB;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_policy_id IS NULL THEN
    INSERT INTO ar_dunning_policies (organization_id, name, is_default, is_active, grace_days)
    VALUES (p_org_id, trim(p_name), COALESCE(p_is_default, false), COALESCE(p_is_active, true), COALESCE(p_grace_days, 0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE ar_dunning_policies
    SET name = trim(p_name),
        is_default = COALESCE(p_is_default, is_default),
        is_active = COALESCE(p_is_active, is_active),
        grace_days = COALESCE(p_grace_days, grace_days)
    WHERE id = p_policy_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
  END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'Policy not found'; END IF;

  IF COALESCE(p_is_default, false) THEN
    UPDATE ar_dunning_policies SET is_default = false
    WHERE organization_id = p_org_id AND id <> v_id;
    UPDATE ar_dunning_policies SET is_default = true WHERE id = v_id;
  END IF;

  IF jsonb_array_length(COALESCE(p_levels, '[]'::jsonb)) > 0 THEN
    DELETE FROM ar_dunning_levels WHERE policy_id = v_id;
    FOR v_level IN SELECT * FROM jsonb_array_elements(p_levels)
    LOOP
      INSERT INTO ar_dunning_levels (policy_id, level_no, days_overdue, template_code, description)
      VALUES (
        v_id,
        (v_level->>'level_no')::INT,
        (v_level->>'days_overdue')::INT,
        COALESCE(v_level->>'template_code', 'accounting.invoice_reminder'),
        v_level->>'description'
      );
    END LOOP;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_ar_dunning_policy(UUID, UUID, TEXT, BOOLEAN, BOOLEAN, INT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- Send dunning / escalate level
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_invoice_dunning(
  p_invoice_id UUID,
  p_level_no INT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_cust customers%ROWTYPE;
  v_policy_id UUID;
  v_level INT;
  v_event_id UUID;
  v_log_id UUID;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF public._invoice_balance_due(v_inv.total, v_inv.amount_paid, v_inv.amount_credited) <= 0.01 THEN
    RAISE EXCEPTION 'Invoice has no balance due';
  END IF;

  SELECT * INTO v_cust FROM customers WHERE id = v_inv.customer_id;

  v_policy_id := COALESCE(
    v_cust.ar_dunning_policy_id,
    public.ensure_default_ar_dunning_policy(v_inv.organization_id)
  );

  IF p_level_no IS NOT NULL THEN
    v_level := p_level_no;
  ELSE
    v_level := v_inv.dunning_level + 1;
    IF NOT EXISTS (
      SELECT 1 FROM ar_dunning_levels
      WHERE policy_id = v_policy_id AND level_no = v_level
    ) THEN
      SELECT MAX(level_no) INTO v_level FROM ar_dunning_levels WHERE policy_id = v_policy_id;
    END IF;
  END IF;

  IF v_cust.email IS NOT NULL AND trim(v_cust.email) <> '' THEN
  BEGIN
    v_event_id := public.enqueue_invoice_reminder_notification(p_invoice_id);
  EXCEPTION WHEN OTHERS THEN
    v_event_id := NULL;
  END;
  END IF;

  INSERT INTO ar_dunning_events (
    organization_id, invoice_id, customer_id, policy_id, level_no, channel, sent_by,
    details
  ) VALUES (
    v_inv.organization_id, p_invoice_id, v_inv.customer_id, v_policy_id, v_level,
    CASE WHEN v_event_id IS NOT NULL THEN 'email' ELSE 'manual' END,
    auth.uid(),
    jsonb_build_object(
      'notification_event_id', v_event_id,
      'balance_due', public._invoice_balance_due(v_inv.total, v_inv.amount_paid, v_inv.amount_credited)
    )
  ) RETURNING id INTO v_log_id;

  INSERT INTO invoice_reminder_logs (organization_id, invoice_id, reminded_by, note)
  VALUES (
    v_inv.organization_id, p_invoice_id, auth.uid(),
    'Dunning level ' || v_level
  );

  UPDATE customer_invoices
  SET dunning_level = GREATEST(dunning_level, v_level),
      collection_status = CASE
        WHEN collection_status = 'open' AND v_level >= 3 THEN 'in_collections'
        ELSE collection_status
      END
  WHERE id = p_invoice_id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_invoice_dunning(UUID, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_ar_dunning_batch(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy_id UUID;
  v_sent INT := 0;
  v_invoice RECORD;
  v_days INT;
  v_target_level INT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_policy_id := public.ensure_default_ar_dunning_policy(p_org_id);

  FOR v_invoice IN
    SELECT ci.*, c.ar_dunning_policy_id AS cust_policy_id
    FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = p_org_id
      AND ci.status IN ('posted', 'partially_paid')
      AND public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited) > 0.01
      AND ci.due_date IS NOT NULL
  LOOP
    v_days := current_date - v_invoice.due_date;
    IF v_days <= 0 THEN CONTINUE; END IF;

    SELECT MAX(l.level_no) INTO v_target_level
    FROM ar_dunning_levels l
    WHERE l.policy_id = COALESCE(v_invoice.cust_policy_id, v_policy_id)
      AND l.days_overdue <= v_days;

    IF v_target_level IS NULL OR v_target_level <= v_invoice.dunning_level THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM ar_dunning_events ade
      WHERE ade.invoice_id = v_invoice.id
        AND ade.level_no = v_target_level
    ) THEN
      CONTINUE;
    END IF;

    PERFORM public.send_invoice_dunning(v_invoice.id, v_target_level);
    v_sent := v_sent + 1;
  END LOOP;

  RETURN jsonb_build_object('sent', v_sent, 'run_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_ar_dunning_batch(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Collection status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_invoice_collection_status(
  p_invoice_id UUID,
  p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_status NOT IN ('open', 'promised', 'dispute', 'in_collections', 'written_off') THEN
    RAISE EXCEPTION 'Invalid collection status';
  END IF;

  UPDATE customer_invoices SET collection_status = p_status WHERE id = p_invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_invoice_collection_status(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Collections queue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_ar_collections_queue(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_data ORDER BY row_data->>'days_overdue' DESC, row_data->>'balance_due' DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', ci.id,
        'invoice_no', ci.invoice_no,
        'customer_name', c.name,
        'customer_email', c.email,
        'due_date', ci.due_date,
        'balance_due', public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited),
        'days_overdue', GREATEST(current_date - COALESCE(ci.due_date, ci.invoice_date), 0),
        'collection_status', ci.collection_status,
        'dunning_level', ci.dunning_level,
        'last_dunning_at', (
          SELECT MAX(sent_at) FROM ar_dunning_events ade WHERE ade.invoice_id = ci.id
        )
      ) AS row_data
      FROM customer_invoices ci
      LEFT JOIN customers c ON c.id = ci.customer_id
      WHERE ci.organization_id = p_org_id
        AND ci.status IN ('posted', 'partially_paid')
        AND public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited) > 0.01
        AND (
          ci.collection_status IN ('dispute', 'in_collections', 'promised')
          OR (ci.due_date IS NOT NULL AND ci.due_date < current_date)
        )
    ) sub
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_ar_collections_queue(UUID) TO authenticated;

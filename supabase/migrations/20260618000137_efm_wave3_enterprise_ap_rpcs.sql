-- EFM Wave 3 — Enterprise AP RPCs (requires 00135 enum + 00136 schema)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bill_balance_due(p_amount NUMERIC, p_amount_paid NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(COALESCE(p_amount, 0) - COALESCE(p_amount_paid, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public._vendor_bill_duplicate_hash(
  p_vendor_id UUID,
  p_bill_date DATE,
  p_amount NUMERIC,
  p_bill_no TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(
    COALESCE(p_vendor_id::text, '') || '|' ||
    COALESCE(p_bill_date::text, '') || '|' ||
    COALESCE(round(p_amount, 2)::text, '') || '|' ||
    COALESCE(NULLIF(trim(p_bill_no), ''), '')
  );
$$;

CREATE OR REPLACE FUNCTION public._refresh_vendor_bill_payment_status(p_bill_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill vendor_bills%ROWTYPE;
  v_balance NUMERIC;
BEGIN
  SELECT * INTO v_bill FROM vendor_bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_bill.status = 'draft'::bill_status THEN RETURN; END IF;

  v_balance := public._bill_balance_due(v_bill.amount, v_bill.amount_paid);

  IF v_balance <= 0.01 THEN
    UPDATE vendor_bills
    SET status = 'paid'::bill_status, amount_paid = amount
    WHERE id = p_bill_id;
  ELSIF v_bill.amount_paid > 0.01 THEN
    UPDATE vendor_bills SET status = 'partially_paid'::bill_status WHERE id = p_bill_id;
  ELSE
    UPDATE vendor_bills SET status = 'open'::bill_status WHERE id = p_bill_id AND status <> 'open'::bill_status;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Standalone vendor bill (draft)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_vendor_bill(
  p_org_id UUID,
  p_vendor_id UUID,
  p_bill_no TEXT DEFAULT NULL,
  p_bill_date DATE DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_memo TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill_id UUID;
  v_line JSONB;
  v_total NUMERIC := 0;
  v_line_amt NUMERIC;
  v_hash TEXT;
  v_terms INT;
  v_due DATE;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = p_vendor_id AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'Vendor not found';
  END IF;
  IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one line is required';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_amt := COALESCE((v_line->>'amount')::NUMERIC, 0);
    IF v_line_amt <= 0 THEN RAISE EXCEPTION 'Line amount must be positive'; END IF;
    v_total := v_total + v_line_amt;
  END LOOP;

  v_hash := public._vendor_bill_duplicate_hash(p_vendor_id, COALESCE(p_bill_date, current_date), v_total, p_bill_no);

  IF EXISTS (
    SELECT 1 FROM vendor_bills
    WHERE organization_id = p_org_id AND duplicate_hash = v_hash AND status <> 'draft'::bill_status
  ) THEN
    RAISE EXCEPTION 'Duplicate vendor bill detected for this vendor, date, and amount';
  END IF;

  SELECT payment_terms_days INTO v_terms FROM vendors WHERE id = p_vendor_id;
  v_due := COALESCE(p_due_date, COALESCE(p_bill_date, current_date) + COALESCE(v_terms, 30));

  INSERT INTO vendor_bills (
    organization_id, vendor_id, bill_no, bill_date, due_date, amount, status,
    match_status, duplicate_hash, memo, source_type
  ) VALUES (
    p_org_id, p_vendor_id, NULLIF(trim(p_bill_no), ''), COALESCE(p_bill_date, current_date), v_due,
    v_total, 'draft'::bill_status, 'standalone', v_hash, NULLIF(trim(p_memo), ''), 'manual'
  ) RETURNING id INTO v_bill_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO vendor_bill_lines (bill_id, organization_id, description, amount, account_id)
    VALUES (
      v_bill_id, p_org_id,
      COALESCE(v_line->>'description', 'Line item'),
      (v_line->>'amount')::NUMERIC,
      NULLIF(v_line->>'accountId', '')::UUID
    );
  END LOOP;

  RETURN v_bill_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_vendor_bill(UUID, UUID, TEXT, DATE, DATE, TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- Post standalone draft bill to GL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_vendor_bill(p_bill_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill vendor_bills%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_entry_id UUID;
  v_expense_acct UUID;
  v_line RECORD;
BEGIN
  SELECT * INTO v_bill FROM vendor_bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF NOT public.user_can_manage(v_bill.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_bill.status <> 'draft'::bill_status THEN RAISE EXCEPTION 'Only draft bills can be posted'; END IF;
  IF v_bill.journal_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Bill already posted'; END IF;

  PERFORM public.ensure_default_accounts(v_bill.organization_id);
  v_expense_acct := public.account_id_by_code(v_bill.organization_id, '6200');

  FOR v_line IN SELECT * FROM vendor_bill_lines WHERE bill_id = p_bill_id LOOP
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', COALESCE(v_line.account_id, v_expense_acct),
      'debit', v_line.amount,
      'credit', 0,
      'description', v_line.description
    ));
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
    v_lines := jsonb_build_array(jsonb_build_object(
      'accountId', v_expense_acct,
      'debit', v_bill.amount,
      'credit', 0,
      'description', COALESCE(v_bill.memo, 'Vendor bill')
    ));
  END IF;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'accountId', public.account_id_by_code(v_bill.organization_id, '2000'),
    'debit', 0,
    'credit', v_bill.amount,
    'description', 'Accounts payable'
  ));

  v_entry_id := public._post_journal_entry_balanced(
    v_bill.organization_id, 'PUR', v_bill.bill_date,
    COALESCE(v_bill.memo, 'Vendor bill ' || COALESCE(v_bill.bill_no, p_bill_id::text)),
    'vendor_bill', p_bill_id, v_lines, auth.uid()
  );

  UPDATE vendor_bills
  SET status = 'open'::bill_status, journal_entry_id = v_entry_id, match_status = 'standalone'
  WHERE id = p_bill_id;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_vendor_bill(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3-way match validation (PO ↔ receipt ↔ bill)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_vendor_bill_match(p_bill_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill vendor_bills%ROWTYPE;
  v_po purchase_orders%ROWTYPE;
  v_match TEXT := 'unmatched';
  v_variance NUMERIC := 0;
BEGIN
  SELECT * INTO v_bill FROM vendor_bills WHERE id = p_bill_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF NOT public.user_has_org_access(v_bill.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF v_bill.po_id IS NULL THEN
    RETURN jsonb_build_object('match_status', v_bill.match_status, 'variance', 0, 'message', 'No PO linked');
  END IF;

  SELECT * INTO v_po FROM purchase_orders WHERE id = v_bill.po_id;
  IF NOT FOUND THEN
    v_match := 'exception';
  ELSIF v_po.status <> 'received' THEN
    v_match := 'two_way';
  ELSE
    v_variance := abs(v_bill.amount - v_po.total);
    IF v_variance <= 0.01 THEN
      v_match := 'three_way';
    ELSE
      v_match := 'exception';
    END IF;
  END IF;

  IF public.user_can_manage(v_bill.organization_id) THEN
    UPDATE vendor_bills SET match_status = v_match WHERE id = p_bill_id;
  END IF;

  RETURN jsonb_build_object(
    'bill_id', p_bill_id,
    'po_id', v_bill.po_id,
    'po_total', v_po.total,
    'bill_amount', v_bill.amount,
    'variance', v_variance,
    'match_status', v_match,
    'po_status', v_po.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_vendor_bill_match(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Pay vendor bill — full or partial
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pay_vendor_bill(UUID, payment_method);

CREATE OR REPLACE FUNCTION public.pay_vendor_bill(
  p_bill_id UUID,
  p_payment_method payment_method,
  p_amount NUMERIC DEFAULT NULL,
  p_payment_date DATE DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_payment_run_id UUID DEFAULT NULL,
  p_discount_taken NUMERIC DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill vendor_bills%ROWTYPE;
  v_pay_acct UUID;
  v_entry_id UUID;
  v_balance NUMERIC;
  v_pay_amount NUMERIC;
  v_discount NUMERIC := GREATEST(COALESCE(p_discount_taken, 0), 0);
  v_date DATE;
  v_vendor vendors%ROWTYPE;
BEGIN
  SELECT * INTO v_bill FROM vendor_bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF NOT public.user_can_manage(v_bill.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_bill.status NOT IN ('open', 'partially_paid') THEN
    RAISE EXCEPTION 'Bill must be open with a balance due';
  END IF;
  IF v_bill.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Bill must be posted before payment';
  END IF;
  IF p_payment_method IN ('on_account', 'store_credit', 'gift_card', 'loyalty') THEN
    RAISE EXCEPTION 'Invalid payment method for vendor bill';
  END IF;

  v_balance := public._bill_balance_due(v_bill.amount, v_bill.amount_paid);
  IF v_balance <= 0.01 THEN RAISE EXCEPTION 'Bill has no balance due'; END IF;

  v_pay_amount := COALESCE(p_amount, v_balance);
  IF v_pay_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be positive'; END IF;
  IF v_pay_amount + v_discount > v_balance + 0.01 THEN
    RAISE EXCEPTION 'Payment plus discount exceeds balance due';
  END IF;

  v_date := COALESCE(p_payment_date, current_date);

  SELECT * INTO v_vendor FROM vendors WHERE id = v_bill.vendor_id;
  IF v_discount = 0
    AND v_vendor.early_pay_discount_percent IS NOT NULL
    AND v_vendor.early_pay_discount_days IS NOT NULL
    AND v_bill.due_date IS NOT NULL
    AND v_date <= v_bill.bill_date + v_vendor.early_pay_discount_days
  THEN
    v_discount := round(v_pay_amount * v_vendor.early_pay_discount_percent / 100, 2);
  END IF;

  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(v_bill.organization_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(v_bill.organization_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(v_bill.organization_id, '1020')
    ELSE public.account_id_by_code(v_bill.organization_id, '1000')
  END;

  v_entry_id := public._post_journal_entry_balanced(
    v_bill.organization_id, 'PUR', v_date,
    'Vendor bill payment' || COALESCE(' — ' || NULLIF(trim(p_reference), ''), ''),
    'bill_payment', p_bill_id,
    (
      SELECT jsonb_agg(line_obj)
      FROM (
        SELECT jsonb_build_object(
          'accountId', public.account_id_by_code(v_bill.organization_id, '2000'),
          'debit', v_pay_amount + v_discount, 'credit', 0, 'description', 'AP cleared'
        ) AS line_obj
        UNION ALL
        SELECT jsonb_build_object(
          'accountId', v_pay_acct,
          'debit', 0, 'credit', v_pay_amount, 'description', 'Payment sent'
        )
        UNION ALL
        SELECT jsonb_build_object(
          'accountId', public.account_id_by_code(v_bill.organization_id, '6200'),
          'debit', 0, 'credit', v_discount, 'description', 'Early payment discount'
        )
        WHERE v_discount > 0
      ) lines
    ),
    auth.uid()
  );

  INSERT INTO vendor_bill_payments (
    organization_id, bill_id, payment_date, amount, payment_method,
    journal_entry_id, payment_run_id, reference, discount_taken, created_by
  ) VALUES (
    v_bill.organization_id, p_bill_id, v_date, v_pay_amount, p_payment_method,
    v_entry_id, p_payment_run_id, NULLIF(trim(p_reference), ''), v_discount, auth.uid()
  );

  UPDATE vendor_bills
  SET amount_paid = amount_paid + v_pay_amount + v_discount,
      paid_entry_id = COALESCE(paid_entry_id, v_entry_id)
  WHERE id = p_bill_id;

  PERFORM public._refresh_vendor_bill_payment_status(p_bill_id);

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_vendor_bill(UUID, payment_method, NUMERIC, DATE, TEXT, UUID, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- Open bills + vendor AP summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_vendor_open_bills(
  p_org_id UUID,
  p_vendor_id UUID DEFAULT NULL,
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
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM vendor_bills vb
  WHERE vb.organization_id = p_org_id
    AND vb.status IN ('open', 'partially_paid')
    AND public._bill_balance_due(vb.amount, vb.amount_paid) > 0.01
    AND vb.journal_entry_id IS NOT NULL
    AND (p_vendor_id IS NULL OR vb.vendor_id = p_vendor_id);

  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'due_date', row_data->>'bill_date'), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', vb.id,
      'bill_no', vb.bill_no,
      'bill_date', vb.bill_date,
      'due_date', vb.due_date,
      'vendor_id', vb.vendor_id,
      'vendor_name', v.name,
      'amount', vb.amount,
      'amount_paid', vb.amount_paid,
      'balance_due', public._bill_balance_due(vb.amount, vb.amount_paid),
      'match_status', vb.match_status,
      'po_id', vb.po_id,
      'days_until_due', vb.due_date - current_date
    ) AS row_data
    FROM vendor_bills vb
    JOIN vendors v ON v.id = vb.vendor_id
    WHERE vb.organization_id = p_org_id
      AND vb.status IN ('open', 'partially_paid')
      AND public._bill_balance_due(vb.amount, vb.amount_paid) > 0.01
      AND vb.journal_entry_id IS NOT NULL
      AND (p_vendor_id IS NULL OR vb.vendor_id = p_vendor_id)
    ORDER BY vb.due_date NULLS LAST, vb.bill_date DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('total', v_total, 'bills', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_vendor_open_bills(UUID, UUID, INT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_vendors_ap_summary(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_data ORDER BY row_data->>'vendor_name')
    FROM (
      SELECT jsonb_build_object(
        'vendor_id', v.id,
        'vendor_name', v.name,
        'open_amount', COALESCE(b.open_total, 0),
        'open_bill_count', COALESCE(b.open_count, 0),
        'overdue_amount', COALESCE(b.overdue_total, 0)
      ) AS row_data,
      v.name
      FROM vendors v
      LEFT JOIN (
        SELECT
          vb.vendor_id,
          SUM(public._bill_balance_due(vb.amount, vb.amount_paid)) AS open_total,
          SUM(CASE
            WHEN COALESCE(vb.due_date, vb.bill_date) < current_date
            THEN public._bill_balance_due(vb.amount, vb.amount_paid) ELSE 0
          END) AS overdue_total,
          COUNT(*)::INT AS open_count
        FROM vendor_bills vb
        WHERE vb.organization_id = p_org_id
          AND vb.status IN ('open', 'partially_paid')
          AND public._bill_balance_due(vb.amount, vb.amount_paid) > 0.01
          AND vb.journal_entry_id IS NOT NULL
        GROUP BY vb.vendor_id
      ) b ON b.vendor_id = v.id
      WHERE v.organization_id = p_org_id AND COALESCE(b.open_total, 0) > 0.01
    ) sub
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_vendors_ap_summary(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- AP aging — open balance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accounts_payable_aging(
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
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  FOR r IN
    SELECT
      vb.id,
      COALESCE(vb.bill_no, vb.id::text) AS reference,
      v.name AS vendor_name,
      public._bill_balance_due(vb.amount, vb.amount_paid) AS amount,
      COALESCE(vb.due_date, vb.bill_date) AS due_date
    FROM vendor_bills vb
    JOIN vendors v ON v.id = vb.vendor_id
    WHERE vb.organization_id = p_org_id
      AND vb.status IN ('open', 'partially_paid')
      AND public._bill_balance_due(vb.amount, vb.amount_paid) > 0.01
      AND vb.journal_entry_id IS NOT NULL
  LOOP
    v_amt := COALESCE(r.amount, 0);
    IF v_amt <= 0 THEN CONTINUE; END IF;

    v_days := p_as_of - r.due_date;
    IF v_days <= 0 THEN
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
      'id', r.id,
      'reference', r.reference,
      'vendor_name', r.vendor_name,
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
-- Paginated vendor bills — open balance fields
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_vendor_bills_page(
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
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM vendor_bills vb
  JOIN vendors v ON v.id = vb.vendor_id
  WHERE vb.organization_id = p_org_id
    AND (p_from IS NULL OR vb.bill_date >= p_from)
    AND (p_to IS NULL OR vb.bill_date <= p_to)
    AND (p_status IS NULL OR vb.status::text = p_status)
    AND (
      v_q IS NULL
      OR COALESCE(vb.bill_no, '') ILIKE '%' || v_q || '%'
      OR v.name ILIKE '%' || v_q || '%'
    );

  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'bill_date' DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', vb.id,
      'bill_no', vb.bill_no,
      'bill_date', vb.bill_date,
      'due_date', vb.due_date,
      'status', vb.status,
      'amount', vb.amount,
      'amount_paid', vb.amount_paid,
      'balance_due', public._bill_balance_due(vb.amount, vb.amount_paid),
      'match_status', vb.match_status,
      'source_type', vb.source_type,
      'vendor_id', vb.vendor_id,
      'vendor_name', v.name,
      'po_id', vb.po_id,
      'journal_entry_id', vb.journal_entry_id,
      'paid_entry_id', vb.paid_entry_id,
      'created_at', vb.created_at
    ) AS row_data
    FROM vendor_bills vb
    JOIN vendors v ON v.id = vb.vendor_id
    WHERE vb.organization_id = p_org_id
      AND (p_from IS NULL OR vb.bill_date >= p_from)
      AND (p_to IS NULL OR vb.bill_date <= p_to)
      AND (p_status IS NULL OR vb.status::text = p_status)
      AND (
        v_q IS NULL
        OR COALESCE(vb.bill_no, '') ILIKE '%' || v_q || '%'
        OR v.name ILIKE '%' || v_q || '%'
      )
    ORDER BY vb.bill_date DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('total', v_total, 'bills', v_rows);
END;
$$;

-- ---------------------------------------------------------------------------
-- Vendor statement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_vendor_statement(
  p_org_id UUID,
  p_vendor_id UUID,
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
  v_vendor vendors%ROWTYPE;
  v_opening NUMERIC := 0;
  v_lines JSONB;
  v_closing NUMERIC := 0;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_vendor FROM vendors WHERE id = p_vendor_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vendor not found'; END IF;

  SELECT COALESCE(SUM(public._bill_balance_due(vb.amount, vb.amount_paid)), 0)
  INTO v_opening
  FROM vendor_bills vb
  WHERE vb.organization_id = p_org_id
    AND vb.vendor_id = p_vendor_id
    AND vb.journal_entry_id IS NOT NULL
    AND vb.bill_date < v_from
    AND vb.status IN ('open', 'partially_paid', 'paid');

  v_lines := COALESCE((
    SELECT jsonb_agg(row_data ORDER BY row_data->>'txn_date', row_data->>'sort_key')
    FROM (
      SELECT jsonb_build_object(
        'txn_date', vb.bill_date,
        'sort_key', 'bill:' || vb.id::text,
        'type', 'bill',
        'reference', COALESCE(vb.bill_no, vb.id::text),
        'description', COALESCE(vb.memo, 'Vendor bill'),
        'debit', vb.amount,
        'credit', 0,
        'balance_effect', vb.amount
      ) AS row_data
      FROM vendor_bills vb
      WHERE vb.organization_id = p_org_id AND vb.vendor_id = p_vendor_id
        AND vb.journal_entry_id IS NOT NULL
        AND vb.bill_date BETWEEN v_from AND v_to

      UNION ALL

      SELECT jsonb_build_object(
        'txn_date', vbp.payment_date,
        'sort_key', 'pay:' || vbp.id::text,
        'type', 'payment',
        'reference', COALESCE(vbp.reference, 'Payment'),
        'description', 'Payment',
        'debit', 0,
        'credit', vbp.amount + vbp.discount_taken,
        'balance_effect', -(vbp.amount + vbp.discount_taken)
      )
      FROM vendor_bill_payments vbp
      JOIN vendor_bills vb ON vb.id = vbp.bill_id
      WHERE vbp.organization_id = p_org_id AND vb.vendor_id = p_vendor_id
        AND vbp.payment_date BETWEEN v_from AND v_to
    ) sub
  ), '[]'::jsonb);

  SELECT v_opening + COALESCE(SUM((l->>'balance_effect')::NUMERIC), 0)
  INTO v_closing
  FROM jsonb_array_elements(v_lines) l;

  RETURN jsonb_build_object(
    'vendor_id', p_vendor_id,
    'vendor_name', v_vendor.name,
    'from', v_from,
    'to', v_to,
    'opening_balance', round(v_opening, 2),
    'closing_balance', round(v_closing, 2),
    'lines', v_lines
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_vendor_statement(UUID, UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Payment runs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_payment_run(
  p_org_id UUID,
  p_bill_ids UUID[],
  p_payment_method payment_method DEFAULT 'bank_transfer',
  p_run_date DATE DEFAULT NULL,
  p_memo TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_bill_id UUID;
  v_bill vendor_bills%ROWTYPE;
  v_total NUMERIC := 0;
  v_balance NUMERIC;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_bill_ids IS NULL OR array_length(p_bill_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one bill is required';
  END IF;

  INSERT INTO ap_payment_runs (organization_id, run_date, payment_method, status, memo, created_by)
  VALUES (p_org_id, COALESCE(p_run_date, current_date), p_payment_method, 'draft', NULLIF(trim(p_memo), ''), auth.uid())
  RETURNING id INTO v_run_id;

  FOREACH v_bill_id IN ARRAY p_bill_ids LOOP
    SELECT * INTO v_bill FROM vendor_bills WHERE id = v_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.organization_id <> p_org_id THEN
      RAISE EXCEPTION 'Bill not found';
    END IF;
    v_balance := public._bill_balance_due(v_bill.amount, v_bill.amount_paid);
    IF v_balance <= 0.01 THEN RAISE EXCEPTION 'Bill % has no balance due', v_bill_id; END IF;

    INSERT INTO ap_payment_run_lines (run_id, organization_id, bill_id, amount)
    VALUES (v_run_id, p_org_id, v_bill_id, v_balance);
    v_total := v_total + v_balance;
  END LOOP;

  UPDATE ap_payment_runs SET total_amount = v_total WHERE id = v_run_id;
  RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment_run(UUID, UUID[], payment_method, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_payment_run(p_run_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run ap_payment_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM ap_payment_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment run not found'; END IF;
  IF NOT public.user_can_manage(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'Only draft runs can be approved'; END IF;

  UPDATE ap_payment_runs
  SET status = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = p_run_id;

  RETURN p_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_payment_run(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.execute_payment_run(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run ap_payment_runs%ROWTYPE;
  v_line RECORD;
  v_paid INT := 0;
BEGIN
  SELECT * INTO v_run FROM ap_payment_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment run not found'; END IF;
  IF NOT public.user_can_manage(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status <> 'approved' THEN RAISE EXCEPTION 'Payment run must be approved'; END IF;

  FOR v_line IN SELECT * FROM ap_payment_run_lines WHERE run_id = p_run_id LOOP
    PERFORM public.pay_vendor_bill(
      v_line.bill_id, v_run.payment_method, v_line.amount, v_run.run_date,
      'Payment run ' || p_run_id::text, p_run_id, 0
    );
    v_paid := v_paid + 1;
  END LOOP;

  UPDATE ap_payment_runs SET status = 'executed', executed_at = now() WHERE id = p_run_id;

  RETURN jsonb_build_object('run_id', p_run_id, 'paid', v_paid, 'total_amount', v_run.total_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_payment_run(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_payment_runs(p_org_id UUID, p_limit INT DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_data ORDER BY row_data->>'run_date' DESC, row_data->>'created_at' DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', r.id,
        'run_date', r.run_date,
        'payment_method', r.payment_method,
        'status', r.status,
        'total_amount', r.total_amount,
        'memo', r.memo,
        'line_count', (SELECT COUNT(*)::INT FROM ap_payment_run_lines l WHERE l.run_id = r.id),
        'created_at', r.created_at,
        'approved_at', r.approved_at,
        'executed_at', r.executed_at
      ) AS row_data,
      r.run_date,
      r.created_at
    FROM ap_payment_runs r
    WHERE r.organization_id = p_org_id
    ORDER BY r.run_date DESC, r.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
    ) sub
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_payment_runs(UUID, INT) TO authenticated;

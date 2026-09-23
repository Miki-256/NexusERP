-- UAT P0/P2: sync POS auto-post to GL; fix queue false-success; SKU search;
-- invalidate financial_report_cache after sale post / batch post.

-- ---------------------------------------------------------------------------
-- post_sale_to_ledger_internal: org business date + cache invalidate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_sale_to_ledger_internal(p_sale_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_lines JSONB := '[]'::jsonb;
  v_cogs NUMERIC := 0;
  v_merch_revenue NUMERIC;
  v_tip NUMERIC;
  v_entry_id UUID;
  v_pay RECORD;
  v_acct_date DATE;
  v_tz TEXT;
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

  SELECT * INTO v_org FROM organizations WHERE id = v_sale.organization_id;
  v_tz := COALESCE(NULLIF(trim(v_org.timezone), ''), 'Africa/Addis_Ababa');
  -- Business date = calendar date of sale instant in org timezone (not UTC ::date).
  v_acct_date := (v_sale.created_at AT TIME ZONE v_tz)::date;

  PERFORM public.ensure_default_accounts(v_sale.organization_id);

  v_merch_revenue := v_sale.subtotal - v_sale.discount_amount;
  v_tip := GREATEST(COALESCE(v_sale.tip_amount, 0), 0);

  SELECT COALESCE(SUM(
    COALESCE(sl.qty_base, sl.quantity) * COALESCE(pv.cost_price, p.cost_price, 0)
  ), 0)
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
    v_sale.organization_id, 'SAL', v_acct_date,
    'Sale ' || v_sale.receipt_no, 'sale', p_sale_id, v_lines, auth.uid()
  );

  -- Best-effort cache bust (no manage ACL — cashiers can complete sales)
  DELETE FROM financial_report_cache WHERE organization_id = v_sale.organization_id;

  RETURN v_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Queue drain: only delete when JE exists (or already posted)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_sale_ledger_post_queue(p_limit INT DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_posted INT := 0;
  v_failed INT := 0;
  v_limit INT := GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
  v_entry UUID;
  v_has_je BOOLEAN;
BEGIN
  FOR v_row IN
    SELECT q.sale_id, q.organization_id
    FROM sale_ledger_post_queue q
    ORDER BY q.enqueued_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.organization_id = v_row.organization_id
          AND je.source_type = 'sale'
          AND je.source_id = v_row.sale_id
      ) INTO v_has_je;

      IF v_has_je THEN
        DELETE FROM sale_ledger_post_queue WHERE sale_id = v_row.sale_id;
        v_posted := v_posted + 1;
        CONTINUE;
      END IF;

      v_entry := public.post_sale_to_ledger_internal(v_row.sale_id);

      SELECT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.organization_id = v_row.organization_id
          AND je.source_type = 'sale'
          AND je.source_id = v_row.sale_id
      ) INTO v_has_je;

      IF v_has_je THEN
        DELETE FROM sale_ledger_post_queue WHERE sale_id = v_row.sale_id;
        v_posted := v_posted + 1;
      ELSE
        UPDATE sale_ledger_post_queue
        SET attempts = attempts + 1,
            last_error = COALESCE(
              NULLIF(trim(last_error), ''),
              'post_sale_to_ledger_internal returned without creating a journal'
            )
        WHERE sale_id = v_row.sale_id;
        v_failed := v_failed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE sale_ledger_post_queue
      SET attempts = attempts + 1, last_error = SQLERRM
      WHERE sale_id = v_row.sale_id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'posted', v_posted,
    'failed', v_failed,
    'pending', (SELECT COUNT(*)::INT FROM sale_ledger_post_queue)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_retry_sale_ledger_post(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry UUID;
  v_org UUID;
  v_has_je BOOLEAN;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sale_ledger_post_queue WHERE sale_id = p_sale_id) THEN
    RAISE EXCEPTION 'Sale is not in the ledger post queue';
  END IF;

  SELECT organization_id INTO v_org FROM sale_ledger_post_queue WHERE sale_id = p_sale_id;

  UPDATE sale_ledger_post_queue
  SET attempts = 0, last_error = NULL
  WHERE sale_id = p_sale_id;

  BEGIN
    v_entry := public.post_sale_to_ledger_internal(p_sale_id);
    SELECT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.organization_id = v_org
        AND je.source_type = 'sale'
        AND je.source_id = p_sale_id
    ) INTO v_has_je;

    IF v_has_je THEN
      DELETE FROM sale_ledger_post_queue WHERE sale_id = p_sale_id;
      RETURN jsonb_build_object(
        'ok', true,
        'sale_id', p_sale_id,
        'journal_entry_id', v_entry
      );
    END IF;

    UPDATE sale_ledger_post_queue
    SET attempts = attempts + 1,
        last_error = 'post_sale_to_ledger_internal returned without creating a journal'
    WHERE sale_id = p_sale_id;
    RETURN jsonb_build_object(
      'ok', false,
      'sale_id', p_sale_id,
      'journal_entry_id', NULL,
      'error', 'No journal created'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE sale_ledger_post_queue
    SET attempts = attempts + 1, last_error = SQLERRM
    WHERE sale_id = p_sale_id;
    RETURN jsonb_build_object(
      'ok', false,
      'sale_id', p_sale_id,
      'error', SQLERRM
    );
  END;
END;
$$;

-- Mobile-money confirm: sync post (seconds), enqueue only on hard failure
CREATE OR REPLACE FUNCTION public.maybe_auto_post_sale(p_sale_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_entry UUID;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_sale.organization_id;
  IF NOT COALESCE(v_org.pos_auto_post_sales, false) THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_entry := public.post_sale_to_ledger_internal(p_sale_id);
    IF v_entry IS NOT NULL OR EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.organization_id = v_sale.organization_id
        AND je.source_type = 'sale'
        AND je.source_id = p_sale_id
    ) THEN
      DELETE FROM sale_ledger_post_queue WHERE sale_id = p_sale_id;
      RETURN v_entry;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO sale_ledger_post_queue (sale_id, organization_id, attempts, last_error)
    VALUES (p_sale_id, v_sale.organization_id, 1, SQLERRM)
    ON CONFLICT (sale_id) DO UPDATE
      SET attempts = sale_ledger_post_queue.attempts + 1,
          last_error = EXCLUDED.last_error;
    RETURN NULL;
  END;

  PERFORM public.enqueue_sale_ledger_post(p_sale_id);
  UPDATE sale_ledger_post_queue
  SET last_error = COALESCE(last_error, 'Sync auto-post did not create a journal; queued for retry')
  WHERE sale_id = p_sale_id;
  RETURN NULL;
END;
$$;

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
  v_first_error TEXT;
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
        DELETE FROM sale_ledger_post_queue WHERE sale_id = v_sale_id;
      ELSE
        v_skipped := v_skipped + 1;
        IF v_first_error IS NULL THEN
          v_first_error := 'Sale skipped (pending payment or already posted)';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      IF v_first_error IS NULL THEN
        v_first_error := SQLERRM;
      END IF;
    END;
  END LOOP;

  IF v_posted > 0 THEN
    PERFORM public.invalidate_financial_report_cache(p_org_id, NULL);
  END IF;

  RETURN jsonb_build_object(
    'posted', v_posted,
    'skipped', v_skipped,
    'remaining', public.count_unposted_sales(p_org_id),
    'first_error', v_first_error
  );
END;
$$;

-- SKU substring search (parity with name)
CREATE OR REPLACE FUNCTION public.get_pos_catalog_page(
  p_register_id UUID,
  p_search TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_limit INT DEFAULT 200,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_store UUID;
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_q TEXT := NULLIF(trim(p_search), '');
  v_cat TEXT := NULLIF(trim(p_category), '');
  v_total BIGINT;
  v_items JSONB;
BEGIN
  SELECT organization_id, store_id INTO v_org, v_store
  FROM registers WHERE id = p_register_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM products p
  JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.organization_id = v_org AND p.is_active = true
    AND (v_cat IS NULL OR c.name = v_cat)
    AND (
      v_q IS NULL
      OR p.name ILIKE '%' || v_q || '%'
      OR pv.name ILIKE '%' || v_q || '%'
      OR pv.barcode = v_q
      OR p.barcode = v_q
      OR COALESCE(pv.sku, '') ILIKE '%' || v_q || '%'
      OR COALESCE(p.sku, '') ILIKE '%' || v_q || '%'
    );

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'name'), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'productId', p.id,
      'variantId', pv.id,
      'name', p.name,
      'variantName', pv.name,
      'sellPrice', COALESCE(pv.sell_price, p.sell_price),
      'barcode', COALESCE(pv.barcode, p.barcode),
      'sku', COALESCE(pv.sku, p.sku),
      'stock', COALESCE(il.quantity, 0),
      'categoryId', p.category_id,
      'categoryName', c.name,
      'imageUrl', p.image_url,
      'saleUoms', COALESCE(uoms.arr, '[]'::jsonb)
    ) AS row,
    p.name
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN inventory_levels il ON il.variant_id = pv.id AND il.store_id = v_store
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'code', u.uom_code,
          'name', u.uom_name,
          'factor', u.conversion_factor,
          'isBase', u.is_base
        )
        ORDER BY u.is_base DESC, u.uom_code
      ) AS arr
      FROM product_uoms u
      WHERE u.product_id = p.id AND (u.is_sale OR u.is_base)
    ) uoms ON true
    WHERE p.organization_id = v_org AND p.is_active = true
      AND (v_cat IS NULL OR c.name = v_cat)
      AND (
        v_q IS NULL
        OR p.name ILIKE '%' || v_q || '%'
        OR pv.name ILIKE '%' || v_q || '%'
        OR pv.barcode = v_q
        OR p.barcode = v_q
        OR COALESCE(pv.sku, '') ILIKE '%' || v_q || '%'
        OR COALESCE(p.sku, '') ILIKE '%' || v_q || '%'
      )
    ORDER BY p.name
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'offset', v_offset,
    'limit', v_limit,
    'has_more', (v_offset + v_limit) < v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_catalog_page(UUID, TEXT, TEXT, INT, INT) TO anon, authenticated;


-- Sync auto-post inside complete_sale

CREATE OR REPLACE FUNCTION public.complete_sale(
  p_organization_id UUID,
  p_store_id UUID,
  p_register_id UUID,
  p_session_id UUID,
  p_idempotency_key UUID,
  p_lines JSONB,
  p_discount_amount NUMERIC,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_payments JSONB,
  p_pos_staff_id UUID DEFAULT NULL,
  p_pos_session_token TEXT DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_promotion_code TEXT DEFAULT NULL,
  p_tip_amount NUMERIC DEFAULT 0,
  p_manager_discount_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_staff_id UUID;
  v_org organizations%ROWTYPE;
  v_receipt_no TEXT;
  v_sale_id UUID;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_tip NUMERIC := GREATEST(COALESCE(p_tip_amount, 0), 0);
  v_merch_subtotal NUMERIC := 0;
  v_gross_merch NUMERIC := 0;
  v_line_discounts_total NUMERIC := 0;
  v_line JSONB;
  v_variant_id UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_line_discount NUMERIC;
  v_line_gross NUMERIC;
  v_line_subtotal NUMERIC;
  v_line_tax NUMERIC;
  v_line_total NUMERIC;
  v_tax_rate NUMERIC;
  v_payment_total NUMERIC := 0;
  v_payment JSONB;
  v_payment_amount NUMERIC;
  v_existing_sale UUID;
  v_dup_receipt TEXT;
  v_dup_total NUMERIC;
  v_stock NUMERIC;
  v_staff_sess RECORD;
  v_credit_total NUMERIC := 0;
  v_credit_balance NUMERIC := 0;
  v_on_account_total NUMERIC := 0;
  v_receivable_balance NUMERIC := 0;
  v_credit_limit NUMERIC;
  v_on_account_enabled BOOLEAN;
  v_cust_name TEXT;
  v_cust_phone TEXT;
  v_promo promotions%ROWTYPE;
  v_promo_discount NUMERIC := 0;
  v_manual_discount NUMERIC := GREATEST(COALESCE(p_discount_amount, 0), 0);
  v_promo_result JSONB;
  v_pay_status payment_status;
  v_has_pending_payments BOOLEAN := false;
  v_tax_rates JSONB := '{}'::jsonb;
  v_gift_card_total NUMERIC := 0;
  v_loyalty_total NUMERIC := 0;
  v_loyalty_points_total INT := 0;
  v_loyalty_points_earned INT := 0;
  v_journal_entry_id UUID;
  v_loyalty_pts INT;
  v_uom_code TEXT;
  v_qty_base NUMERIC;
  v_product_id UUID;
  v_resolved_lines JSONB := '[]'::jsonb;
  v_stock_need JSONB := '{}'::jsonb;
  v_need_key TEXT;
  v_need_qty NUMERIC;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NOT NULL THEN
    IF NOT public.user_has_org_access(p_organization_id) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    v_staff_id := p_pos_staff_id;
  ELSIF p_pos_session_token IS NOT NULL THEN
    SELECT * INTO v_staff_sess FROM public.validate_pos_staff_session(p_pos_session_token);
    IF NOT FOUND OR v_staff_sess.organization_id <> p_organization_id THEN
      RAISE EXCEPTION 'Invalid POS session';
    END IF;
    v_staff_id := v_staff_sess.staff_id;
  ELSE
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key is required';
  END IF;

  SELECT id, receipt_no, total
  INTO v_existing_sale, v_dup_receipt, v_dup_total
  FROM sales
  WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'sale_id', v_existing_sale,
      'receipt_no', v_dup_receipt,
      'total', v_dup_total,
      'duplicate', true
    );
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;

  IF NOT COALESCE(v_org.pos_tips_enabled, false) AND v_tip > 0 THEN
    RAISE EXCEPTION 'Tips are not enabled for this organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM register_sessions
    WHERE id = p_session_id AND register_id = p_register_id AND closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Register session is not open';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT name, phone, on_account_enabled, credit_limit
    INTO v_cust_name, v_cust_phone, v_on_account_enabled, v_credit_limit
    FROM customers
    WHERE id = p_customer_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer not found';
    END IF;
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Sale must include at least one line item';
  END IF;

  -- Preload per-variant tax rates (avoids repeated subqueries in line loops)
  SELECT COALESCE(jsonb_object_agg(pv.id::TEXT, COALESCE(p.tax_rate, v_org.tax_rate)), '{}'::jsonb)
  INTO v_tax_rates
  FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  WHERE pv.id IN (
    SELECT (elem->>'variantId')::UUID
    FROM jsonb_array_elements(p_lines) elem
  );

  v_receipt_no := public.next_receipt_number(p_store_id);

  -- Resolve UOMs once; aggregate stock demand; lock distinct variants once (ordered)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant_id := (v_line->>'variantId')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;
    v_unit_price := (v_line->>'unitPrice')::NUMERIC;
    v_line_discount := COALESCE((v_line->>'discountAmount')::NUMERIC, 0);
    v_uom_code := NULLIF(trim(v_line->>'uomCode'), '');

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity for variant %', v_variant_id;
    END IF;

    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid unit price for variant %', v_variant_id;
    END IF;

    IF v_line_discount < 0 THEN
      RAISE EXCEPTION 'Line discount cannot be negative';
    END IF;

    SELECT r.uom_code, r.qty_base INTO v_uom_code, v_qty_base
    FROM public._resolve_line_uom(v_variant_id, v_qty, v_uom_code, true, false) r;

    v_line_gross := round(v_unit_price * v_qty, 2);
    IF v_line_discount > v_line_gross + 0.01 THEN
      RAISE EXCEPTION 'Line discount exceeds line total for variant %', v_variant_id;
    END IF;

    v_line_subtotal := v_line_gross - v_line_discount;
    IF v_line_subtotal < -0.01 THEN
      RAISE EXCEPTION 'Invalid line subtotal for variant %', v_variant_id;
    END IF;

    v_gross_merch := v_gross_merch + v_line_gross;
    v_line_discounts_total := v_line_discounts_total + v_line_discount;
    v_merch_subtotal := v_merch_subtotal + v_line_subtotal;

    v_tax_rate := COALESCE((v_tax_rates->>v_variant_id::TEXT)::NUMERIC, v_org.tax_rate);

    IF v_org.tax_inclusive THEN
      v_line_tax := v_line_subtotal - (v_line_subtotal / (1 + v_tax_rate / 100));
      v_line_total := v_line_subtotal;
    ELSE
      v_line_tax := v_line_subtotal * (v_tax_rate / 100);
      v_line_total := v_line_subtotal + v_line_tax;
    END IF;

    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_total := v_tax_total + v_line_tax;

    v_need_key := v_variant_id::TEXT;
    v_stock_need := jsonb_set(
      v_stock_need,
      ARRAY[v_need_key],
      to_jsonb(COALESCE((v_stock_need->>v_need_key)::NUMERIC, 0) + v_qty_base)
    );

    v_resolved_lines := v_resolved_lines || jsonb_build_array(jsonb_build_object(
      'variantId', v_variant_id,
      'quantity', v_qty,
      'unitPrice', v_unit_price,
      'discountAmount', v_line_discount,
      'uomCode', v_uom_code,
      'qtyBase', v_qty_base,
      'lineTax', v_line_tax,
      'lineTotal', v_line_total,
      'productName', v_line->>'productName',
      'variantName', v_line->>'variantName'
    ));
  END LOOP;

  FOR v_need_key, v_need_qty IN
    SELECT key, value::TEXT::NUMERIC
    FROM jsonb_each_text(v_stock_need)
    ORDER BY 1
  LOOP
    v_variant_id := v_need_key::UUID;
    SELECT quantity INTO v_stock FROM inventory_levels
    WHERE store_id = p_store_id AND variant_id = v_variant_id
    FOR UPDATE;
    IF v_stock IS NULL THEN v_stock := 0; END IF;
    IF v_stock < v_need_qty THEN
      RAISE EXCEPTION 'Insufficient stock for variant %', v_variant_id;
    END IF;
  END LOOP;

  IF p_promotion_code IS NOT NULL AND trim(p_promotion_code) <> '' THEN
    v_promo_result := public.validate_promotion_code(
      p_organization_id, p_promotion_code, v_merch_subtotal, p_pos_session_token
    );
    IF NOT COALESCE((v_promo_result->>'valid')::BOOLEAN, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_promo_result->>'message', 'Invalid promotion');
    END IF;
    SELECT * INTO v_promo FROM promotions WHERE id = (v_promo_result->>'promotion_id')::UUID;
    v_promo_discount := GREATEST((v_promo_result->>'discount_amount')::NUMERIC, 0);
  END IF;

  IF v_manual_discount + v_promo_discount > v_merch_subtotal + 0.01 THEN
    RAISE EXCEPTION 'Order discounts exceed merchandise subtotal';
  END IF;

  IF v_line_discounts_total + v_manual_discount + v_promo_discount > v_gross_merch + 0.01 THEN
    RAISE EXCEPTION 'Total discounts cannot exceed merchandise value (100%% cap)';
  END IF;

  PERFORM public._enforce_cashier_discount_limit(
    p_organization_id,
    p_register_id,
    v_gross_merch,
    v_line_discounts_total + v_manual_discount + v_promo_discount,
    p_pos_session_token,
    p_manager_discount_pin,
    v_user_id
  );

  v_total := v_subtotal + v_tax_total - v_manual_discount - v_promo_discount + v_tip;
  IF v_total < -0.01 THEN
    RAISE EXCEPTION 'Sale total cannot be negative';
  END IF;
  IF v_total < 0 THEN v_total := 0; END IF;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_payment_amount := COALESCE((v_payment->>'amount')::NUMERIC, 0);
    IF v_payment_amount < 0 THEN
      RAISE EXCEPTION 'Payment amount cannot be negative';
    END IF;
    v_payment_total := v_payment_total + v_payment_amount;
    IF v_payment->>'method' = 'store_credit' THEN
      v_credit_total := v_credit_total + v_payment_amount;
    ELSIF v_payment->>'method' = 'on_account' THEN
      v_on_account_total := v_on_account_total + v_payment_amount;
    ELSIF v_payment->>'method' = 'gift_card' THEN
      v_gift_card_total := v_gift_card_total + v_payment_amount;
    ELSIF v_payment->>'method' = 'loyalty' THEN
      v_loyalty_total := v_loyalty_total + v_payment_amount;
    END IF;
  END LOOP;

  IF abs(v_payment_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'Payment total % does not match sale total %', v_payment_total, v_total;
  END IF;

  IF v_credit_total > 0 AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer required for store credit payment';
  END IF;

  IF v_on_account_total > 0 AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer required for pay-later payment';
  END IF;

  IF v_on_account_total > 0 AND NOT COALESCE(v_on_account_enabled, false) THEN
    RAISE EXCEPTION 'Pay later is not enabled for this customer';
  END IF;

  IF v_credit_total > 0 THEN
    SELECT balance INTO v_credit_balance FROM customer_credits
    WHERE organization_id = p_organization_id AND customer_id = p_customer_id
    FOR UPDATE;
    IF v_credit_balance IS NULL OR v_credit_balance < v_credit_total THEN
      RAISE EXCEPTION 'Insufficient store credit';
    END IF;
  END IF;

  IF v_on_account_total > 0 THEN
    SELECT balance INTO v_receivable_balance FROM customer_receivables
    WHERE organization_id = p_organization_id AND customer_id = p_customer_id
    FOR UPDATE;

    IF v_credit_limit IS NOT NULL
      AND COALESCE(v_receivable_balance, 0) + v_on_account_total > v_credit_limit THEN
      RAISE EXCEPTION 'Credit limit exceeded';
    END IF;
  END IF;

  IF v_gift_card_total > 0 THEN
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      IF v_payment->>'method' = 'gift_card' THEN
        PERFORM public._lock_validate_gift_card(
          p_organization_id,
          v_payment->>'reference',
          COALESCE((v_payment->>'amount')::NUMERIC, 0)
        );
      END IF;
    END LOOP;
  END IF;

  IF v_loyalty_total > 0 THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Customer required for loyalty redemption';
    END IF;
    v_loyalty_points_total := 0;
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      IF v_payment->>'method' = 'loyalty' THEN
        v_loyalty_pts := COALESCE(NULLIF(trim(v_payment->>'reference'), '')::INT, 0);
        IF v_loyalty_pts <= 0 THEN
          v_loyalty_pts := public._loyalty_points_for_amount(
            v_org, COALESCE((v_payment->>'amount')::NUMERIC, 0)
          );
        END IF;
        v_loyalty_points_total := v_loyalty_points_total + v_loyalty_pts;
      END IF;
    END LOOP;
    PERFORM public._validate_loyalty_redemption(
      p_organization_id, p_customer_id, v_loyalty_points_total
    );
  END IF;

  BEGIN
    INSERT INTO sales (
      organization_id, store_id, register_id, session_id, receipt_no,
      subtotal, tax_amount, discount_amount, tip_amount, total,
      customer_id, customer_name, customer_phone,
      idempotency_key, created_by, pos_staff_id, promotion_id
    ) VALUES (
      p_organization_id, p_store_id, p_register_id, p_session_id, v_receipt_no,
      v_subtotal, v_tax_total, v_manual_discount + v_promo_discount, v_tip, v_total,
      p_customer_id,
      COALESCE(p_customer_name, v_cust_name),
      COALESCE(p_customer_phone, v_cust_phone),
      p_idempotency_key, v_user_id, v_staff_id,
      CASE WHEN v_promo.id IS NOT NULL THEN v_promo.id ELSE NULL END
    ) RETURNING id INTO v_sale_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, receipt_no, total
      INTO v_existing_sale, v_dup_receipt, v_dup_total
      FROM sales
      WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'sale_id', v_existing_sale,
          'receipt_no', v_dup_receipt,
          'total', v_dup_total,
          'duplicate', true
        );
      END IF;
      RAISE;
  END;

  -- Insert from pre-resolved lines (no second UOM resolve)
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_resolved_lines)
  LOOP
    INSERT INTO sale_lines (
      sale_id, variant_id, product_name, variant_name,
      quantity, unit_price, tax_amount, discount_amount, line_total,
      uom_code, qty_base
    ) VALUES (
      v_sale_id,
      (v_line->>'variantId')::UUID,
      v_line->>'productName',
      v_line->>'variantName',
      (v_line->>'quantity')::NUMERIC,
      (v_line->>'unitPrice')::NUMERIC,
      (v_line->>'lineTax')::NUMERIC,
      (v_line->>'discountAmount')::NUMERIC,
      (v_line->>'lineTotal')::NUMERIC,
      v_line->>'uomCode',
      (v_line->>'qtyBase')::NUMERIC
    );
  END LOOP;

  PERFORM public._record_sale_stock_movement(
    p_organization_id, p_store_id, v_sale_id, p_lines, v_user_id
  );

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_pay_status := public._pos_resolve_payment_status(
      v_payment->>'method', v_payment->>'reference', v_org
    );
    IF v_pay_status = 'pending'::payment_status THEN
      v_has_pending_payments := true;
    END IF;

    INSERT INTO payments (
      sale_id, organization_id, method, amount, status,
      reference, provider, phone, bank_name, cash_tendered, change_given
    ) VALUES (
      v_sale_id, p_organization_id,
      (v_payment->>'method')::payment_method,
      (v_payment->>'amount')::NUMERIC,
      v_pay_status,
      v_payment->>'reference',
      NULLIF(v_payment->>'provider', '')::mobile_money_provider,
      v_payment->>'phone',
      v_payment->>'bankName',
      (v_payment->>'cashTendered')::NUMERIC,
      (v_payment->>'changeGiven')::NUMERIC
    );
  END LOOP;

  IF v_credit_total > 0 THEN
    UPDATE customer_credits
    SET balance = balance - v_credit_total, updated_at = now()
    WHERE organization_id = p_organization_id AND customer_id = p_customer_id;

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id, created_by)
    VALUES (p_organization_id, p_customer_id, -v_credit_total, 'Redeemed at POS', v_sale_id, v_user_id);
  END IF;

  IF v_on_account_total > 0 THEN
    INSERT INTO customer_receivables (organization_id, customer_id, balance)
    VALUES (p_organization_id, p_customer_id, v_on_account_total)
    ON CONFLICT (organization_id, customer_id)
    DO UPDATE SET balance = customer_receivables.balance + v_on_account_total, updated_at = now();

    INSERT INTO receivable_transactions (organization_id, customer_id, amount, reason, sale_id, created_by)
    VALUES (p_organization_id, p_customer_id, v_on_account_total, 'POS sale — pay later', v_sale_id, v_user_id);
  END IF;

  IF v_gift_card_total > 0 THEN
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      IF v_payment->>'method' = 'gift_card' THEN
        PERFORM public._redeem_gift_card(
          p_organization_id,
          v_payment->>'reference',
          COALESCE((v_payment->>'amount')::NUMERIC, 0),
          v_sale_id,
          v_user_id
        );
      END IF;
    END LOOP;
  END IF;

  IF v_loyalty_total > 0 AND v_loyalty_points_total > 0 THEN
    PERFORM public._redeem_loyalty_points(
      p_organization_id, p_customer_id, v_loyalty_points_total, v_sale_id, v_user_id
    );
  END IF;

  IF COALESCE(v_org.pos_loyalty_enabled, false) AND p_customer_id IS NOT NULL THEN
    v_loyalty_points_earned := public._award_loyalty_points(
      p_organization_id, p_customer_id, v_merch_subtotal, v_sale_id, v_user_id
    );
  END IF;

  IF v_staff_id IS NOT NULL THEN
    UPDATE register_sessions SET active_staff_id = v_staff_id WHERE id = p_session_id;
  END IF;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
    VALUES (
      p_organization_id, v_user_id, 'sale', v_sale_id, 'completed',
      jsonb_build_object(
        'receipt_no', v_receipt_no, 'total', v_total, 'tip_amount', v_tip,
        'pos_staff_id', v_staff_id,
        'promotion_code', NULLIF(trim(p_promotion_code), ''),
        'payments_pending', v_has_pending_payments
      )
    );
  END IF;

  -- Sync GL when auto-post is on and payments are settled (cash path).
  -- Pending mobile-money waits for maybe_auto_post_sale after confirm.
  IF COALESCE(v_org.pos_auto_post_sales, false) AND NOT v_has_pending_payments THEN
    v_journal_entry_id := public.post_sale_to_ledger_internal(v_sale_id);
    IF v_journal_entry_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.organization_id = p_organization_id
        AND je.source_type = 'sale'
        AND je.source_id = v_sale_id
    ) THEN
      RAISE EXCEPTION
        'Auto-post to ledger failed for receipt % — no journal created. Check open fiscal period and account mapping.',
        v_receipt_no;
    END IF;
    DELETE FROM sale_ledger_post_queue WHERE sale_id = v_sale_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'receipt_no', v_receipt_no,
    'total', v_total,
    'tip_amount', v_tip,
    'duplicate', false,
    'payments_pending', v_has_pending_payments,
    'loyalty_points_earned', v_loyalty_points_earned,
    'journal_entry_id', v_journal_entry_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, NUMERIC, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sale TO authenticated;


-- Dashboard MTD P&L cards labeled as ledger must use posted GL only
CREATE OR REPLACE FUNCTION public.dashboard_bundle(
  p_org_id UUID,
  p_include_accounting BOOLEAN DEFAULT TRUE,
  p_include_expenses BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_today DATE;
  v_mtd_from DATE;
  v_mtd_to DATE;
  v_prev_from DATE;
  v_prev_to DATE;
  v_today_stats JSONB;
  v_mtd_pnl JSONB := NULL;
  v_prev_pnl JSONB := NULL;
  v_mtd_cf JSONB := NULL;
  v_ar_total NUMERIC := NULL;
  v_ap_total NUMERIC := NULL;
  v_sales_trend JSONB;
  v_product_count BIGINT;
  v_recent_expenses JSONB := '[]'::jsonb;
  v_recent_sales JSONB := '[]'::jsonb;
  v_trend_start DATE;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(NULLIF(trim(timezone), ''), 'Africa/Addis_Ababa') INTO v_tz FROM organizations WHERE id = p_org_id;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_mtd_from := date_trunc('month', v_today::timestamp)::date;
  v_mtd_to := v_today;
  v_prev_from := (date_trunc('month', v_today::timestamp) - interval '1 month')::date;
  v_prev_to := (date_trunc('month', v_today::timestamp) - interval '1 day')::date;
  v_trend_start := v_today - 13;

  v_today_stats := public.dashboard_stats(p_org_id, NULL);

  IF COALESCE(p_include_accounting, true) THEN
    v_mtd_pnl := public.profit_and_loss(p_org_id, v_mtd_from, v_mtd_to, 'gl');
    v_prev_pnl := public.profit_and_loss(p_org_id, v_prev_from, v_prev_to, 'gl');
    v_mtd_cf := public.cash_flow(p_org_id, v_mtd_from, v_mtd_to);

    SELECT COALESCE(SUM(public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited)), 0)
    INTO v_ar_total
    FROM customer_invoices ci
    WHERE ci.organization_id = p_org_id
      AND ci.status IN ('posted', 'partially_paid');

    SELECT COALESCE(SUM(public._bill_balance_due(vb.amount, vb.amount_paid)), 0)
    INTO v_ap_total
    FROM vendor_bills vb
    WHERE vb.organization_id = p_org_id
      AND vb.status IN ('open', 'partially_paid');
  END IF;

  WITH days AS (
    SELECT generate_series(v_trend_start, v_today, interval '1 day')::date AS d
  ),
  rollup AS (
    SELECT summary_date, sales_total
    FROM org_daily_sales_summary
    WHERE organization_id = p_org_id
      AND store_id = '00000000-0000-0000-0000-000000000000'::uuid
      AND summary_date BETWEEN v_trend_start AND v_today
  ),
  today_live AS (
    SELECT COALESCE(SUM(s.total), 0) AS sales_total
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_tz)::date = v_today
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', days.d::text,
      'total', CASE
        WHEN days.d = v_today THEN (SELECT sales_total FROM today_live)
        ELSE COALESCE(r.sales_total, 0)
      END
    ) ORDER BY days.d
  ), '[]'::jsonb)
  INTO v_sales_trend
  FROM days
  LEFT JOIN rollup r ON r.summary_date = days.d;

  SELECT COUNT(*) INTO v_product_count
  FROM products
  WHERE organization_id = p_org_id;

  IF COALESCE(p_include_expenses, true) THEN
    SELECT COALESCE(jsonb_agg(row_to_json(e)::jsonb ORDER BY e.expense_date DESC), '[]'::jsonb)
    INTO v_recent_expenses
    FROM (
      SELECT expense_date, vendor_name, amount
      FROM expenses
      WHERE organization_id = p_org_id
      ORDER BY expense_date DESC
      LIMIT 5
    ) e;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.created_at DESC), '[]'::jsonb)
  INTO v_recent_sales
  FROM (
    SELECT
      s.id,
      s.receipt_no,
      s.total,
      s.status,
      s.created_at,
      CASE WHEN st.id IS NOT NULL THEN jsonb_build_object('name', st.name) ELSE NULL END AS stores
    FROM sales s
    LEFT JOIN stores st ON st.id = s.store_id
    WHERE s.organization_id = p_org_id
    ORDER BY s.created_at DESC
    LIMIT 10
  ) s;

  RETURN jsonb_build_object(
    'today_stats', v_today_stats,
    'mtd_pnl', v_mtd_pnl,
    'prev_pnl', v_prev_pnl,
    'mtd_cash_flow', v_mtd_cf,
    'ar_total', v_ar_total,
    'ap_total', v_ap_total,
    'sales_trend_14d', v_sales_trend,
    'product_count', v_product_count,
    'recent_expenses', v_recent_expenses,
    'recent_sales', v_recent_sales,
    'mtd_from', v_mtd_from,
    'mtd_to', v_mtd_to
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_bundle(UUID, BOOLEAN, BOOLEAN) TO authenticated;

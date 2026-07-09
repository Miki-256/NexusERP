-- Async GL posting for voids and partial returns (mirrors sale_ledger_post_queue).

CREATE TABLE IF NOT EXISTS public.refund_void_ledger_queue (
  sale_id UUID PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  refund_method TEXT NOT NULL DEFAULT 'cash',
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_refund_void_ledger_queue_org_time
  ON refund_void_ledger_queue(organization_id, enqueued_at);

ALTER TABLE refund_void_ledger_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refund_void_ledger_queue_select ON refund_void_ledger_queue;
DROP POLICY IF EXISTS refund_void_ledger_queue_select ON refund_void_ledger_queue;
CREATE POLICY refund_void_ledger_queue_select ON refund_void_ledger_queue FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE TABLE IF NOT EXISTS public.return_ledger_post_queue (
  return_id UUID PRIMARY KEY REFERENCES sale_returns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_return_ledger_post_queue_org_time
  ON return_ledger_post_queue(organization_id, enqueued_at);

ALTER TABLE return_ledger_post_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS return_ledger_post_queue_select ON return_ledger_post_queue;
DROP POLICY IF EXISTS return_ledger_post_queue_select ON return_ledger_post_queue;
CREATE POLICY return_ledger_post_queue_select ON return_ledger_post_queue FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE OR REPLACE FUNCTION public.enqueue_refund_void_ledger_post(
  p_sale_id UUID,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND OR v_sale.status <> 'voided' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = v_sale.organization_id
      AND source_type = 'sale_void' AND source_id = p_sale_id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO refund_void_ledger_queue (sale_id, organization_id, refund_method)
  VALUES (p_sale_id, v_sale.organization_id, COALESCE(NULLIF(trim(p_refund_method), ''), 'cash'))
  ON CONFLICT (sale_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_return_ledger_post(p_return_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ret sale_returns%ROWTYPE;
BEGIN
  SELECT * INTO v_ret FROM sale_returns WHERE id = p_return_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = v_ret.organization_id
      AND source_type = 'sale_return' AND source_id = p_return_id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO return_ledger_post_queue (return_id, organization_id)
  VALUES (p_return_id, v_ret.organization_id)
  ON CONFLICT (return_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_refund_ledger_post_queue(p_limit INT DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_void_posted INT := 0;
  v_void_failed INT := 0;
  v_return_posted INT := 0;
  v_return_failed INT := 0;
  v_limit INT := GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
BEGIN
  FOR v_row IN
    SELECT q.sale_id, q.refund_method
    FROM refund_void_ledger_queue q
    ORDER BY q.enqueued_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.post_refund_void_to_ledger(v_row.sale_id, v_row.refund_method);
      DELETE FROM refund_void_ledger_queue WHERE sale_id = v_row.sale_id;
      v_void_posted := v_void_posted + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE refund_void_ledger_queue
      SET attempts = attempts + 1, last_error = SQLERRM
      WHERE sale_id = v_row.sale_id;
      v_void_failed := v_void_failed + 1;
    END;
  END LOOP;

  FOR v_row IN
    SELECT q.return_id
    FROM return_ledger_post_queue q
    ORDER BY q.enqueued_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.post_partial_return_to_ledger(v_row.return_id);
      DELETE FROM return_ledger_post_queue WHERE return_id = v_row.return_id;
      v_return_posted := v_return_posted + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE return_ledger_post_queue
      SET attempts = attempts + 1, last_error = SQLERRM
      WHERE return_id = v_row.return_id;
      v_return_failed := v_return_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'void_posted', v_void_posted,
    'void_failed', v_void_failed,
    'return_posted', v_return_posted,
    'return_failed', v_return_failed,
    'void_pending', (SELECT COUNT(*)::INT FROM refund_void_ledger_queue),
    'return_pending', (SELECT COUNT(*)::INT FROM return_ledger_post_queue)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_refund_ledger_post_queue(INT) FROM PUBLIC, anon, authenticated;

-- Patch void / return RPCs to enqueue instead of blocking on GL writes.
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

  PERFORM public.enqueue_refund_void_ledger_post(p_sale_id, p_refund_method);
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

  PERFORM public.enqueue_refund_void_ledger_post(p_sale_id, p_refund_method);
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

  PERFORM public.enqueue_return_ledger_post(v_return_id);

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

  PERFORM public.enqueue_return_ledger_post(v_return_id);

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'refund_total', v_refund_total,
    'refund_method', p_refund_method,
    'fully_returned', v_all_returned
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.profit_and_loss(UUID, DATE, DATE, TEXT) TO authenticated;

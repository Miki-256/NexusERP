-- EFM Wave 7 — Treasury & advanced banking RPCs (requires 00144 schema)

-- ---------------------------------------------------------------------------
-- Cash position
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_treasury_cash_position(
  p_org_id UUID,
  p_as_of DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of DATE := COALESCE(p_as_of, current_date);
  v_functional TEXT;
  v_cash_on_hand NUMERIC := 0;
  v_mobile_money NUMERIC := 0;
  v_bank_total NUMERIC := 0;
  v_unreconciled INT := 0;
  v_pending_ap NUMERIC := 0;
  v_open_ar NUMERIC := 0;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_functional := public._org_functional_currency(p_org_id);

  v_cash_on_hand := public._ic_account_balance(p_org_id, '1000', v_as_of);
  v_mobile_money := public._ic_account_balance(p_org_id, '1020', v_as_of);

  SELECT
    COALESCE(SUM(sub.gl_balance), 0),
    COALESCE(SUM(sub.unreconciled_lines), 0)
  INTO v_bank_total, v_unreconciled
  FROM (
    SELECT
      COALESCE((
        SELECT SUM(jel.debit - jel.credit)
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE jel.account_id = ba.gl_account_id
          AND je.entry_date <= v_as_of
          AND public._je_is_posted(je.entry_status)
      ), 0) AS gl_balance,
      COALESCE((
        SELECT COUNT(*)::INT
        FROM bank_statement_lines bsl
        JOIN bank_statements bs ON bs.id = bsl.statement_id
        WHERE bs.bank_account_id = ba.id
          AND bsl.line_date <= v_as_of
          AND bsl.reconciled = false
      ), 0) AS unreconciled_lines
    FROM bank_accounts ba
    WHERE ba.organization_id = p_org_id AND ba.is_active
  ) sub;

  SELECT COALESCE(SUM(pr.total_amount), 0) INTO v_pending_ap
  FROM ap_payment_runs pr
  WHERE pr.organization_id = p_org_id
    AND pr.status IN ('draft', 'approved');

  SELECT COALESCE((public.accounts_receivable_aging(p_org_id, v_as_of)->>'total')::NUMERIC, 0)
  INTO v_open_ar;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'currency', v_functional,
    'cash_on_hand', round(v_cash_on_hand, 2),
    'mobile_money', round(v_mobile_money, 2),
    'bank_accounts_total', round(v_bank_total, 2),
    'total_liquid', round(v_cash_on_hand + v_mobile_money + v_bank_total, 2),
    'unreconciled_lines', v_unreconciled,
    'open_receivables', round(v_open_ar, 2),
    'pending_ap_payment_runs', round(v_pending_ap, 2),
    'bank_accounts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ba.id,
          'name', ba.name,
          'currency', ba.currency,
          'account_type', ba.account_type,
          'is_foreign', upper(ba.currency) <> upper(v_functional),
          'gl_balance', COALESCE((
            SELECT SUM(jel.debit - jel.credit)
            FROM journal_entry_lines jel
            JOIN journal_entries je ON je.id = jel.entry_id
            WHERE jel.account_id = ba.gl_account_id
              AND je.entry_date <= v_as_of
              AND public._je_is_posted(je.entry_status)
          ), 0),
          'target_balance', ba.target_balance,
          'minimum_balance', ba.minimum_balance,
          'unreconciled_lines', COALESCE((
            SELECT COUNT(*)::INT
            FROM bank_statement_lines bsl
            JOIN bank_statements bs ON bs.id = bsl.statement_id
            WHERE bs.bank_account_id = ba.id
              AND bsl.line_date <= v_as_of
              AND bsl.reconciled = false
          ), 0),
          'below_minimum', ba.minimum_balance IS NOT NULL AND COALESCE((
            SELECT SUM(jel.debit - jel.credit)
            FROM journal_entry_lines jel
            JOIN journal_entries je ON je.id = jel.entry_id
            WHERE jel.account_id = ba.gl_account_id
              AND je.entry_date <= v_as_of
              AND public._je_is_posted(je.entry_status)
          ), 0) < ba.minimum_balance
        ) ORDER BY ba.name
      )
      FROM bank_accounts ba
      WHERE ba.organization_id = p_org_id AND ba.is_active
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_treasury_cash_position(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Liquidity forecast (simple AR/AP + pending runs)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_treasury_liquidity_forecast(
  p_org_id UUID,
  p_days INT DEFAULT 30,
  p_as_of DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of DATE := COALESCE(p_as_of, current_date);
  v_horizon DATE := v_as_of + GREATEST(COALESCE(p_days, 30), 1);
  v_position JSONB;
  v_starting NUMERIC;
  v_ar_inflow NUMERIC := 0;
  v_ap_outflow NUMERIC := 0;
  v_pending_runs NUMERIC := 0;
  v_ar_aging JSONB;
  v_weekly JSONB := '[]'::jsonb;
  v_week INT;
  v_week_start DATE;
  v_week_end DATE;
  v_week_in NUMERIC;
  v_week_out NUMERIC;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_position := public.get_treasury_cash_position(p_org_id, v_as_of);
  v_starting := COALESCE((v_position->>'total_liquid')::NUMERIC, 0);
  v_pending_runs := COALESCE((v_position->>'pending_ap_payment_runs')::NUMERIC, 0);

  SELECT public.accounts_receivable_aging(p_org_id, v_as_of) INTO v_ar_aging;
  v_ar_inflow := COALESCE((v_ar_aging->'buckets'->>'current')::NUMERIC, 0)
    + COALESCE((v_ar_aging->'buckets'->>'days_1_30')::NUMERIC, 0);

  SELECT COALESCE(SUM(public._bill_balance_due(vb.amount, vb.amount_paid)), 0)
  INTO v_ap_outflow
  FROM vendor_bills vb
  WHERE vb.organization_id = p_org_id
    AND vb.status IN ('open', 'partially_paid')
    AND vb.due_date BETWEEN v_as_of AND v_horizon;

  FOR v_week IN 0..(GREATEST(COALESCE(p_days, 30), 1) / 7) LOOP
    v_week_start := v_as_of + (v_week * 7);
    v_week_end := LEAST(v_week_start + 6, v_horizon);

    SELECT COALESCE(SUM(public._invoice_balance_due(ci.total, ci.amount_paid, ci.amount_credited)), 0)
    INTO v_week_in
    FROM customer_invoices ci
    WHERE ci.organization_id = p_org_id
      AND ci.status IN ('posted', 'partially_paid')
      AND ci.due_date BETWEEN v_week_start AND v_week_end;

    SELECT COALESCE(SUM(public._bill_balance_due(vb.amount, vb.amount_paid)), 0)
    INTO v_week_out
    FROM vendor_bills vb
    WHERE vb.organization_id = p_org_id
      AND vb.status IN ('open', 'partially_paid')
      AND vb.due_date BETWEEN v_week_start AND v_week_end;

    v_weekly := v_weekly || jsonb_build_array(jsonb_build_object(
      'week_start', v_week_start,
      'week_end', v_week_end,
      'projected_inflows', round(v_week_in, 2),
      'projected_outflows', round(v_week_out, 2),
      'net', round(v_week_in - v_week_out, 2)
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'horizon_days', GREATEST(COALESCE(p_days, 30), 1),
    'horizon_date', v_horizon,
    'currency', v_position->>'currency',
    'starting_liquid', round(v_starting, 2),
    'projected_ar_inflows', round(v_ar_inflow, 2),
    'projected_ap_outflows', round(v_ap_outflow, 2),
    'pending_payment_runs', round(v_pending_runs, 2),
    'projected_ending_liquid', round(v_starting + v_ar_inflow - v_ap_outflow - v_pending_runs, 2),
    'weekly', v_weekly
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_treasury_liquidity_forecast(UUID, INT, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Internal bank transfers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_treasury_transfer(
  p_org_id UUID,
  p_from_bank_account_id UUID,
  p_to_bank_account_id UUID,
  p_amount NUMERIC,
  p_transfer_date DATE DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_memo TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from bank_accounts%ROWTYPE;
  v_to bank_accounts%ROWTYPE;
  v_date DATE := COALESCE(p_transfer_date, current_date);
  v_entry_id UUID;
  v_transfer_id UUID;
  v_desc TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_from_bank_account_id = p_to_bank_account_id THEN
    RAISE EXCEPTION 'From and to accounts must differ';
  END IF;

  SELECT * INTO v_from FROM bank_accounts
  WHERE id = p_from_bank_account_id AND organization_id = p_org_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source bank account not found'; END IF;

  SELECT * INTO v_to FROM bank_accounts
  WHERE id = p_to_bank_account_id AND organization_id = p_org_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Destination bank account not found'; END IF;

  PERFORM public._assert_accounting_date_open(p_org_id, v_date);
  PERFORM public._assert_subledgers_open_for_date(p_org_id, v_date);

  v_desc := COALESCE(NULLIF(trim(p_memo), ''), 'Treasury transfer');

  v_entry_id := public._post_journal_entry_balanced(
    p_org_id, 'BNK', v_date, v_desc, 'treasury_transfer', gen_random_uuid(),
    jsonb_build_array(
      jsonb_build_object(
        'accountId', v_to.gl_account_id,
        'debit', p_amount, 'credit', 0,
        'description', 'Transfer in — ' || v_from.name
      ),
      jsonb_build_object(
        'accountId', v_from.gl_account_id,
        'debit', 0, 'credit', p_amount,
        'description', 'Transfer out — ' || v_to.name
      )
    ), auth.uid(), 'posted'::journal_entry_status
  );

  INSERT INTO treasury_transfers (
    organization_id, from_bank_account_id, to_bank_account_id,
    transfer_date, amount, reference, memo, status, journal_entry_id, created_by
  ) VALUES (
    p_org_id, p_from_bank_account_id, p_to_bank_account_id,
    v_date, p_amount, NULLIF(trim(p_reference), ''), NULLIF(trim(p_memo), ''),
    'posted', v_entry_id, auth.uid()
  ) RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_treasury_transfer(UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_treasury_transfers(
  p_org_id UUID,
  p_limit INT DEFAULT 50
)
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
    SELECT jsonb_agg(row_data ORDER BY sort_date DESC, sort_created DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', t.id,
        'transfer_date', t.transfer_date,
        'amount', t.amount,
        'reference', t.reference,
        'memo', t.memo,
        'status', t.status,
        'from_bank_account_id', t.from_bank_account_id,
        'from_bank_account_name', bf.name,
        'to_bank_account_id', t.to_bank_account_id,
        'to_bank_account_name', bt.name,
        'journal_entry_id', t.journal_entry_id,
        'created_at', t.created_at
      ) AS row_data,
      t.transfer_date AS sort_date,
      t.created_at AS sort_created
      FROM treasury_transfers t
      JOIN bank_accounts bf ON bf.id = t.from_bank_account_id
      JOIN bank_accounts bt ON bt.id = t.to_bank_account_id
      WHERE t.organization_id = p_org_id
      ORDER BY t.transfer_date DESC, t.created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    ) q
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_treasury_transfers(UUID, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_bank_account_treasury_settings(
  p_bank_account_id UUID,
  p_account_type TEXT DEFAULT NULL,
  p_target_balance NUMERIC DEFAULT NULL,
  p_minimum_balance NUMERIC DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct bank_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_acct FROM bank_accounts WHERE id = p_bank_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank account not found'; END IF;
  IF NOT public.user_can_manage(v_acct.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE bank_accounts
  SET
    account_type = COALESCE(NULLIF(trim(p_account_type), ''), account_type),
    target_balance = p_target_balance,
    minimum_balance = p_minimum_balance
  WHERE id = p_bank_account_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_bank_account_treasury_settings(UUID, TEXT, NUMERIC, NUMERIC) TO authenticated;

-- list_bank_accounts — include treasury fields
CREATE OR REPLACE FUNCTION public.list_bank_accounts(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_functional TEXT;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_functional := public._org_functional_currency(p_org_id);

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', ba.id,
        'name', ba.name,
        'account_number', ba.account_number,
        'bank_name', ba.bank_name,
        'currency', ba.currency,
        'account_type', ba.account_type,
        'target_balance', ba.target_balance,
        'minimum_balance', ba.minimum_balance,
        'is_foreign', upper(ba.currency) <> upper(v_functional),
        'functional_currency', v_functional,
        'is_active', ba.is_active,
        'gl_account_id', ba.gl_account_id,
        'gl_account_code', a.code,
        'gl_account_name', a.name,
        'gl_balance', COALESCE((
          SELECT SUM(jel.debit - jel.credit)
          FROM journal_entry_lines jel
          JOIN journal_entries je ON je.id = jel.entry_id
          WHERE jel.account_id = ba.gl_account_id
            AND public._je_is_posted(je.entry_status)
        ), 0),
        'unreconciled_lines', COALESCE((
          SELECT COUNT(*)::INT
          FROM bank_statement_lines bsl
          WHERE bsl.organization_id = p_org_id
            AND bsl.reconciled = false
            AND bsl.statement_id IN (
              SELECT id FROM bank_statements WHERE bank_account_id = ba.id
            )
        ), 0)
      ) ORDER BY ba.name
    )
    FROM bank_accounts ba
    JOIN accounts a ON a.id = ba.gl_account_id
    WHERE ba.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;

-- EFM Wave 5 — Multi-currency & FX revaluation RPCs (requires 00140 schema)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._org_functional_currency(p_org_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(currency, 'ETB') FROM organizations WHERE id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION public._get_exchange_rate_value(
  p_org_id UUID,
  p_currency_code TEXT,
  p_date DATE DEFAULT current_date,
  p_rate_type TEXT DEFAULT 'spot'
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_functional TEXT;
  v_rate NUMERIC;
BEGIN
  v_functional := public._org_functional_currency(p_org_id);
  IF upper(trim(p_currency_code)) = upper(trim(v_functional)) THEN
    RETURN 1;
  END IF;

  SELECT er.rate INTO v_rate
  FROM exchange_rates er
  WHERE er.organization_id = p_org_id
    AND upper(er.currency_code) = upper(trim(p_currency_code))
    AND er.rate_type = COALESCE(NULLIF(trim(p_rate_type), ''), 'spot')
    AND er.rate_date <= COALESCE(p_date, current_date)
  ORDER BY er.rate_date DESC, er.created_at DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'No exchange rate for % as of % (%). Add a rate first.', upper(trim(p_currency_code)), COALESCE(p_date, current_date), COALESCE(p_rate_type, 'spot');
  END IF;

  RETURN v_rate;
END;
$$;

CREATE OR REPLACE FUNCTION public._account_book_balance(p_account_id UUID, p_as_of DATE DEFAULT current_date)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0)
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  WHERE jel.account_id = p_account_id
    AND je.entry_date <= COALESCE(p_as_of, current_date)
    AND public._je_is_posted(je.entry_status);
$$;

CREATE OR REPLACE FUNCTION public._account_foreign_balance(
  p_account_id UUID,
  p_currency_code TEXT,
  p_as_of DATE DEFAULT current_date
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fc NUMERIC := 0;
  v_bank_fc NUMERIC := 0;
BEGIN
  SELECT COALESCE(SUM(COALESCE(jel.transaction_debit, 0) - COALESCE(jel.transaction_credit, 0)), 0)
  INTO v_fc
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  WHERE jel.account_id = p_account_id
    AND upper(COALESCE(jel.transaction_currency, '')) = upper(trim(p_currency_code))
    AND je.entry_date <= COALESCE(p_as_of, current_date)
    AND public._je_is_posted(je.entry_status);

  IF abs(v_fc) > 0.001 THEN
    RETURN v_fc;
  END IF;

  SELECT COALESCE(ba.opening_balance, 0) + COALESCE(SUM(bsl.amount), 0)
  INTO v_bank_fc
  FROM bank_accounts ba
  LEFT JOIN bank_statements bs ON bs.bank_account_id = ba.id
  LEFT JOIN bank_statement_lines bsl ON bsl.statement_id = bs.id
    AND bsl.line_date <= COALESCE(p_as_of, current_date)
  WHERE ba.gl_account_id = p_account_id
    AND upper(ba.currency) = upper(trim(p_currency_code))
  GROUP BY ba.id, ba.opening_balance
  LIMIT 1;

  RETURN COALESCE(v_bank_fc, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- FX default accounts
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
    (p_org_id, '1500', 'Fixed Assets',        'asset'),
    (p_org_id, '1590', 'Accumulated Depreciation', 'asset'),
    (p_org_id, '2000', 'Accounts Payable',    'liability'),
    (p_org_id, '2100', 'Tax Payable',         'liability'),
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
    (p_org_id, 'FX',  'Foreign Exchange', 'general')
  ON CONFLICT (organization_id, code) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- Exchange rate maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_exchange_rates(
  p_org_id UUID,
  p_currency_code TEXT DEFAULT NULL,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
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

  RETURN jsonb_build_object(
    'functional_currency', public._org_functional_currency(p_org_id),
    'rates', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', er.id,
          'currency_code', er.currency_code,
          'rate_date', er.rate_date,
          'rate', er.rate,
          'rate_type', er.rate_type,
          'source', er.source,
          'created_at', er.created_at
        ) ORDER BY er.rate_date DESC, er.currency_code
      )
      FROM exchange_rates er
      WHERE er.organization_id = p_org_id
        AND (p_currency_code IS NULL OR upper(er.currency_code) = upper(trim(p_currency_code)))
        AND (p_from IS NULL OR er.rate_date >= p_from)
        AND (p_to IS NULL OR er.rate_date <= p_to)
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_exchange_rates(UUID, TEXT, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_exchange_rate(
  p_org_id UUID,
  p_currency_code TEXT,
  p_rate_date DATE,
  p_rate NUMERIC,
  p_rate_type TEXT DEFAULT 'spot',
  p_source TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_functional TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'Rate must be positive';
  END IF;

  v_functional := public._org_functional_currency(p_org_id);
  IF upper(trim(p_currency_code)) = upper(trim(v_functional)) THEN
    RAISE EXCEPTION 'Cannot set exchange rate for functional currency %', v_functional;
  END IF;

  INSERT INTO exchange_rates (
    organization_id, currency_code, rate_date, rate, rate_type, source, created_by
  ) VALUES (
    p_org_id, upper(trim(p_currency_code)), p_rate_date, p_rate,
    COALESCE(NULLIF(trim(p_rate_type), ''), 'spot'),
    NULLIF(trim(p_source), ''), auth.uid()
  )
  ON CONFLICT (organization_id, currency_code, rate_date, rate_type)
  DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, created_by = auth.uid()
  RETURNING id INTO v_id;

  UPDATE organizations SET multi_currency_enabled = true WHERE id = p_org_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_exchange_rate(UUID, TEXT, DATE, NUMERIC, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_exchange_rate(
  p_org_id UUID,
  p_currency_code TEXT,
  p_date DATE DEFAULT NULL,
  p_rate_type TEXT DEFAULT 'spot'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_functional TEXT;
  v_rate NUMERIC;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_functional := public._org_functional_currency(p_org_id);
  v_rate := public._get_exchange_rate_value(p_org_id, p_currency_code, COALESCE(p_date, current_date), p_rate_type);

  RETURN jsonb_build_object(
    'functional_currency', v_functional,
    'currency_code', upper(trim(p_currency_code)),
    'rate_date', COALESCE(p_date, current_date),
    'rate_type', COALESCE(NULLIF(trim(p_rate_type), ''), 'spot'),
    'rate', v_rate
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_exchange_rate(UUID, TEXT, DATE, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Balanced JE writer — optional foreign-currency line amounts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._post_journal_entry_balanced(
  p_org_id UUID,
  p_journal_code TEXT,
  p_date DATE,
  p_memo TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_lines JSONB,
  p_created_by UUID DEFAULT NULL,
  p_status journal_entry_status DEFAULT 'posted'
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
  v_status journal_entry_status := COALESCE(p_status, 'posted'::journal_entry_status);
  v_functional TEXT;
  v_line_debit NUMERIC;
  v_line_credit NUMERIC;
  v_fc_debit NUMERIC;
  v_fc_credit NUMERIC;
  v_curr TEXT;
  v_rate NUMERIC;
  v_header_currency TEXT;
  v_header_rate NUMERIC;
BEGIN
  v_functional := public._org_functional_currency(p_org_id);

  IF v_status = 'posted'::journal_entry_status THEN
    PERFORM public._assert_accounting_date_open(p_org_id, COALESCE(p_date, current_date));
    PERFORM public._assert_accounts_postable(p_lines);
  END IF;

  SELECT id INTO v_journal_id FROM journals WHERE organization_id = p_org_id AND code = p_journal_code;
  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'Journal % not found', p_journal_code;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_curr := NULLIF(upper(trim(v_line->>'transactionCurrency')), '');
    v_fc_debit := COALESCE((v_line->>'transactionDebit')::NUMERIC, 0);
    v_fc_credit := COALESCE((v_line->>'transactionCredit')::NUMERIC, 0);
    v_rate := NULLIF((v_line->>'exchangeRate')::NUMERIC, 0);

    IF v_curr IS NOT NULL AND v_curr <> upper(v_functional) AND (v_fc_debit > 0 OR v_fc_credit > 0) THEN
      IF v_rate IS NULL THEN
        v_rate := public._get_exchange_rate_value(p_org_id, v_curr, COALESCE(p_date, current_date), 'spot');
      END IF;
      v_line_debit := round(v_fc_debit * v_rate, 2);
      v_line_credit := round(v_fc_credit * v_rate, 2);
      v_header_currency := COALESCE(v_header_currency, v_curr);
      v_header_rate := COALESCE(v_header_rate, v_rate);
    ELSE
      v_line_debit := COALESCE((v_line->>'debit')::NUMERIC, 0);
      v_line_credit := COALESCE((v_line->>'credit')::NUMERIC, 0);
      v_curr := NULL;
      v_rate := NULL;
      v_fc_debit := NULL;
      v_fc_credit := NULL;
    END IF;

    v_debits := v_debits + v_line_debit;
    v_credits := v_credits + v_line_credit;
  END LOOP;

  IF abs(v_debits - v_credits) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry not balanced: debits % vs credits %', v_debits, v_credits;
  END IF;

  INSERT INTO journal_entries (
    organization_id, journal_id, entry_date, memo, source_type, source_id,
    created_by, entry_status, transaction_currency, exchange_rate
  )
  VALUES (
    p_org_id, v_journal_id, COALESCE(p_date, current_date), p_memo,
    p_source_type, p_source_id, p_created_by, v_status,
    v_header_currency, v_header_rate
  )
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_curr := NULLIF(upper(trim(v_line->>'transactionCurrency')), '');
    v_fc_debit := COALESCE((v_line->>'transactionDebit')::NUMERIC, 0);
    v_fc_credit := COALESCE((v_line->>'transactionCredit')::NUMERIC, 0);
    v_rate := NULLIF((v_line->>'exchangeRate')::NUMERIC, 0);

    IF v_curr IS NOT NULL AND v_curr <> upper(v_functional) AND (v_fc_debit > 0 OR v_fc_credit > 0) THEN
      IF v_rate IS NULL THEN
        v_rate := public._get_exchange_rate_value(p_org_id, v_curr, COALESCE(p_date, current_date), 'spot');
      END IF;
      v_line_debit := round(v_fc_debit * v_rate, 2);
      v_line_credit := round(v_fc_credit * v_rate, 2);
    ELSE
      v_line_debit := COALESCE((v_line->>'debit')::NUMERIC, 0);
      v_line_credit := COALESCE((v_line->>'credit')::NUMERIC, 0);
      v_curr := NULL;
      v_rate := NULL;
      v_fc_debit := NULL;
      v_fc_credit := NULL;
    END IF;

    INSERT INTO journal_entry_lines (
      entry_id, organization_id, account_id, debit, credit, description,
      store_id, project_id, department_id,
      transaction_currency, transaction_debit, transaction_credit, exchange_rate
    )
    VALUES (
      v_entry_id, p_org_id,
      (v_line->>'accountId')::UUID,
      v_line_debit, v_line_credit,
      v_line->>'description',
      NULLIF(v_line->>'storeId', '')::UUID,
      NULLIF(v_line->>'projectId', '')::UUID,
      NULLIF(v_line->>'departmentId', '')::UUID,
      v_curr, v_fc_debit, v_fc_credit, v_rate
    );
  END LOOP;

  PERFORM public._log_journal_entry_audit(
    p_org_id, v_entry_id,
    CASE WHEN v_status = 'draft'::journal_entry_status THEN 'created_draft' ELSE 'posted' END,
    jsonb_build_object('journal_code', p_journal_code, 'source_type', p_source_type)
  );

  RETURN v_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Foreign currency journal posting
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_foreign_currency_journal(
  p_org_id UUID,
  p_date DATE,
  p_memo TEXT,
  p_currency_code TEXT,
  p_lines JSONB,
  p_exchange_rate NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_functional TEXT;
  v_rate NUMERIC;
  v_line JSONB;
  v_out JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_functional := public._org_functional_currency(p_org_id);
  IF upper(trim(p_currency_code)) = upper(v_functional) THEN
    RAISE EXCEPTION 'Use post_journal_entry for functional currency %', v_functional;
  END IF;

  v_rate := COALESCE(
    NULLIF(p_exchange_rate, 0),
    public._get_exchange_rate_value(p_org_id, p_currency_code, COALESCE(p_date, current_date), 'spot')
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_out := v_out || jsonb_build_array(
      jsonb_build_object(
        'accountId', v_line->>'accountId',
        'description', v_line->>'description',
        'transactionCurrency', upper(trim(p_currency_code)),
        'transactionDebit', COALESCE((v_line->>'transactionDebit')::NUMERIC, 0),
        'transactionCredit', COALESCE((v_line->>'transactionCredit')::NUMERIC, 0),
        'exchangeRate', v_rate,
        'storeId', v_line->>'storeId',
        'projectId', v_line->>'projectId',
        'departmentId', v_line->>'departmentId'
      )
    );
  END LOOP;

  RETURN public._post_journal_entry_balanced(
    p_org_id, 'FX', COALESCE(p_date, current_date), p_memo,
    'fx_journal', gen_random_uuid(), v_out, auth.uid(), 'posted'::journal_entry_status
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_foreign_currency_journal(UUID, DATE, TEXT, TEXT, JSONB, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- Foreign currency exposure preview
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_foreign_currency_balances(
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
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_functional := public._org_functional_currency(p_org_id);

  RETURN jsonb_build_object(
    'functional_currency', v_functional,
    'as_of', v_as_of,
    'accounts', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'account_code'))
      FROM (
        SELECT jsonb_build_object(
          'account_id', raw.account_id,
          'account_code', raw.account_code,
          'account_name', raw.account_name,
          'currency_code', raw.currency_code,
          'foreign_balance', raw.foreign_balance,
          'book_balance', raw.book_balance,
          'closing_rate', raw.closing_rate,
          'translated_balance', round(raw.foreign_balance * raw.closing_rate, 2),
          'unrealized_adjustment', round((raw.foreign_balance * raw.closing_rate) - raw.book_balance, 2),
          'source', raw.source
        ) AS row_data
        FROM (
          SELECT DISTINCT ON (a.id)
            a.id AS account_id,
            a.code AS account_code,
            a.name AS account_name,
            COALESCE(upper(ba.currency), upper(a.currency_code)) AS currency_code,
            public._account_foreign_balance(
              a.id, COALESCE(upper(ba.currency), upper(a.currency_code)), v_as_of
            ) AS foreign_balance,
            public._account_book_balance(a.id, v_as_of) AS book_balance,
            public._get_exchange_rate_value(
              p_org_id, COALESCE(upper(ba.currency), upper(a.currency_code)), v_as_of, 'spot'
            ) AS closing_rate,
            CASE WHEN ba.id IS NOT NULL THEN 'bank' ELSE 'account' END AS source
          FROM accounts a
          LEFT JOIN bank_accounts ba
            ON ba.gl_account_id = a.id AND ba.organization_id = p_org_id AND ba.is_active
          WHERE a.organization_id = p_org_id
            AND a.is_active
            AND (
              (a.currency_code IS NOT NULL AND upper(a.currency_code) <> upper(v_functional))
              OR (ba.currency IS NOT NULL AND upper(ba.currency) <> upper(v_functional))
            )
          ORDER BY a.id, ba.id NULLS LAST
        ) raw
        WHERE abs(raw.foreign_balance) > 0.001 OR abs(raw.book_balance) > 0.01
      ) rows
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_foreign_currency_balances(UUID, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_fx_revaluation(
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
  v_payload JSONB;
  v_total_gain NUMERIC := 0;
  v_total_loss NUMERIC := 0;
  v_row JSONB;
BEGIN
  v_payload := public.get_foreign_currency_balances(p_org_id, COALESCE(p_as_of, current_date));

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_payload->'accounts') LOOP
    IF COALESCE((v_row->>'unrealized_adjustment')::NUMERIC, 0) > 0 THEN
      v_total_gain := v_total_gain + (v_row->>'unrealized_adjustment')::NUMERIC;
    ELSIF COALESCE((v_row->>'unrealized_adjustment')::NUMERIC, 0) < 0 THEN
      v_total_loss := v_total_loss + abs((v_row->>'unrealized_adjustment')::NUMERIC);
    END IF;
  END LOOP;

  RETURN v_payload || jsonb_build_object(
    'total_gain', round(v_total_gain, 2),
    'total_loss', round(v_total_loss, 2)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.preview_fx_revaluation(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Run FX revaluation (unrealized gain/loss journal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_fx_revaluation(
  p_org_id UUID,
  p_as_of DATE DEFAULT NULL,
  p_memo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of DATE := COALESCE(p_as_of, current_date);
  v_preview JSONB;
  v_row JSONB;
  v_lines JSONB := '[]'::jsonb;
  v_adj NUMERIC;
  v_gain_acct UUID;
  v_loss_acct UUID;
  v_entry_id UUID;
  v_run_id UUID;
  v_total_gain NUMERIC := 0;
  v_total_loss NUMERIC := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public._assert_accounting_date_open(p_org_id, v_as_of);
  PERFORM public.ensure_default_accounts(p_org_id);

  IF EXISTS (
    SELECT 1 FROM fx_revaluation_runs
    WHERE organization_id = p_org_id AND as_of_date = v_as_of AND status = 'posted'
  ) THEN
    RAISE EXCEPTION 'FX revaluation already posted for %', v_as_of;
  END IF;

  v_preview := public.preview_fx_revaluation(p_org_id, v_as_of);

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_preview->'accounts') LOOP
    v_adj := round(COALESCE((v_row->>'unrealized_adjustment')::NUMERIC, 0), 2);
    IF abs(v_adj) <= 0.01 THEN
      CONTINUE;
    END IF;

    IF v_adj > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('accountId', v_row->>'account_id', 'debit', v_adj, 'credit', 0, 'description', 'FX revaluation'),
        jsonb_build_object('accountId', public.account_id_by_code(p_org_id, '4910'), 'debit', 0, 'credit', v_adj, 'description', 'Unrealized FX gain')
      );
      v_total_gain := v_total_gain + v_adj;
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('accountId', public.account_id_by_code(p_org_id, '4920'), 'debit', abs(v_adj), 'credit', 0, 'description', 'Unrealized FX loss'),
        jsonb_build_object('accountId', v_row->>'account_id', 'debit', 0, 'credit', abs(v_adj), 'description', 'FX revaluation')
      );
      v_total_loss := v_total_loss + abs(v_adj);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
    RETURN jsonb_build_object('posted', false, 'message', 'No revaluation adjustments required', 'as_of', v_as_of);
  END IF;

  v_entry_id := public._post_journal_entry_balanced(
    p_org_id, 'FX', v_as_of,
    COALESCE(NULLIF(trim(p_memo), ''), 'FX revaluation — ' || v_as_of::text),
    'fx_revaluation', gen_random_uuid(), v_lines, auth.uid(), 'posted'::journal_entry_status
  );

  INSERT INTO fx_revaluation_runs (
    organization_id, as_of_date, journal_entry_id, total_gain, total_loss, memo, created_by
  ) VALUES (
    p_org_id, v_as_of, v_entry_id, round(v_total_gain, 2), round(v_total_loss, 2),
    NULLIF(trim(p_memo), ''), auth.uid()
  ) RETURNING id INTO v_run_id;

  INSERT INTO fx_revaluation_lines (
    run_id, organization_id, account_id, currency_code,
    foreign_balance, book_balance, closing_rate, translated_balance, adjustment
  )
  SELECT
    v_run_id, p_org_id,
    (row->>'account_id')::UUID,
    row->>'currency_code',
    (row->>'foreign_balance')::NUMERIC,
    (row->>'book_balance')::NUMERIC,
    (row->>'closing_rate')::NUMERIC,
    (row->>'translated_balance')::NUMERIC,
    (row->>'unrealized_adjustment')::NUMERIC
  FROM jsonb_array_elements(v_preview->'accounts') row
  WHERE abs(COALESCE((row->>'unrealized_adjustment')::NUMERIC, 0)) > 0.01;

  RETURN jsonb_build_object(
    'posted', true,
    'run_id', v_run_id,
    'journal_entry_id', v_entry_id,
    'as_of', v_as_of,
    'total_gain', round(v_total_gain, 2),
    'total_loss', round(v_total_loss, 2)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_fx_revaluation(UUID, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_fx_revaluation_runs(
  p_org_id UUID,
  p_limit INT DEFAULT 20
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
      SELECT
        jsonb_build_object(
          'id', r.id,
          'as_of_date', r.as_of_date,
          'status', r.status,
          'journal_entry_id', r.journal_entry_id,
          'total_gain', r.total_gain,
          'total_loss', r.total_loss,
          'memo', r.memo,
          'created_at', r.created_at,
          'reversed_at', r.reversed_at,
          'lines', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'account_id', l.account_id,
                'currency_code', l.currency_code,
                'foreign_balance', l.foreign_balance,
                'book_balance', l.book_balance,
                'closing_rate', l.closing_rate,
                'translated_balance', l.translated_balance,
                'adjustment', l.adjustment
              )
            )
            FROM fx_revaluation_lines l
            WHERE l.run_id = r.id
          ), '[]'::jsonb)
        ) AS row_data,
        r.as_of_date AS sort_date,
        r.created_at AS sort_created
      FROM fx_revaluation_runs r
      WHERE r.organization_id = p_org_id
      ORDER BY r.as_of_date DESC, r.created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 20), 1)
    ) t
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_fx_revaluation_runs(UUID, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_fx_revaluation(p_run_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run fx_revaluation_runs%ROWTYPE;
  v_reversal_id UUID;
BEGIN
  SELECT * INTO v_run FROM fx_revaluation_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FX revaluation run not found'; END IF;
  IF NOT public.user_can_manage(v_run.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_run.status <> 'posted' THEN RAISE EXCEPTION 'Run is not posted'; END IF;
  IF v_run.journal_entry_id IS NULL THEN RAISE EXCEPTION 'Run has no journal entry'; END IF;

  v_reversal_id := public.reverse_journal_entry(v_run.journal_entry_id);

  UPDATE fx_revaluation_runs
  SET status = 'reversed', reversed_at = now()
  WHERE id = p_run_id;

  RETURN v_reversal_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reverse_fx_revaluation(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Bank account — tag GL account currency + surface FX flag
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_bank_account(
  p_org_id UUID,
  p_bank_account_id UUID,
  p_name TEXT,
  p_gl_account_id UUID,
  p_account_number TEXT DEFAULT NULL,
  p_bank_name TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_currency TEXT;
  v_functional TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM accounts
    WHERE id = p_gl_account_id AND organization_id = p_org_id AND type = 'asset'
  ) THEN
    RAISE EXCEPTION 'GL account must be an asset account in this organization';
  END IF;

  v_functional := public._org_functional_currency(p_org_id);
  SELECT COALESCE(NULLIF(trim(p_currency), ''), currency) INTO v_currency
  FROM organizations WHERE id = p_org_id;

  IF p_bank_account_id IS NOT NULL THEN
    UPDATE bank_accounts
    SET
      name = trim(p_name),
      gl_account_id = p_gl_account_id,
      account_number = NULLIF(trim(p_account_number), ''),
      bank_name = NULLIF(trim(p_bank_name), ''),
      currency = v_currency,
      is_active = COALESCE(p_is_active, true)
    WHERE id = p_bank_account_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO bank_accounts (
      organization_id, name, gl_account_id, account_number, bank_name, currency, is_active
    ) VALUES (
      p_org_id, trim(p_name), p_gl_account_id,
      NULLIF(trim(p_account_number), ''), NULLIF(trim(p_bank_name), ''),
      v_currency, COALESCE(p_is_active, true)
    ) RETURNING id INTO v_id;
  END IF;

  IF upper(v_currency) <> upper(v_functional) THEN
    UPDATE accounts SET currency_code = upper(v_currency) WHERE id = p_gl_account_id;
    UPDATE organizations SET multi_currency_enabled = true WHERE id = p_org_id;
  END IF;

  RETURN v_id;
END;
$$;

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

-- ---------------------------------------------------------------------------
-- Close checklist — FX revaluation warning
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_close_checklist(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO close_checklist_templates (
    organization_id, task_code, label, module, description, is_blocking, sort_order
  ) VALUES
    (p_org_id, 'unposted_sales', 'Unposted POS sales', 'pos',
     'Completed sales in this period without a ledger entry', true, 10),
    (p_org_id, 'ledger_queue', 'Ledger post queue', 'pos',
     'Sales waiting in the async ledger posting queue', true, 20),
    (p_org_id, 'draft_journals', 'Draft journal entries', 'gl',
     'Manual journal drafts dated in this period', true, 30),
    (p_org_id, 'unreconciled_bank', 'Unreconciled bank lines', 'bank',
     'Bank statement lines through period end not yet reconciled', true, 40),
    (p_org_id, 'pending_payment_runs', 'Pending AP payment runs', 'ap',
     'Payment runs still in draft or approved status', true, 50),
    (p_org_id, 'trial_balance', 'Trial balance', 'gl',
     'Debits must equal credits as of period end', true, 60),
    (p_org_id, 'subledgers_lock', 'Lock subledgers', 'close',
     'Freeze AR/AP/POS postings for this period before GL close', true, 70),
    (p_org_id, 'fx_revaluation', 'FX revaluation', 'fx',
     'Foreign currency accounts should be revalued before period close', false, 75),
    (p_org_id, 'draft_ar_invoices', 'Draft AR invoices', 'ar',
     'Customer invoices still in draft for this period', false, 80),
    (p_org_id, 'draft_ap_bills', 'Draft AP bills', 'ap',
     'Vendor bills still in draft for this period', false, 90)
  ON CONFLICT (organization_id, task_code) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public._scan_close_task(
  p_org_id UUID,
  p_period fiscal_periods,
  p_task_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_debit NUMERIC := 0;
  v_credit NUMERIC := 0;
  v_diff NUMERIC := 0;
  v_status TEXT := 'passing';
  v_metric_label TEXT;
  v_functional TEXT;
BEGIN
  v_functional := public._org_functional_currency(p_org_id);

  CASE p_task_code
    WHEN 'unposted_sales' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM sales s
      WHERE s.organization_id = p_org_id
        AND s.status = 'completed'
        AND s.created_at::date BETWEEN p_period.start_date AND p_period.end_date
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.organization_id = s.organization_id
            AND je.source_type = 'sale' AND je.source_id = s.id
        );
      v_metric_label := 'unposted sales';
      IF v_count > 0 THEN v_status := 'blocked'; END IF;

    WHEN 'ledger_queue' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM sale_ledger_post_queue q
      JOIN sales s ON s.id = q.sale_id
      WHERE q.organization_id = p_org_id
        AND s.created_at::date BETWEEN p_period.start_date AND p_period.end_date;
      v_metric_label := 'queued sales';
      IF v_count > 0 THEN v_status := 'blocked'; END IF;

    WHEN 'draft_journals' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM journal_entries je
      WHERE je.organization_id = p_org_id
        AND je.entry_status = 'draft'::journal_entry_status
        AND je.entry_date BETWEEN p_period.start_date AND p_period.end_date;
      v_metric_label := 'draft entries';
      IF v_count > 0 THEN v_status := 'blocked'; END IF;

    WHEN 'unreconciled_bank' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM bank_statement_lines bsl
      JOIN bank_statements bs ON bs.id = bsl.statement_id
      JOIN bank_accounts ba ON ba.id = bs.bank_account_id
      WHERE ba.organization_id = p_org_id
        AND bsl.line_date <= p_period.end_date
        AND bsl.reconciled = false;
      v_metric_label := 'unreconciled lines';
      IF v_count > 0 THEN v_status := 'blocked'; END IF;

    WHEN 'pending_payment_runs' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM ap_payment_runs pr
      WHERE pr.organization_id = p_org_id
        AND pr.status IN ('draft', 'approved')
        AND pr.run_date <= p_period.end_date;
      v_metric_label := 'pending runs';
      IF v_count > 0 THEN v_status := 'blocked'; END IF;

    WHEN 'trial_balance' THEN
      SELECT COALESCE(SUM(tb.debit), 0), COALESCE(SUM(tb.credit), 0)
      INTO v_debit, v_credit
      FROM public.trial_balance(p_org_id, p_period.end_date) tb;
      v_diff := abs(v_debit - v_credit);
      v_count := CASE WHEN v_diff > 0.01 THEN 1 ELSE 0 END;
      v_metric_label := 'debit/credit variance';
      IF v_count > 0 THEN
        v_status := 'blocked';
      ELSE
        v_count := 0;
      END IF;
      RETURN jsonb_build_object(
        'status', v_status,
        'metric_value', v_diff,
        'metric_label', v_metric_label,
        'details', jsonb_build_object('total_debit', v_debit, 'total_credit', v_credit)
      );

    WHEN 'subledgers_lock' THEN
      IF p_period.subledgers_locked THEN
        v_status := 'complete';
        v_count := 0;
        v_metric_label := 'locked';
      ELSE
        v_status := 'blocked';
        v_count := 1;
        v_metric_label := 'not locked';
      END IF;

    WHEN 'fx_revaluation' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM bank_accounts ba
      WHERE ba.organization_id = p_org_id
        AND ba.is_active
        AND upper(ba.currency) <> upper(v_functional);
      IF v_count = 0 THEN
        v_status := 'passing';
        v_metric_label := 'no FC accounts';
      ELSIF EXISTS (
        SELECT 1 FROM fx_revaluation_runs r
        WHERE r.organization_id = p_org_id
          AND r.status = 'posted'
          AND r.as_of_date BETWEEN p_period.start_date AND p_period.end_date
      ) THEN
        v_status := 'passing';
        v_count := 0;
        v_metric_label := 'revalued';
      ELSE
        v_status := 'blocked';
        v_metric_label := 'FC accounts without reval';
      END IF;

    WHEN 'draft_ar_invoices' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM customer_invoices ci
      WHERE ci.organization_id = p_org_id
        AND ci.status = 'draft'::invoice_status
        AND ci.invoice_date BETWEEN p_period.start_date AND p_period.end_date;
      v_metric_label := 'draft invoices';
      IF v_count > 0 THEN v_status := 'blocked'; ELSE v_status := 'passing'; END IF;

    WHEN 'draft_ap_bills' THEN
      SELECT COUNT(*)::INT INTO v_count
      FROM vendor_bills vb
      WHERE vb.organization_id = p_org_id
        AND vb.status = 'draft'::bill_status
        AND vb.bill_date BETWEEN p_period.start_date AND p_period.end_date;
      v_metric_label := 'draft bills';
      IF v_count > 0 THEN v_status := 'blocked'; ELSE v_status := 'passing'; END IF;

    ELSE
      v_status := 'pending';
      v_metric_label := 'unknown';
  END CASE;

  RETURN jsonb_build_object(
    'status', v_status,
    'metric_value', v_count,
    'metric_label', v_metric_label,
    'details', '{}'::jsonb
  );
END;
$$;

-- list_accounts — include currency_code
CREATE OR REPLACE FUNCTION public.list_accounts(p_org_id UUID)
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
        'id', a.id,
        'code', a.code,
        'name', a.name,
        'type', a.type,
        'is_active', a.is_active,
        'is_postable', a.is_postable,
        'parent_account_id', a.parent_account_id,
        'sort_order', a.sort_order,
        'currency_code', a.currency_code,
        'created_at', a.created_at
      ) ORDER BY a.sort_order, a.code
    )
    FROM accounts a
    WHERE a.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;

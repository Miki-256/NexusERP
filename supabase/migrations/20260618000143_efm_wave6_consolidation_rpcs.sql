-- EFM Wave 6 — Consolidation & intercompany RPCs (requires 00142 schema)

-- ---------------------------------------------------------------------------
-- Translation helper (uses parent org exchange rates from Wave 5)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._consolidation_translate_amount(
  p_rate_org_id UUID,
  p_amount NUMERIC,
  p_from_currency TEXT,
  p_to_currency TEXT,
  p_date DATE DEFAULT current_date
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from TEXT := upper(trim(COALESCE(p_from_currency, '')));
  v_to TEXT := upper(trim(COALESCE(p_to_currency, '')));
  v_functional TEXT;
  v_in_functional NUMERIC;
  v_rate NUMERIC;
BEGIN
  IF v_from = v_to OR COALESCE(p_amount, 0) = 0 THEN
    RETURN COALESCE(p_amount, 0);
  END IF;

  v_functional := public._org_functional_currency(p_rate_org_id);

  IF v_from = upper(v_functional) THEN
    v_in_functional := p_amount;
  ELSE
    v_rate := public._get_exchange_rate_value(p_rate_org_id, v_from, p_date, 'spot');
    v_in_functional := p_amount * v_rate;
  END IF;

  IF v_to = upper(v_functional) THEN
    RETURN round(v_in_functional, 2);
  END IF;

  v_rate := public._get_exchange_rate_value(p_rate_org_id, v_to, p_date, 'spot');
  RETURN round(v_in_functional / v_rate, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public._consolidation_group_reporting_currency(p_group_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group consolidation_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_group FROM consolidation_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consolidation group not found';
  END IF;
  RETURN upper(COALESCE(
    NULLIF(trim(v_group.reporting_currency), ''),
    public._org_functional_currency(v_group.organization_id)
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public._member_ownership_percent(p_group_id UUID, p_member_org_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(cgm.ownership_percent, 100)
  FROM consolidation_group_members cgm
  WHERE cgm.group_id = p_group_id AND cgm.member_organization_id = p_member_org_id;
$$;

-- ---------------------------------------------------------------------------
-- IC default accounts
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

CREATE OR REPLACE FUNCTION public._ic_account_balance(
  p_org_id UUID,
  p_account_code TEXT,
  p_as_of DATE DEFAULT current_date
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct_id UUID;
BEGIN
  SELECT id INTO v_acct_id FROM accounts
  WHERE organization_id = p_org_id AND code = p_account_code AND is_active = true
  LIMIT 1;
  IF v_acct_id IS NULL THEN
    RETURN 0;
  END IF;
  RETURN public._account_book_balance(v_acct_id, p_as_of);
END;
$$;

-- ---------------------------------------------------------------------------
-- Consolidation groups (extended)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_consolidation_group(UUID, UUID, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.list_consolidation_groups(p_org_id UUID)
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
        'id', cg.id,
        'name', cg.name,
        'reporting_currency', upper(COALESCE(
          NULLIF(trim(cg.reporting_currency), ''),
          public._org_functional_currency(cg.organization_id)
        )),
        'elimination_method', cg.elimination_method,
        'members', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', o.id,
              'name', o.name,
              'currency', o.currency,
              'ownership_percent', cgm.ownership_percent,
              'member_role', cgm.member_role
            ) ORDER BY o.name
          )
          FROM consolidation_group_members cgm
          JOIN organizations o ON o.id = cgm.member_organization_id
          WHERE cgm.group_id = cg.id
        ), '[]'::jsonb)
      ) ORDER BY cg.name
    )
    FROM consolidation_groups cg
    WHERE cg.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_consolidation_group(
  p_org_id UUID,
  p_group_id UUID,
  p_name TEXT,
  p_member_org_ids JSONB,
  p_reporting_currency TEXT DEFAULT NULL,
  p_elimination_method TEXT DEFAULT 'virtual'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_elem JSONB;
  v_member_id UUID;
  v_ownership NUMERIC;
  v_role TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_group_id IS NOT NULL THEN
    UPDATE consolidation_groups
    SET
      name = trim(p_name),
      reporting_currency = NULLIF(upper(trim(p_reporting_currency)), ''),
      elimination_method = COALESCE(NULLIF(trim(p_elimination_method), ''), 'virtual')
    WHERE id = p_group_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;
    DELETE FROM consolidation_group_members WHERE group_id = v_id;
  ELSE
    INSERT INTO consolidation_groups (
      organization_id, name, reporting_currency, elimination_method
    ) VALUES (
      p_org_id, trim(p_name),
      NULLIF(upper(trim(p_reporting_currency)), ''),
      COALESCE(NULLIF(trim(p_elimination_method), ''), 'virtual')
    ) RETURNING id INTO v_id;
  END IF;

  IF NULLIF(trim(p_reporting_currency), '') IS NULL THEN
    UPDATE consolidation_groups
    SET reporting_currency = public._org_functional_currency(p_org_id)
    WHERE id = v_id AND reporting_currency IS NULL;
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(COALESCE(p_member_org_ids, '[]'::jsonb)) LOOP
    IF jsonb_typeof(v_elem) = 'object' THEN
      v_member_id := (v_elem->>'id')::UUID;
      v_ownership := COALESCE((v_elem->>'ownership_percent')::NUMERIC, 100);
      v_role := COALESCE(NULLIF(v_elem->>'member_role', ''), 'subsidiary');
    ELSE
      v_member_id := (v_elem #>> '{}')::UUID;
      v_ownership := 100;
      v_role := 'subsidiary';
    END IF;

    IF NOT public.user_has_org_access(v_member_id) THEN
      RAISE EXCEPTION 'No access to organization %', v_member_id;
    END IF;

    INSERT INTO consolidation_group_members (
      group_id, member_organization_id, ownership_percent, member_role
    ) VALUES (
      v_id, v_member_id, v_ownership, v_role
    ) ON CONFLICT (group_id, member_organization_id)
    DO UPDATE SET ownership_percent = EXCLUDED.ownership_percent, member_role = EXCLUDED.member_role;
  END LOOP;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_consolidation_group(UUID, UUID, TEXT, JSONB, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Intercompany relationships & transactions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_intercompany_relationship(
  p_org_id UUID,
  p_from_org_id UUID,
  p_to_org_id UUID,
  p_receivable_account_id UUID DEFAULT NULL,
  p_payable_account_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_recv UUID;
  v_pay UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_from_org_id = p_to_org_id THEN
    RAISE EXCEPTION 'From and to organizations must differ';
  END IF;
  IF NOT public.user_has_org_access(p_from_org_id) OR NOT public.user_has_org_access(p_to_org_id) THEN
    RAISE EXCEPTION 'Access denied to one or both organizations';
  END IF;

  PERFORM public.ensure_default_accounts(p_from_org_id);
  PERFORM public.ensure_default_accounts(p_to_org_id);

  v_recv := COALESCE(p_receivable_account_id, public.account_id_by_code(p_from_org_id, '1150'));
  v_pay := COALESCE(p_payable_account_id, public.account_id_by_code(p_to_org_id, '2150'));

  INSERT INTO intercompany_relationships (
    organization_id, from_org_id, to_org_id, receivable_account_id, payable_account_id
  ) VALUES (
    p_org_id, p_from_org_id, p_to_org_id, v_recv, v_pay
  )
  ON CONFLICT (organization_id, from_org_id, to_org_id)
  DO UPDATE SET
    receivable_account_id = EXCLUDED.receivable_account_id,
    payable_account_id = EXCLUDED.payable_account_id,
    is_active = true
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_intercompany_relationship(UUID, UUID, UUID, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_intercompany_relationships(p_org_id UUID)
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
        'id', r.id,
        'from_org_id', r.from_org_id,
        'from_org_name', fo.name,
        'to_org_id', r.to_org_id,
        'to_org_name', to_org.name,
        'receivable_account_id', r.receivable_account_id,
        'payable_account_id', r.payable_account_id,
        'is_active', r.is_active
      ) ORDER BY fo.name, to_org.name
    )
    FROM intercompany_relationships r
    JOIN organizations fo ON fo.id = r.from_org_id
    JOIN organizations to_org ON to_org.id = r.to_org_id
    WHERE r.organization_id = p_org_id AND r.is_active = true
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_intercompany_relationships(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_intercompany_invoice(
  p_org_id UUID,
  p_from_org_id UUID,
  p_to_org_id UUID,
  p_amount NUMERIC,
  p_transaction_date DATE DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := COALESCE(p_transaction_date, current_date);
  v_from_currency TEXT;
  v_to_currency TEXT;
  v_tx_id UUID;
  v_from_entry UUID;
  v_to_entry UUID;
  v_recv UUID;
  v_pay UUID;
  v_memo TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF NOT public.user_can_manage(p_from_org_id) OR NOT public.user_can_manage(p_to_org_id) THEN
    RAISE EXCEPTION 'Manage access required in both organizations';
  END IF;

  PERFORM public.ensure_default_accounts(p_from_org_id);
  PERFORM public.ensure_default_accounts(p_to_org_id);

  v_from_currency := public._org_functional_currency(p_from_org_id);
  v_to_currency := public._org_functional_currency(p_to_org_id);
  v_memo := COALESCE(NULLIF(trim(p_description), ''), 'Intercompany invoice');

  PERFORM public.upsert_intercompany_relationship(p_org_id, p_from_org_id, p_to_org_id);

  SELECT receivable_account_id, payable_account_id
  INTO v_recv, v_pay
  FROM intercompany_relationships
  WHERE organization_id = p_org_id
    AND from_org_id = p_from_org_id AND to_org_id = p_to_org_id AND is_active = true;

  v_from_entry := public._post_journal_entry_balanced(
    p_from_org_id, 'IC', v_date, v_memo, 'intercompany', gen_random_uuid(),
    jsonb_build_array(
      jsonb_build_object('accountId', v_recv, 'debit', p_amount, 'credit', 0, 'description', 'IC receivable'),
      jsonb_build_object('accountId', public.account_id_by_code(p_from_org_id, '4000'),
        'debit', 0, 'credit', p_amount, 'description', 'IC revenue')
    ), auth.uid(), 'posted'::journal_entry_status
  );

  v_to_entry := public._post_journal_entry_balanced(
    p_to_org_id, 'IC', v_date, v_memo, 'intercompany', gen_random_uuid(),
    jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(p_to_org_id, '6000'),
        'debit', p_amount, 'credit', 0, 'description', 'IC expense'),
      jsonb_build_object('accountId', v_pay, 'debit', 0, 'credit', p_amount, 'description', 'IC payable')
    ), auth.uid(), 'posted'::journal_entry_status
  );

  INSERT INTO intercompany_transactions (
    organization_id, from_org_id, to_org_id, transaction_date, amount, currency,
    description, status, from_journal_entry_id, to_journal_entry_id, created_by
  ) VALUES (
    p_org_id, p_from_org_id, p_to_org_id, v_date, p_amount, v_from_currency,
    v_memo, 'open', v_from_entry, v_to_entry, auth.uid()
  ) RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_intercompany_invoice(UUID, UUID, UUID, NUMERIC, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_intercompany_transactions(
  p_org_id UUID,
  p_status TEXT DEFAULT NULL,
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
        'from_org_id', t.from_org_id,
        'from_org_name', fo.name,
        'to_org_id', t.to_org_id,
        'to_org_name', to_org.name,
        'transaction_date', t.transaction_date,
        'amount', t.amount,
        'currency', t.currency,
        'description', t.description,
        'status', t.status,
        'from_journal_entry_id', t.from_journal_entry_id,
        'to_journal_entry_id', t.to_journal_entry_id,
        'created_at', t.created_at
      ) AS row_data,
      t.transaction_date AS sort_date,
      t.created_at AS sort_created
      FROM intercompany_transactions t
      JOIN organizations fo ON fo.id = t.from_org_id
      JOIN organizations to_org ON to_org.id = t.to_org_id
      WHERE t.organization_id = p_org_id
        AND (p_status IS NULL OR t.status = p_status)
      ORDER BY t.transaction_date DESC, t.created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    ) q
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_intercompany_transactions(UUID, TEXT, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Intercompany matrix & elimination preview
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_intercompany_matrix(
  p_group_id UUID,
  p_as_of DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group consolidation_groups%ROWTYPE;
  v_as_of DATE := COALESCE(p_as_of, current_date);
  v_reporting TEXT;
  v_member UUID;
  v_currency TEXT;
  v_ar NUMERIC;
  v_ap NUMERIC;
  v_rows JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO v_group FROM consolidation_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF NOT public.user_has_org_access(v_group.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_reporting := public._consolidation_group_reporting_currency(p_group_id);

  FOR v_member IN
    SELECT member_organization_id FROM consolidation_group_members WHERE group_id = p_group_id
  LOOP
    IF NOT public.user_has_org_access(v_member) THEN
      RAISE EXCEPTION 'No access to member organization';
    END IF;
    v_currency := public._org_functional_currency(v_member);
    v_ar := public._consolidation_translate_amount(
      v_group.organization_id,
      public._ic_account_balance(v_member, '1150', v_as_of),
      v_currency, v_reporting, v_as_of
    );
    v_ap := public._consolidation_translate_amount(
      v_group.organization_id,
      public._ic_account_balance(v_member, '2150', v_as_of),
      v_currency, v_reporting, v_as_of
    );
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'organization_id', v_member,
      'name', (SELECT name FROM organizations WHERE id = v_member),
      'currency', v_currency,
      'ic_receivable', v_ar,
      'ic_payable', v_ap
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'group_id', p_group_id,
    'as_of', v_as_of,
    'reporting_currency', v_reporting,
    'organizations', v_rows,
    'total_ic_receivable', COALESCE((
      SELECT SUM((row->>'ic_receivable')::NUMERIC) FROM jsonb_array_elements(v_rows) row
    ), 0),
    'total_ic_payable', COALESCE((
      SELECT SUM((row->>'ic_payable')::NUMERIC) FROM jsonb_array_elements(v_rows) row
    ), 0)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_intercompany_matrix(UUID, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_consolidation_eliminations(
  p_group_id UUID,
  p_as_of DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matrix JSONB;
  v_total_ar NUMERIC;
  v_total_ap NUMERIC;
  v_elimination NUMERIC;
BEGIN
  v_matrix := public.get_intercompany_matrix(p_group_id, p_as_of);
  v_total_ar := COALESCE((v_matrix->>'total_ic_receivable')::NUMERIC, 0);
  v_total_ap := COALESCE((v_matrix->>'total_ic_payable')::NUMERIC, 0);
  v_elimination := LEAST(abs(v_total_ar), abs(v_total_ap));

  RETURN v_matrix || jsonb_build_object(
    'elimination_amount', round(v_elimination, 2),
    'method', (SELECT elimination_method FROM consolidation_groups WHERE id = p_group_id)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.preview_consolidation_eliminations(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Consolidated statements with FX translation + IC elimination
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consolidated_profit_and_loss(
  p_group_id UUID,
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
  v_group consolidation_groups%ROWTYPE;
  v_member UUID;
  v_pnl JSONB;
  v_revenue NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_cogs NUMERIC := 0;
  v_opex NUMERIC := 0;
  v_orgs JSONB := '[]'::jsonb;
  v_reporting TEXT;
  v_member_currency TEXT;
  v_ownership NUMERIC;
  v_rev NUMERIC;
  v_cog NUMERIC;
  v_op NUMERIC;
  v_mixed_currency BOOLEAN := false;
BEGIN
  SELECT * INTO v_group FROM consolidation_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF NOT public.user_has_org_access(v_group.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_reporting := public._consolidation_group_reporting_currency(p_group_id);

  FOR v_member IN
    SELECT member_organization_id FROM consolidation_group_members WHERE group_id = p_group_id
  LOOP
    IF NOT public.user_has_org_access(v_member) THEN
      RAISE EXCEPTION 'No access to member organization';
    END IF;

    v_member_currency := public._org_functional_currency(v_member);
    IF upper(v_member_currency) <> v_reporting THEN
      v_mixed_currency := true;
    END IF;

    v_pnl := public.profit_and_loss(v_member, p_from, p_to, p_mode);
    v_ownership := public._member_ownership_percent(p_group_id, v_member) / 100.0;

    v_rev := public._consolidation_translate_amount(
      v_group.organization_id,
      COALESCE((v_pnl->>'revenue')::NUMERIC, 0) * v_ownership,
      v_member_currency, v_reporting, p_to
    );
    v_cog := public._consolidation_translate_amount(
      v_group.organization_id,
      COALESCE((v_pnl->>'cogs')::NUMERIC, 0) * v_ownership,
      v_member_currency, v_reporting, p_to
    );
    v_op := public._consolidation_translate_amount(
      v_group.organization_id,
      COALESCE((v_pnl->>'operating_expenses')::NUMERIC, 0) * v_ownership,
      v_member_currency, v_reporting, p_to
    );

    v_revenue := v_revenue + v_rev;
    v_tax := v_tax + public._consolidation_translate_amount(
      v_group.organization_id,
      COALESCE((v_pnl->>'tax_collected')::NUMERIC, 0) * v_ownership,
      v_member_currency, v_reporting, p_to
    );
    v_cogs := v_cogs + v_cog;
    v_opex := v_opex + v_op;

    v_orgs := v_orgs || jsonb_build_array(jsonb_build_object(
      'organization_id', v_member,
      'name', (SELECT name FROM organizations WHERE id = v_member),
      'currency', v_member_currency,
      'ownership_percent', v_ownership * 100,
      'original_net_profit', COALESCE((v_pnl->>'net_profit')::NUMERIC, 0),
      'translated_net_profit', public._consolidation_translate_amount(
        v_group.organization_id,
        COALESCE((v_pnl->>'net_profit')::NUMERIC, 0) * v_ownership,
        v_member_currency, v_reporting, p_to
      )
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'group_id', p_group_id,
    'group_name', v_group.name,
    'from', p_from,
    'to', p_to,
    'mode', p_mode,
    'reporting_currency', v_reporting,
    'mixed_currency', v_mixed_currency,
    'translation_applied', v_mixed_currency,
    'revenue', round(v_revenue, 2),
    'tax_collected', round(v_tax, 2),
    'cogs', round(v_cogs, 2),
    'gross_profit', round(v_revenue - v_cogs, 2),
    'operating_expenses', round(v_opex, 2),
    'net_profit', round(v_revenue - v_cogs - v_opex, 2),
    'organizations', v_orgs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consolidated_balance_sheet(
  p_group_id UUID,
  p_as_of DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group consolidation_groups%ROWTYPE;
  v_member UUID;
  v_bs JSONB;
  v_total_assets NUMERIC := 0;
  v_total_liab NUMERIC := 0;
  v_total_equity NUMERIC := 0;
  v_orgs JSONB := '[]'::jsonb;
  v_reporting TEXT;
  v_member_currency TEXT;
  v_ownership NUMERIC;
  v_assets NUMERIC;
  v_liab NUMERIC;
  v_equity NUMERIC;
  v_elimination NUMERIC := 0;
  v_mixed_currency BOOLEAN := false;
BEGIN
  SELECT * INTO v_group FROM consolidation_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF NOT public.user_has_org_access(v_group.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_reporting := public._consolidation_group_reporting_currency(p_group_id);

  FOR v_member IN
    SELECT member_organization_id FROM consolidation_group_members WHERE group_id = p_group_id
  LOOP
    IF NOT public.user_has_org_access(v_member) THEN
      RAISE EXCEPTION 'No access to member organization';
    END IF;

    v_member_currency := public._org_functional_currency(v_member);
    IF upper(v_member_currency) <> v_reporting THEN
      v_mixed_currency := true;
    END IF;

    v_bs := public.balance_sheet(v_member, p_as_of);
    v_ownership := public._member_ownership_percent(p_group_id, v_member) / 100.0;

    v_assets := public._consolidation_translate_amount(
      v_group.organization_id,
      COALESCE((v_bs->>'total_assets')::NUMERIC, 0) * v_ownership,
      v_member_currency, v_reporting, p_as_of
    );
    v_liab := public._consolidation_translate_amount(
      v_group.organization_id,
      COALESCE((v_bs->>'total_liabilities')::NUMERIC, 0) * v_ownership,
      v_member_currency, v_reporting, p_as_of
    );
    v_equity := public._consolidation_translate_amount(
      v_group.organization_id,
      COALESCE((v_bs->>'total_equity')::NUMERIC, 0) * v_ownership,
      v_member_currency, v_reporting, p_as_of
    );

    v_total_assets := v_total_assets + v_assets;
    v_total_liab := v_total_liab + v_liab;
    v_total_equity := v_total_equity + v_equity;

    v_orgs := v_orgs || jsonb_build_array(jsonb_build_object(
      'organization_id', v_member,
      'name', (SELECT name FROM organizations WHERE id = v_member),
      'currency', v_member_currency,
      'ownership_percent', v_ownership * 100,
      'original_total_assets', COALESCE((v_bs->>'total_assets')::NUMERIC, 0),
      'translated_total_assets', v_assets
    ));
  END LOOP;

  IF v_group.elimination_method = 'virtual' THEN
    v_elimination := COALESCE((public.preview_consolidation_eliminations(p_group_id, p_as_of)->>'elimination_amount')::NUMERIC, 0);
    v_total_assets := v_total_assets - v_elimination;
    v_total_liab := v_total_liab - v_elimination;
  END IF;

  RETURN jsonb_build_object(
    'group_id', p_group_id,
    'group_name', v_group.name,
    'as_of', p_as_of,
    'reporting_currency', v_reporting,
    'mixed_currency', v_mixed_currency,
    'translation_applied', v_mixed_currency,
    'ic_elimination', round(v_elimination, 2),
    'elimination_method', v_group.elimination_method,
    'total_assets', round(v_total_assets, 2),
    'total_liabilities', round(v_total_liab, 2),
    'total_equity', round(v_total_equity, 2),
    'total_liabilities_and_equity', round(v_total_liab + v_total_equity, 2),
    'organizations', v_orgs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_consolidation_run(
  p_group_id UUID,
  p_run_type TEXT,
  p_payload JSONB,
  p_period_from DATE DEFAULT NULL,
  p_period_to DATE DEFAULT NULL,
  p_as_of DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group consolidation_groups%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO v_group FROM consolidation_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF NOT public.user_can_manage(v_group.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO consolidation_runs (
    organization_id, group_id, run_type, period_from, period_to, as_of_date,
    reporting_currency, payload, created_by
  ) VALUES (
    v_group.organization_id, p_group_id, p_run_type, p_period_from, p_period_to, p_as_of,
    public._consolidation_group_reporting_currency(p_group_id),
    COALESCE(p_payload, '{}'::jsonb), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_consolidation_run(UUID, TEXT, JSONB, DATE, DATE, DATE) TO authenticated;

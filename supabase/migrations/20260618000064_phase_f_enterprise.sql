-- Phase F — Enterprise (no multi-currency): fixed assets, consolidation, automation, report library.

-- ---------------------------------------------------------------------------
-- Fixed asset GL accounts
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
    (p_org_id, '3000', 'Owner Equity',        'equity'),
    (p_org_id, '3900', 'Retained Earnings',   'equity'),
    (p_org_id, '4000', 'Sales Revenue',       'income'),
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
    (p_org_id, 'DEP', 'Depreciation', 'general')
  ON CONFLICT (organization_id, code) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixed assets
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fixed_asset_status') THEN
    CREATE TYPE fixed_asset_status AS ENUM ('active', 'fully_depreciated', 'disposed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_no TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  acquisition_date DATE NOT NULL DEFAULT current_date,
  acquisition_cost NUMERIC(14,2) NOT NULL CHECK (acquisition_cost > 0),
  salvage_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  useful_life_months INT NOT NULL CHECK (useful_life_months > 0),
  status fixed_asset_status NOT NULL DEFAULT 'active',
  acquisition_entry_id UUID REFERENCES journal_entries(id),
  disposed_at TIMESTAMPTZ,
  disposal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, asset_no)
);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_org ON fixed_assets(organization_id, status);

CREATE TABLE IF NOT EXISTS public.fixed_asset_depreciation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_date)
);
CREATE INDEX IF NOT EXISTS idx_fa_depr_asset ON fixed_asset_depreciation(asset_id, period_date);

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_asset_depreciation ENABLE ROW LEVEL SECURITY;

CREATE POLICY fixed_assets_select ON fixed_assets FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY fixed_assets_write ON fixed_assets FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY fa_depr_select ON fixed_asset_depreciation FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY fa_depr_write ON fixed_asset_depreciation FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE OR REPLACE FUNCTION public._fixed_asset_monthly_depr(
  p_cost NUMERIC,
  p_salvage NUMERIC,
  p_months INT
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(GREATEST(p_cost - p_salvage, 0) / GREATEST(p_months, 1), 2);
$$;

CREATE OR REPLACE FUNCTION public._fixed_asset_accum_depr(p_asset_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount), 0) FROM fixed_asset_depreciation WHERE asset_id = p_asset_id;
$$;

CREATE OR REPLACE FUNCTION public.list_fixed_assets(p_org_id UUID)
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
        'id', fa.id,
        'asset_no', fa.asset_no,
        'name', fa.name,
        'description', fa.description,
        'acquisition_date', fa.acquisition_date,
        'acquisition_cost', fa.acquisition_cost,
        'salvage_value', fa.salvage_value,
        'useful_life_months', fa.useful_life_months,
        'monthly_depreciation', public._fixed_asset_monthly_depr(fa.acquisition_cost, fa.salvage_value, fa.useful_life_months),
        'accumulated_depreciation', public._fixed_asset_accum_depr(fa.id),
        'book_value', fa.acquisition_cost - public._fixed_asset_accum_depr(fa.id),
        'status', fa.status,
        'disposed_at', fa.disposed_at
      ) ORDER BY fa.acquisition_date DESC, fa.asset_no
    )
    FROM fixed_assets fa
    WHERE fa.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_fixed_assets(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_fixed_asset(
  p_org_id UUID,
  p_name TEXT,
  p_acquisition_date DATE,
  p_cost NUMERIC,
  p_salvage NUMERIC DEFAULT 0,
  p_useful_life_months INT DEFAULT 60,
  p_payment_method payment_method DEFAULT 'bank_transfer',
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_no TEXT;
  v_seq INT;
  v_pay_acct UUID;
  v_asset_acct UUID;
  v_entry_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_cost <= 0 OR p_useful_life_months <= 0 THEN
    RAISE EXCEPTION 'Invalid asset cost or useful life';
  END IF;

  PERFORM public.ensure_default_accounts(p_org_id);

  SELECT COUNT(*) + 1 INTO v_seq FROM fixed_assets WHERE organization_id = p_org_id;
  v_no := 'FA-' || lpad(v_seq::text, 5, '0');

  v_asset_acct := public.account_id_by_code(p_org_id, '1500');
  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(p_org_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(p_org_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(p_org_id, '1020')
    ELSE public.account_id_by_code(p_org_id, '1010')
  END;

  INSERT INTO fixed_assets (
    organization_id, asset_no, name, description, acquisition_date,
    acquisition_cost, salvage_value, useful_life_months, status, created_by
  ) VALUES (
    p_org_id, v_no, trim(p_name), p_description, COALESCE(p_acquisition_date, current_date),
    p_cost, COALESCE(p_salvage, 0), p_useful_life_months, 'active', auth.uid()
  ) RETURNING id INTO v_id;

  v_entry_id := public._post_journal_entry_balanced(
    p_org_id, 'GEN', COALESCE(p_acquisition_date, current_date),
    'Fixed asset acquisition ' || v_no, 'fixed_asset', v_id,
    jsonb_build_array(
      jsonb_build_object('accountId', v_asset_acct, 'debit', p_cost, 'credit', 0, 'description', p_name),
      jsonb_build_object('accountId', v_pay_acct, 'debit', 0, 'credit', p_cost, 'description', 'Asset purchase')
    ),
    auth.uid()
  );

  UPDATE fixed_assets SET acquisition_entry_id = v_entry_id WHERE id = v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_fixed_asset(UUID, TEXT, DATE, NUMERIC, NUMERIC, INT, payment_method, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_depreciation_batch(
  p_org_id UUID,
  p_through_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_through DATE := COALESCE(p_through_date, current_date);
  v_asset RECORD;
  v_period DATE;
  v_monthly NUMERIC;
  v_accum NUMERIC;
  v_remaining NUMERIC;
  v_amount NUMERIC;
  v_entry_id UUID;
  v_posted INT := 0;
  v_depr_acct UUID;
  v_accum_acct UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_accounts(p_org_id);
  v_depr_acct := public.account_id_by_code(p_org_id, '6510');
  v_accum_acct := public.account_id_by_code(p_org_id, '1590');

  FOR v_asset IN
    SELECT * FROM fixed_assets
    WHERE organization_id = p_org_id AND status = 'active'
    ORDER BY acquisition_date
  LOOP
    v_monthly := public._fixed_asset_monthly_depr(
      v_asset.acquisition_cost, v_asset.salvage_value, v_asset.useful_life_months
    );
    v_period := date_trunc('month', v_asset.acquisition_date)::date;

    WHILE v_period <= date_trunc('month', v_through)::date LOOP
      IF v_period >= date_trunc('month', v_asset.acquisition_date)::date
         AND NOT EXISTS (
           SELECT 1 FROM fixed_asset_depreciation
           WHERE asset_id = v_asset.id AND period_date = v_period
         )
      THEN
        v_accum := public._fixed_asset_accum_depr(v_asset.id);
        v_remaining := v_asset.acquisition_cost - v_asset.salvage_value - v_accum;
        IF v_remaining <= 0.01 THEN
          UPDATE fixed_assets SET status = 'fully_depreciated' WHERE id = v_asset.id;
          EXIT;
        END IF;

        v_amount := LEAST(v_monthly, v_remaining);

        v_entry_id := public._post_journal_entry_balanced(
          p_org_id, 'DEP', (v_period + INTERVAL '1 month' - INTERVAL '1 day')::date,
          'Depreciation ' || v_asset.asset_no || ' ' || to_char(v_period, 'Mon YYYY'),
          'depreciation', v_asset.id,
          jsonb_build_array(
            jsonb_build_object('accountId', v_depr_acct, 'debit', v_amount, 'credit', 0, 'description', v_asset.name),
            jsonb_build_object('accountId', v_accum_acct, 'debit', 0, 'credit', v_amount, 'description', 'Accum depr')
          ),
          auth.uid()
        );

        INSERT INTO fixed_asset_depreciation (organization_id, asset_id, period_date, amount, journal_entry_id)
        VALUES (p_org_id, v_asset.id, v_period, v_amount, v_entry_id);

        v_posted := v_posted + 1;

        IF public._fixed_asset_accum_depr(v_asset.id) >= v_asset.acquisition_cost - v_asset.salvage_value - 0.01 THEN
          UPDATE fixed_assets SET status = 'fully_depreciated' WHERE id = v_asset.id;
          EXIT;
        END IF;
      END IF;

      v_period := (v_period + INTERVAL '1 month')::date;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('posted', v_posted, 'through_date', v_through);
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_depreciation_batch(UUID, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.dispose_fixed_asset(
  p_asset_id UUID,
  p_disposal_date DATE DEFAULT NULL,
  p_proceeds NUMERIC DEFAULT 0,
  p_payment_method payment_method DEFAULT 'bank_transfer'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset fixed_assets%ROWTYPE;
  v_accum NUMERIC;
  v_nbv NUMERIC;
  v_gain_loss NUMERIC;
  v_entry_id UUID;
  v_lines JSONB := '[]'::jsonb;
  v_pay_acct UUID;
  v_asset_acct UUID;
  v_accum_acct UUID;
  v_pl_acct UUID;
BEGIN
  SELECT * INTO v_asset FROM fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF NOT public.user_can_manage(v_asset.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_asset.status = 'disposed' THEN RAISE EXCEPTION 'Asset already disposed'; END IF;

  PERFORM public.ensure_default_accounts(v_asset.organization_id);
  v_asset_acct := public.account_id_by_code(v_asset.organization_id, '1500');
  v_accum_acct := public.account_id_by_code(v_asset.organization_id, '1590');
  v_pl_acct := public.account_id_by_code(v_asset.organization_id, '6000');
  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(v_asset.organization_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(v_asset.organization_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(v_asset.organization_id, '1020')
    ELSE public.account_id_by_code(v_asset.organization_id, '1010')
  END;

  v_accum := public._fixed_asset_accum_depr(v_asset.id);
  v_nbv := v_asset.acquisition_cost - v_accum;
  v_gain_loss := COALESCE(p_proceeds, 0) - v_nbv;

  IF COALESCE(p_proceeds, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('accountId', v_pay_acct, 'debit', p_proceeds, 'credit', 0, 'description', 'Disposal proceeds')
    );
  END IF;
  IF v_accum > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('accountId', v_accum_acct, 'debit', v_accum, 'credit', 0, 'description', 'Clear accum depr')
    );
  END IF;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('accountId', v_asset_acct, 'debit', 0, 'credit', v_asset.acquisition_cost, 'description', 'Remove asset cost')
  );
  IF abs(v_gain_loss) > 0.01 THEN
    IF v_gain_loss > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('accountId', v_pl_acct, 'debit', 0, 'credit', v_gain_loss, 'description', 'Gain on disposal')
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('accountId', v_pl_acct, 'debit', abs(v_gain_loss), 'credit', 0, 'description', 'Loss on disposal')
      );
    END IF;
  END IF;

  v_entry_id := public._post_journal_entry_balanced(
    v_asset.organization_id, 'GEN', COALESCE(p_disposal_date, current_date),
    'Dispose asset ' || v_asset.asset_no, 'fixed_asset_disposal', p_asset_id,
    v_lines, auth.uid()
  );

  UPDATE fixed_assets
  SET status = 'disposed', disposed_at = now(), disposal_entry_id = v_entry_id
  WHERE id = p_asset_id;

  RETURN v_entry_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset(UUID, DATE, NUMERIC, payment_method) TO authenticated;

-- ---------------------------------------------------------------------------
-- Consolidation groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consolidation_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.consolidation_group_members (
  group_id UUID NOT NULL REFERENCES consolidation_groups(id) ON DELETE CASCADE,
  member_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, member_organization_id)
);

ALTER TABLE consolidation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE consolidation_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY consolidation_groups_select ON consolidation_groups FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY consolidation_groups_write ON consolidation_groups FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY consolidation_members_select ON consolidation_group_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM consolidation_groups cg
    WHERE cg.id = group_id AND cg.organization_id IN (SELECT public.user_organization_ids())
  ));
CREATE POLICY consolidation_members_write ON consolidation_group_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM consolidation_groups cg
    WHERE cg.id = group_id AND cg.organization_id IN (SELECT public.user_organization_ids())
      AND public.user_can_manage(cg.organization_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM consolidation_groups cg
    WHERE cg.id = group_id AND cg.organization_id IN (SELECT public.user_organization_ids())
      AND public.user_can_manage(cg.organization_id)
  ));

CREATE OR REPLACE FUNCTION public.list_my_organizations()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('id', o.id, 'name', o.name, 'currency', o.currency)
      ORDER BY o.name
    )
    FROM organizations o
    JOIN organization_members m ON m.organization_id = o.id
    WHERE m.user_id = auth.uid()
      AND m.is_active = true
      AND o.status = 'active'
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_my_organizations() TO authenticated;

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
        'members', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('id', o.id, 'name', o.name)
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
GRANT EXECUTE ON FUNCTION public.list_consolidation_groups(UUID) TO authenticated;

-- p_member_org_ids: JSON array of UUID strings
CREATE OR REPLACE FUNCTION public.upsert_consolidation_group(
  p_org_id UUID,
  p_group_id UUID,
  p_name TEXT,
  p_member_org_ids JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_member_id UUID;
  v_elem JSONB;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_group_id IS NOT NULL THEN
    UPDATE consolidation_groups SET name = trim(p_name)
    WHERE id = p_group_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;
    DELETE FROM consolidation_group_members WHERE group_id = v_id;
  ELSE
    INSERT INTO consolidation_groups (organization_id, name)
    VALUES (p_org_id, trim(p_name))
    RETURNING id INTO v_id;
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(COALESCE(p_member_org_ids, '[]'::jsonb)) LOOP
    v_member_id := (v_elem #>> '{}')::UUID;
    IF NOT public.user_has_org_access(v_member_id) THEN
      RAISE EXCEPTION 'No access to organization %', v_member_id;
    END IF;
    INSERT INTO consolidation_group_members (group_id, member_organization_id)
    VALUES (v_id, v_member_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_consolidation_group(UUID, UUID, TEXT, JSONB) TO authenticated;

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
BEGIN
  SELECT * INTO v_group FROM consolidation_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF NOT public.user_has_org_access(v_group.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_member IN
    SELECT member_organization_id FROM consolidation_group_members WHERE group_id = p_group_id
  LOOP
    IF NOT public.user_has_org_access(v_member) THEN
      RAISE EXCEPTION 'No access to member organization';
    END IF;
    v_pnl := public.profit_and_loss(v_member, p_from, p_to, p_mode);
    v_revenue := v_revenue + COALESCE((v_pnl->>'revenue')::NUMERIC, 0);
    v_tax := v_tax + COALESCE((v_pnl->>'tax_collected')::NUMERIC, 0);
    v_cogs := v_cogs + COALESCE((v_pnl->>'cogs')::NUMERIC, 0);
    v_opex := v_opex + COALESCE((v_pnl->>'operating_expenses')::NUMERIC, 0);
    v_orgs := v_orgs || jsonb_build_array(jsonb_build_object(
      'organization_id', v_member,
      'name', (SELECT name FROM organizations WHERE id = v_member),
      'net_profit', COALESCE((v_pnl->>'net_profit')::NUMERIC, 0)
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'group_id', p_group_id,
    'group_name', v_group.name,
    'from', p_from,
    'to', p_to,
    'mode', p_mode,
    'revenue', v_revenue,
    'tax_collected', v_tax,
    'cogs', v_cogs,
    'gross_profit', v_revenue - v_cogs,
    'operating_expenses', v_opex,
    'net_profit', v_revenue - v_cogs - v_opex,
    'organizations', v_orgs
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.consolidated_profit_and_loss(UUID, DATE, DATE, TEXT) TO authenticated;

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
BEGIN
  SELECT * INTO v_group FROM consolidation_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF NOT public.user_has_org_access(v_group.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_member IN
    SELECT member_organization_id FROM consolidation_group_members WHERE group_id = p_group_id
  LOOP
    IF NOT public.user_has_org_access(v_member) THEN
      RAISE EXCEPTION 'No access to member organization';
    END IF;
    v_bs := public.balance_sheet(v_member, p_as_of);
    v_total_assets := v_total_assets + COALESCE((v_bs->>'total_assets')::NUMERIC, 0);
    v_total_liab := v_total_liab + COALESCE((v_bs->>'total_liabilities')::NUMERIC, 0);
    v_total_equity := v_total_equity + COALESCE((v_bs->>'total_equity')::NUMERIC, 0);
    v_orgs := v_orgs || jsonb_build_array(jsonb_build_object(
      'organization_id', v_member,
      'name', (SELECT name FROM organizations WHERE id = v_member),
      'total_assets', COALESCE((v_bs->>'total_assets')::NUMERIC, 0)
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'group_id', p_group_id,
    'group_name', v_group.name,
    'as_of', p_as_of,
    'total_assets', v_total_assets,
    'total_liabilities', v_total_liab,
    'total_equity', v_total_equity,
    'total_liabilities_and_equity', v_total_liab + v_total_equity,
    'organizations', v_orgs
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.consolidated_balance_sheet(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Recurring journal templates
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recurrence_frequency') THEN
    CREATE TYPE recurrence_frequency AS ENUM ('monthly', 'quarterly', 'yearly');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.recurring_journal_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  journal_code TEXT NOT NULL DEFAULT 'GEN',
  memo TEXT,
  lines JSONB NOT NULL,
  frequency recurrence_frequency NOT NULL DEFAULT 'monthly',
  next_run_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recurring_je_org ON recurring_journal_templates(organization_id, next_run_date);

ALTER TABLE recurring_journal_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY recurring_je_select ON recurring_journal_templates FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY recurring_je_write ON recurring_journal_templates FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE OR REPLACE FUNCTION public._advance_recurrence_date(p_date DATE, p_freq recurrence_frequency)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_freq
    WHEN 'monthly' THEN (p_date + INTERVAL '1 month')::date
    WHEN 'quarterly' THEN (p_date + INTERVAL '3 months')::date
    WHEN 'yearly' THEN (p_date + INTERVAL '1 year')::date
    ELSE (p_date + INTERVAL '1 month')::date
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_recurring_journal_templates(p_org_id UUID)
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
        'id', t.id,
        'name', t.name,
        'journal_code', t.journal_code,
        'memo', t.memo,
        'frequency', t.frequency,
        'next_run_date', t.next_run_date,
        'end_date', t.end_date,
        'is_active', t.is_active,
        'last_run_at', t.last_run_at,
        'lines', t.lines
      ) ORDER BY t.next_run_date
    )
    FROM recurring_journal_templates t
    WHERE t.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_recurring_journal_templates(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_recurring_journal_template(
  p_org_id UUID,
  p_template_id UUID,
  p_name TEXT,
  p_journal_code TEXT,
  p_memo TEXT,
  p_lines JSONB,
  p_frequency TEXT,
  p_next_run_date DATE,
  p_end_date DATE DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line is required';
  END IF;

  IF p_template_id IS NOT NULL THEN
    UPDATE recurring_journal_templates
    SET
      name = trim(p_name),
      journal_code = COALESCE(p_journal_code, 'GEN'),
      memo = p_memo,
      lines = p_lines,
      frequency = COALESCE(p_frequency, 'monthly')::recurrence_frequency,
      next_run_date = p_next_run_date,
      end_date = p_end_date,
      is_active = COALESCE(p_is_active, true)
    WHERE id = p_template_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Template not found'; END IF;
  ELSE
    INSERT INTO recurring_journal_templates (
      organization_id, name, journal_code, memo, lines, frequency,
      next_run_date, end_date, is_active, created_by
    ) VALUES (
      p_org_id, trim(p_name), COALESCE(p_journal_code, 'GEN'), p_memo, p_lines,
      COALESCE(p_frequency, 'monthly')::recurrence_frequency,
      p_next_run_date, p_end_date, COALESCE(p_is_active, true), auth.uid()
    ) RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_recurring_journal_template(UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, DATE, DATE, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_recurring_journals(
  p_org_id UUID,
  p_run_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run DATE := COALESCE(p_run_date, current_date);
  v_tmpl RECORD;
  v_posted INT := 0;
  v_entry_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_tmpl IN
    SELECT * FROM recurring_journal_templates
    WHERE organization_id = p_org_id
      AND is_active = true
      AND next_run_date <= v_run
      AND (end_date IS NULL OR next_run_date <= end_date)
    ORDER BY next_run_date
    FOR UPDATE
  LOOP
    v_entry_id := public._post_journal_entry_balanced(
      p_org_id, v_tmpl.journal_code, v_tmpl.next_run_date,
      COALESCE(v_tmpl.memo, v_tmpl.name), 'recurring_journal', v_tmpl.id,
      v_tmpl.lines, auth.uid()
    );

    UPDATE recurring_journal_templates
    SET
      last_run_at = now(),
      next_run_date = public._advance_recurrence_date(v_tmpl.next_run_date, v_tmpl.frequency),
      is_active = CASE
        WHEN end_date IS NOT NULL AND public._advance_recurrence_date(v_tmpl.next_run_date, v_tmpl.frequency) > end_date
        THEN false ELSE is_active END
    WHERE id = v_tmpl.id;

    v_posted := v_posted + 1;
  END LOOP;

  RETURN jsonb_build_object('posted', v_posted, 'run_date', v_run);
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_recurring_journals(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Invoice payment reminders (AR automation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_reminder_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  reminded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reminded_by UUID REFERENCES auth.users(id),
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_reminder_invoice ON invoice_reminder_logs(invoice_id, reminded_at DESC);

ALTER TABLE invoice_reminder_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY inv_reminder_select ON invoice_reminder_logs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY inv_reminder_write ON invoice_reminder_logs FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

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
        'due_date', ci.due_date,
        'total', ci.total,
        'days_overdue', current_date - ci.due_date,
        'last_reminded_at', (
          SELECT MAX(reminded_at) FROM invoice_reminder_logs irl WHERE irl.invoice_id = ci.id
        )
      ) ORDER BY ci.due_date
    )
    FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = p_org_id
      AND ci.status = 'posted'
      AND ci.due_date IS NOT NULL
      AND ci.due_date < current_date
      AND NOT EXISTS (
        SELECT 1 FROM invoice_reminder_logs irl
        WHERE irl.invoice_id = ci.id
          AND irl.reminded_at > now() - INTERVAL '7 days'
      )
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_invoices_needing_reminder(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_invoice_reminder(
  p_invoice_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO invoice_reminder_logs (organization_id, invoice_id, reminded_by, note)
  VALUES (v_inv.organization_id, p_invoice_id, auth.uid(), p_note)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_invoice_reminder(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Financial report library (saved BI snapshots)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_report_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_report_snapshots_org ON financial_report_snapshots(organization_id, created_at DESC);

ALTER TABLE financial_report_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY fin_snapshots_select ON financial_report_snapshots FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY fin_snapshots_write ON financial_report_snapshots FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE OR REPLACE FUNCTION public.list_financial_report_snapshots(p_org_id UUID)
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
        'id', s.id,
        'name', s.name,
        'report_type', s.report_type,
        'params', s.params,
        'created_at', s.created_at
      ) ORDER BY s.created_at DESC
    )
    FROM financial_report_snapshots s
    WHERE s.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_financial_report_snapshots(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_financial_report_snapshot(
  p_org_id UUID,
  p_name TEXT,
  p_report_type TEXT,
  p_params JSONB,
  p_result JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO financial_report_snapshots (organization_id, name, report_type, params, result, created_by)
  VALUES (p_org_id, trim(p_name), p_report_type, COALESCE(p_params, '{}'::jsonb), COALESCE(p_result, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_financial_report_snapshot(UUID, TEXT, TEXT, JSONB, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_financial_report_snapshot(p_snapshot_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap financial_report_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO v_snap FROM financial_report_snapshots WHERE id = p_snapshot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot not found'; END IF;
  IF NOT public.user_has_org_access(v_snap.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'id', v_snap.id,
    'name', v_snap.name,
    'report_type', v_snap.report_type,
    'params', v_snap.params,
    'result', v_snap.result,
    'created_at', v_snap.created_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_financial_report_snapshot(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_financial_report_snapshot(p_snapshot_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap financial_report_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO v_snap FROM financial_report_snapshots WHERE id = p_snapshot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot not found'; END IF;
  IF NOT public.user_can_manage(v_snap.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  DELETE FROM financial_report_snapshots WHERE id = p_snapshot_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_financial_report_snapshot(UUID) TO authenticated;

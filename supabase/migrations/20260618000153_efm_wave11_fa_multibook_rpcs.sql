-- EFM Wave 11 — Fixed assets multi-book RPCs (requires 00152 schema)

-- ---------------------------------------------------------------------------
-- Book helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_fa_books(p_org_id UUID)
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

  INSERT INTO fa_depr_books (organization_id, code, name, book_type, is_primary, posts_to_gl, depr_method)
  VALUES
    (p_org_id, 'FIN', 'Financial (GAAP)', 'financial', true, true, 'straight_line'),
    (p_org_id, 'TAX', 'Tax', 'tax', false, false, 'straight_line')
  ON CONFLICT (organization_id, code) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_fa_books(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_fa_books(p_org_id UUID)
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
        'id', b.id,
        'code', b.code,
        'name', b.name,
        'book_type', b.book_type,
        'is_primary', b.is_primary,
        'posts_to_gl', b.posts_to_gl,
        'depr_method', b.depr_method,
        'is_active', b.is_active,
        'asset_count', COALESCE((
          SELECT COUNT(*)::INT FROM fixed_asset_book_profiles p WHERE p.book_id = b.id
        ), 0)
      ) ORDER BY b.is_primary DESC, b.code
    )
    FROM fa_depr_books b
    WHERE b.organization_id = p_org_id AND b.is_active
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_fa_books(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_fa_book(
  p_org_id UUID,
  p_book_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_book_type TEXT DEFAULT 'management',
  p_posts_to_gl BOOLEAN DEFAULT false,
  p_depr_method TEXT DEFAULT 'straight_line',
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
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_book_type NOT IN ('financial', 'tax', 'ifrs', 'management') THEN
    RAISE EXCEPTION 'Invalid book type';
  END IF;
  IF p_depr_method NOT IN ('straight_line', 'double_declining') THEN
    RAISE EXCEPTION 'Invalid depreciation method';
  END IF;

  IF p_book_id IS NOT NULL THEN
    UPDATE fa_depr_books
    SET
      code = trim(p_code),
      name = trim(p_name),
      book_type = COALESCE(p_book_type, book_type),
      posts_to_gl = COALESCE(p_posts_to_gl, posts_to_gl),
      depr_method = COALESCE(p_depr_method, depr_method),
      is_active = COALESCE(p_is_active, true)
    WHERE id = p_book_id AND organization_id = p_org_id AND NOT is_primary
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Book not found or cannot edit primary book'; END IF;
  ELSE
    INSERT INTO fa_depr_books (
      organization_id, code, name, book_type, is_primary, posts_to_gl, depr_method, is_active
    ) VALUES (
      p_org_id, trim(p_code), trim(p_name), COALESCE(p_book_type, 'management'),
      false, COALESCE(p_posts_to_gl, false), COALESCE(p_depr_method, 'straight_line'), COALESCE(p_is_active, true)
    ) RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_fa_book(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public._fixed_asset_book_accum_depr(
  p_asset_id UUID,
  p_book_id UUID
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM fixed_asset_depreciation
  WHERE asset_id = p_asset_id AND book_id = p_book_id;
$$;

CREATE OR REPLACE FUNCTION public._fixed_asset_book_monthly_depr(
  p_cost NUMERIC,
  p_salvage NUMERIC,
  p_months INT,
  p_method TEXT,
  p_accum NUMERIC DEFAULT 0
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_book_value NUMERIC;
  v_remaining NUMERIC;
BEGIN
  v_remaining := GREATEST(p_cost - p_salvage - COALESCE(p_accum, 0), 0);
  IF v_remaining <= 0 THEN RETURN 0; END IF;

  IF COALESCE(p_method, 'straight_line') = 'double_declining' THEN
    v_book_value := p_cost - COALESCE(p_accum, 0);
    RETURN round(LEAST(v_book_value * 2.0 / GREATEST(p_months, 1), v_remaining), 2);
  END IF;

  RETURN round(GREATEST(p_cost - p_salvage, 0) / GREATEST(p_months, 1), 2);
END;
$$;

-- Primary-book accum for backward compatibility
CREATE OR REPLACE FUNCTION public._fixed_asset_accum_depr(p_asset_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_book_id UUID;
BEGIN
  SELECT b.id INTO v_book_id
  FROM fixed_assets fa
  JOIN fa_depr_books b ON b.organization_id = fa.organization_id AND b.is_primary
  WHERE fa.id = p_asset_id
  LIMIT 1;

  IF v_book_id IS NULL THEN
    RETURN COALESCE((
      SELECT SUM(amount) FROM fixed_asset_depreciation WHERE asset_id = p_asset_id
    ), 0);
  END IF;

  RETURN public._fixed_asset_book_accum_depr(p_asset_id, v_book_id);
END;
$$;

CREATE OR REPLACE FUNCTION public._ensure_asset_book_profiles(p_asset_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset fixed_assets%ROWTYPE;
  v_book RECORD;
BEGIN
  SELECT * INTO v_asset FROM fixed_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RETURN; END IF;

  FOR v_book IN
    SELECT * FROM fa_depr_books WHERE organization_id = v_asset.organization_id AND is_active
  LOOP
    INSERT INTO fixed_asset_book_profiles (
      organization_id, asset_id, book_id, acquisition_cost, salvage_value,
      useful_life_months, depr_method, status
    ) VALUES (
      v_asset.organization_id,
      v_asset.id,
      v_book.id,
      v_asset.acquisition_cost,
      v_asset.salvage_value,
      CASE WHEN v_book.code = 'TAX' THEN GREATEST(ceil(v_asset.useful_life_months * 0.6)::INT, 12)
           ELSE v_asset.useful_life_months END,
      v_book.depr_method,
      v_asset.status
    )
    ON CONFLICT (asset_id, book_id) DO UPDATE SET
      status = EXCLUDED.status
    WHERE fixed_asset_book_profiles.status <> 'disposed'::fixed_asset_status;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_asset_book_profile(
  p_asset_id UUID,
  p_book_id UUID,
  p_useful_life_months INT DEFAULT NULL,
  p_salvage_value NUMERIC DEFAULT NULL,
  p_depr_method TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset fixed_assets%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO v_asset FROM fixed_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF NOT public.user_can_manage(v_asset.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE fixed_asset_book_profiles
  SET
    useful_life_months = COALESCE(p_useful_life_months, useful_life_months),
    salvage_value = COALESCE(p_salvage_value, salvage_value),
    depr_method = COALESCE(p_depr_method, depr_method)
  WHERE asset_id = p_asset_id AND book_id = p_book_id
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RAISE EXCEPTION 'Book profile not found'; END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_asset_book_profile(UUID, UUID, INT, NUMERIC, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Extended list_fixed_assets with multi-book summary
-- ---------------------------------------------------------------------------
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
        'disposed_at', fa.disposed_at,
        'books', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'book_id', b.id,
              'book_code', b.code,
              'book_name', b.name,
              'is_primary', b.is_primary,
              'posts_to_gl', b.posts_to_gl,
              'useful_life_months', p.useful_life_months,
              'depr_method', p.depr_method,
              'accumulated_depreciation', public._fixed_asset_book_accum_depr(fa.id, b.id),
              'book_value', p.acquisition_cost - public._fixed_asset_book_accum_depr(fa.id, b.id),
              'status', p.status
            ) ORDER BY b.is_primary DESC, b.code
          )
          FROM fixed_asset_book_profiles p
          JOIN fa_depr_books b ON b.id = p.book_id
          WHERE p.asset_id = fa.id
        ), '[]'::jsonb)
      ) ORDER BY fa.acquisition_date DESC, fa.asset_no
    )
    FROM fixed_assets fa
    WHERE fa.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_fixed_assets(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Register asset — create book profiles
-- ---------------------------------------------------------------------------
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
  PERFORM public.ensure_default_fa_books(p_org_id);

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

  PERFORM public._ensure_asset_book_profiles(v_id);

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

-- ---------------------------------------------------------------------------
-- Multi-book depreciation batch (extends 2-arg signature with optional book)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.run_depreciation_batch(UUID, DATE);

CREATE OR REPLACE FUNCTION public.run_depreciation_batch(
  p_org_id UUID,
  p_through_date DATE DEFAULT NULL,
  p_book_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_through DATE := COALESCE(p_through_date, current_date);
  v_profile RECORD;
  v_book fa_depr_books%ROWTYPE;
  v_period DATE;
  v_monthly NUMERIC;
  v_accum NUMERIC;
  v_remaining NUMERIC;
  v_amount NUMERIC;
  v_entry_id UUID;
  v_posted INT := 0;
  v_posted_gl INT := 0;
  v_depr_acct UUID;
  v_accum_acct UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_accounts(p_org_id);
  PERFORM public.ensure_default_fa_books(p_org_id);
  v_depr_acct := public.account_id_by_code(p_org_id, '6510');
  v_accum_acct := public.account_id_by_code(p_org_id, '1590');

  FOR v_profile IN
    SELECT p.*, fa.asset_no, fa.name AS asset_name, fa.acquisition_date
    FROM fixed_asset_book_profiles p
    JOIN fixed_assets fa ON fa.id = p.asset_id
    WHERE p.organization_id = p_org_id
      AND p.status = 'active'
      AND (p_book_id IS NULL OR p.book_id = p_book_id)
    ORDER BY fa.acquisition_date, p.book_id
  LOOP
    SELECT * INTO v_book FROM fa_depr_books WHERE id = v_profile.book_id;

    v_period := date_trunc('month', v_profile.acquisition_date)::date;

    WHILE v_period <= date_trunc('month', v_through)::date LOOP
      IF v_period >= date_trunc('month', v_profile.acquisition_date)::date
         AND NOT EXISTS (
           SELECT 1 FROM fixed_asset_depreciation
           WHERE asset_id = v_profile.asset_id
             AND book_id = v_profile.book_id
             AND period_date = v_period
         )
      THEN
        v_accum := public._fixed_asset_book_accum_depr(v_profile.asset_id, v_profile.book_id);
        v_remaining := v_profile.acquisition_cost - v_profile.salvage_value - v_accum;
        IF v_remaining <= 0.01 THEN
          UPDATE fixed_asset_book_profiles
          SET status = 'fully_depreciated'
          WHERE asset_id = v_profile.asset_id AND book_id = v_profile.book_id;
          EXIT;
        END IF;

        v_monthly := public._fixed_asset_book_monthly_depr(
          v_profile.acquisition_cost,
          v_profile.salvage_value,
          v_profile.useful_life_months,
          v_profile.depr_method,
          v_accum
        );
        v_amount := LEAST(v_monthly, v_remaining);

        v_entry_id := NULL;
        IF v_book.posts_to_gl THEN
          v_entry_id := public._post_journal_entry_balanced(
            p_org_id, 'DEP', (v_period + INTERVAL '1 month' - INTERVAL '1 day')::date,
            'Depreciation ' || v_profile.asset_no || ' [' || v_book.code || '] ' || to_char(v_period, 'Mon YYYY'),
            'depreciation', v_profile.asset_id,
            jsonb_build_array(
              jsonb_build_object('accountId', v_depr_acct, 'debit', v_amount, 'credit', 0, 'description', v_profile.asset_name),
              jsonb_build_object('accountId', v_accum_acct, 'debit', 0, 'credit', v_amount, 'description', 'Accum depr')
            ),
            auth.uid()
          );
          v_posted_gl := v_posted_gl + 1;
        END IF;

        INSERT INTO fixed_asset_depreciation (organization_id, asset_id, book_id, period_date, amount, journal_entry_id)
        VALUES (p_org_id, v_profile.asset_id, v_profile.book_id, v_period, v_amount, v_entry_id);

        v_posted := v_posted + 1;

        IF public._fixed_asset_book_accum_depr(v_profile.asset_id, v_profile.book_id)
           >= v_profile.acquisition_cost - v_profile.salvage_value - 0.01 THEN
          UPDATE fixed_asset_book_profiles
          SET status = 'fully_depreciated'
          WHERE asset_id = v_profile.asset_id AND book_id = v_profile.book_id;
          EXIT;
        END IF;
      END IF;

      v_period := (v_period + INTERVAL '1 month')::date;
    END LOOP;

    IF v_book.is_primary THEN
      IF EXISTS (
        SELECT 1 FROM fixed_asset_book_profiles
        WHERE asset_id = v_profile.asset_id AND book_id = v_profile.book_id
          AND status = 'fully_depreciated'
      ) THEN
        UPDATE fixed_assets SET status = 'fully_depreciated'
        WHERE id = v_profile.asset_id AND status = 'active';
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'posted', v_posted,
    'posted_gl', v_posted_gl,
    'through_date', v_through,
    'book_id', p_book_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_depreciation_batch(UUID, DATE, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Book comparison report
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fa_book_comparison(p_org_id UUID)
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
        'book_id', b.id,
        'book_code', b.code,
        'book_name', b.name,
        'book_type', b.book_type,
        'is_primary', b.is_primary,
        'posts_to_gl', b.posts_to_gl,
        'asset_count', COALESCE(stats.asset_count, 0),
        'total_cost', COALESCE(stats.total_cost, 0),
        'total_accum_depr', COALESCE(stats.total_accum, 0),
        'total_nbv', COALESCE(stats.total_cost, 0) - COALESCE(stats.total_accum, 0)
      ) ORDER BY b.is_primary DESC, b.code
    )
    FROM fa_depr_books b
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::INT AS asset_count,
        SUM(p.acquisition_cost) AS total_cost,
        SUM(public._fixed_asset_book_accum_depr(p.asset_id, p.book_id)) AS total_accum
      FROM fixed_asset_book_profiles p
      WHERE p.book_id = b.id AND p.status IN ('active', 'fully_depreciated')
    ) stats ON true
    WHERE b.organization_id = p_org_id AND b.is_active
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_fa_book_comparison(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_fixed_asset_book_detail(p_asset_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset fixed_assets%ROWTYPE;
BEGIN
  SELECT * INTO v_asset FROM fixed_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF NOT public.user_has_org_access(v_asset.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  PERFORM public._ensure_asset_book_profiles(p_asset_id);

  RETURN jsonb_build_object(
    'asset_id', v_asset.id,
    'asset_no', v_asset.asset_no,
    'name', v_asset.name,
    'books', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'book_id', b.id,
          'book_code', b.code,
          'book_name', b.name,
          'is_primary', b.is_primary,
          'posts_to_gl', b.posts_to_gl,
          'useful_life_months', p.useful_life_months,
          'salvage_value', p.salvage_value,
          'depr_method', p.depr_method,
          'accumulated_depreciation', public._fixed_asset_book_accum_depr(v_asset.id, b.id),
          'book_value', p.acquisition_cost - public._fixed_asset_book_accum_depr(v_asset.id, b.id),
          'status', p.status,
          'depreciation_history', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'period_date', d.period_date,
                'amount', d.amount,
                'posted_to_gl', d.journal_entry_id IS NOT NULL
              ) ORDER BY d.period_date DESC
            )
            FROM fixed_asset_depreciation d
            WHERE d.asset_id = v_asset.id AND d.book_id = b.id
          ), '[]'::jsonb)
        ) ORDER BY b.is_primary DESC, b.code
      )
      FROM fixed_asset_book_profiles p
      JOIN fa_depr_books b ON b.id = p.book_id
      WHERE p.asset_id = v_asset.id
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_fixed_asset_book_detail(UUID) TO authenticated;

-- Patch dispose to mark all book profiles disposed
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

  UPDATE fixed_asset_book_profiles
  SET status = 'disposed'
  WHERE asset_id = p_asset_id;

  RETURN v_entry_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset(UUID, DATE, NUMERIC, payment_method) TO authenticated;

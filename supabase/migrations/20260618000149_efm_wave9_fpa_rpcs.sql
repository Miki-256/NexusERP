-- EFM Wave 9 — FP&A RPCs (requires 00148 schema)

-- ---------------------------------------------------------------------------
-- Monthly P&L helper (GL mode)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fpa_monthly_pnl(
  p_org_id UUID,
  p_month_start DATE,
  p_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from DATE := date_trunc('month', p_month_start)::date;
  v_to DATE := COALESCE(p_to, (date_trunc('month', p_month_start) + interval '1 month - 1 day')::date);
  v_pnl JSONB;
BEGIN
  v_pnl := public.profit_and_loss(p_org_id, v_from, v_to, 'gl');
  RETURN jsonb_build_object(
    'revenue', COALESCE((v_pnl->>'revenue')::NUMERIC, 0),
    'cogs', COALESCE((v_pnl->>'cogs')::NUMERIC, 0),
    'operating_expenses', COALESCE((v_pnl->>'operating_expenses')::NUMERIC, 0),
    'net_profit', COALESCE((v_pnl->>'net_profit')::NUMERIC, 0)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Default scenarios
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_fpa_scenarios(p_org_id UUID)
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

  INSERT INTO fpa_scenarios (
    organization_id, name, scenario_type, is_baseline,
    revenue_adjustment_pct, expense_adjustment_pct, description
  ) VALUES
    (p_org_id, 'Baseline', 'baseline', true, 0, 0, 'Trailing run-rate with no adjustments'),
    (p_org_id, 'Optimistic', 'optimistic', false, 15, -5, '15% revenue uplift, 5% expense reduction'),
    (p_org_id, 'Pessimistic', 'pessimistic', false, -10, 10, '10% revenue decline, 10% expense increase')
  ON CONFLICT (organization_id, name) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_fpa_scenarios(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_fpa_scenarios(p_org_id UUID)
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
        'scenario_type', s.scenario_type,
        'is_baseline', s.is_baseline,
        'revenue_adjustment_pct', s.revenue_adjustment_pct,
        'expense_adjustment_pct', s.expense_adjustment_pct,
        'description', s.description,
        'is_active', s.is_active
      ) ORDER BY s.is_baseline DESC, s.name
    )
    FROM fpa_scenarios s
    WHERE s.organization_id = p_org_id AND s.is_active
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_fpa_scenarios(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_fpa_scenario(
  p_org_id UUID,
  p_scenario_id UUID,
  p_name TEXT,
  p_scenario_type TEXT DEFAULT 'custom',
  p_revenue_adjustment_pct NUMERIC DEFAULT 0,
  p_expense_adjustment_pct NUMERIC DEFAULT 0,
  p_description TEXT DEFAULT NULL,
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
  IF p_scenario_type NOT IN ('baseline', 'optimistic', 'pessimistic', 'custom') THEN
    RAISE EXCEPTION 'Invalid scenario type';
  END IF;

  IF p_scenario_id IS NOT NULL THEN
    UPDATE fpa_scenarios
    SET
      name = trim(p_name),
      scenario_type = COALESCE(p_scenario_type, scenario_type),
      revenue_adjustment_pct = COALESCE(p_revenue_adjustment_pct, revenue_adjustment_pct),
      expense_adjustment_pct = COALESCE(p_expense_adjustment_pct, expense_adjustment_pct),
      description = NULLIF(trim(p_description), ''),
      is_active = COALESCE(p_is_active, true)
    WHERE id = p_scenario_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Scenario not found'; END IF;
  ELSE
    INSERT INTO fpa_scenarios (
      organization_id, name, scenario_type, revenue_adjustment_pct,
      expense_adjustment_pct, description, is_active, created_by
    ) VALUES (
      p_org_id, trim(p_name), COALESCE(p_scenario_type, 'custom'),
      COALESCE(p_revenue_adjustment_pct, 0), COALESCE(p_expense_adjustment_pct, 0),
      NULLIF(trim(p_description), ''), COALESCE(p_is_active, true), auth.uid()
    ) RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_fpa_scenario(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- Trailing run-rate for forecast months
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fpa_trailing_run_rate(
  p_org_id UUID,
  p_as_of DATE,
  p_months INT DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i INT;
  v_month_start DATE;
  v_month_end DATE;
  v_pnl JSONB;
  v_rev NUMERIC := 0;
  v_cogs NUMERIC := 0;
  v_opex NUMERIC := 0;
  v_count INT := 0;
BEGIN
  FOR v_i IN 1..GREATEST(COALESCE(p_months, 3), 1) LOOP
    v_month_start := (date_trunc('month', p_as_of) - (v_i || ' months')::interval)::date;
    v_month_end := (date_trunc('month', v_month_start) + interval '1 month - 1 day')::date;
    IF v_month_end >= date_trunc('month', p_as_of)::date THEN
      CONTINUE;
    END IF;
    v_pnl := public._fpa_monthly_pnl(p_org_id, v_month_start);
    v_rev := v_rev + COALESCE((v_pnl->>'revenue')::NUMERIC, 0);
    v_cogs := v_cogs + COALESCE((v_pnl->>'cogs')::NUMERIC, 0);
    v_opex := v_opex + COALESCE((v_pnl->>'operating_expenses')::NUMERIC, 0);
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    v_pnl := public._fpa_monthly_pnl(p_org_id, date_trunc('month', p_as_of)::date, p_as_of);
    RETURN jsonb_build_object(
      'revenue', COALESCE((v_pnl->>'revenue')::NUMERIC, 0),
      'cogs', COALESCE((v_pnl->>'cogs')::NUMERIC, 0),
      'operating_expenses', COALESCE((v_pnl->>'operating_expenses')::NUMERIC, 0),
      'months_averaged', 1
    );
  END IF;

  RETURN jsonb_build_object(
    'revenue', round(v_rev / v_count, 2),
    'cogs', round(v_cogs / v_count, 2),
    'operating_expenses', round(v_opex / v_count, 2),
    'months_averaged', v_count
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Generate rolling forecast
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_rolling_forecast(
  p_org_id UUID,
  p_scenario_id UUID,
  p_horizon_months INT DEFAULT 12,
  p_as_of DATE DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_budget_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scenario fpa_scenarios%ROWTYPE;
  v_as_of DATE := COALESCE(p_as_of, current_date);
  v_horizon INT := GREATEST(LEAST(COALESCE(p_horizon_months, 12), 36), 1);
  v_forecast_id UUID;
  v_i INT;
  v_month_start DATE;
  v_month_end DATE;
  v_run_rate JSONB;
  v_rev NUMERIC;
  v_cogs NUMERIC;
  v_opex NUMERIC;
  v_net NUMERIC;
  v_pnl JSONB;
  v_is_actual BOOLEAN;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_scenario FROM fpa_scenarios WHERE id = p_scenario_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scenario not found'; END IF;

  UPDATE fpa_rolling_forecasts
  SET status = 'superseded'
  WHERE organization_id = p_org_id
    AND scenario_id = p_scenario_id
    AND status = 'active';

  INSERT INTO fpa_rolling_forecasts (
    organization_id, scenario_id, name, as_of_date, horizon_months, status, budget_id, created_by
  ) VALUES (
    p_org_id,
    p_scenario_id,
    COALESCE(NULLIF(trim(p_name), ''), v_scenario.name || ' — ' || to_char(v_as_of, 'Mon YYYY')),
    v_as_of,
    v_horizon,
    'active',
    p_budget_id,
    auth.uid()
  ) RETURNING id INTO v_forecast_id;

  v_run_rate := public._fpa_trailing_run_rate(p_org_id, v_as_of, 3);

  FOR v_i IN 0..(v_horizon - 1) LOOP
    v_month_start := (date_trunc('month', v_as_of) + (v_i || ' months')::interval)::date;
    v_month_end := (date_trunc('month', v_month_start) + interval '1 month - 1 day')::date;
    v_is_actual := false;
    v_rev := 0;
    v_cogs := 0;
    v_opex := 0;

    IF v_month_end < date_trunc('month', v_as_of)::date THEN
      v_pnl := public._fpa_monthly_pnl(p_org_id, v_month_start);
      v_rev := COALESCE((v_pnl->>'revenue')::NUMERIC, 0);
      v_cogs := COALESCE((v_pnl->>'cogs')::NUMERIC, 0);
      v_opex := COALESCE((v_pnl->>'operating_expenses')::NUMERIC, 0);
      v_is_actual := true;
    ELSIF v_month_start <= v_as_of AND v_month_end >= v_as_of THEN
      v_pnl := public._fpa_monthly_pnl(p_org_id, v_month_start, v_as_of);
      v_rev := COALESCE((v_pnl->>'revenue')::NUMERIC, 0);
      v_cogs := COALESCE((v_pnl->>'cogs')::NUMERIC, 0);
      v_opex := COALESCE((v_pnl->>'operating_expenses')::NUMERIC, 0);
      v_is_actual := true;
    ELSE
      v_rev := round(
        COALESCE((v_run_rate->>'revenue')::NUMERIC, 0) * (1 + v_scenario.revenue_adjustment_pct / 100),
        2
      );
      v_cogs := round(
        COALESCE((v_run_rate->>'cogs')::NUMERIC, 0) * (1 + v_scenario.expense_adjustment_pct / 100),
        2
      );
      v_opex := round(
        COALESCE((v_run_rate->>'operating_expenses')::NUMERIC, 0) * (1 + v_scenario.expense_adjustment_pct / 100),
        2
      );
    END IF;

    v_net := round(v_rev - v_cogs - v_opex, 2);

    INSERT INTO fpa_forecast_periods (
      forecast_id, organization_id, period_month, is_actual,
      revenue, cogs, operating_expenses, net_profit
    ) VALUES (
      v_forecast_id, p_org_id, v_month_start, v_is_actual,
      v_rev, v_cogs, v_opex, v_net
    );
  END LOOP;

  RETURN v_forecast_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_rolling_forecast(UUID, UUID, INT, DATE, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_rolling_forecast(p_forecast_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fc fpa_rolling_forecasts%ROWTYPE;
  v_scenario fpa_scenarios%ROWTYPE;
BEGIN
  SELECT * INTO v_fc FROM fpa_rolling_forecasts WHERE id = p_forecast_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forecast not found'; END IF;
  IF NOT public.user_has_org_access(v_fc.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT * INTO v_scenario FROM fpa_scenarios WHERE id = v_fc.scenario_id;

  RETURN jsonb_build_object(
    'id', v_fc.id,
    'name', v_fc.name,
    'as_of', v_fc.as_of_date,
    'horizon_months', v_fc.horizon_months,
    'status', v_fc.status,
    'scenario', jsonb_build_object(
      'id', v_scenario.id,
      'name', v_scenario.name,
      'scenario_type', v_scenario.scenario_type,
      'revenue_adjustment_pct', v_scenario.revenue_adjustment_pct,
      'expense_adjustment_pct', v_scenario.expense_adjustment_pct
    ),
    'periods', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'period_month', fp.period_month,
          'is_actual', fp.is_actual,
          'revenue', fp.revenue,
          'cogs', fp.cogs,
          'operating_expenses', fp.operating_expenses,
          'net_profit', fp.net_profit
        ) ORDER BY fp.period_month
      )
      FROM fpa_forecast_periods fp
      WHERE fp.forecast_id = v_fc.id
    ), '[]'::jsonb),
    'total_revenue', COALESCE((
      SELECT SUM(fp.revenue) FROM fpa_forecast_periods fp WHERE fp.forecast_id = v_fc.id
    ), 0),
    'total_net_profit', COALESCE((
      SELECT SUM(fp.net_profit) FROM fpa_forecast_periods fp WHERE fp.forecast_id = v_fc.id
    ), 0),
    'forecast_revenue', COALESCE((
      SELECT SUM(fp.revenue) FROM fpa_forecast_periods fp
      WHERE fp.forecast_id = v_fc.id AND NOT fp.is_actual
    ), 0),
    'forecast_net_profit', COALESCE((
      SELECT SUM(fp.net_profit) FROM fpa_forecast_periods fp
      WHERE fp.forecast_id = v_fc.id AND NOT fp.is_actual
    ), 0)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_rolling_forecast(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_rolling_forecasts(
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
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', rf.id,
        'name', rf.name,
        'as_of', rf.as_of_date,
        'horizon_months', rf.horizon_months,
        'status', rf.status,
        'scenario_id', rf.scenario_id,
        'scenario_name', s.name,
        'scenario_type', s.scenario_type,
        'total_net_profit', COALESCE((
          SELECT SUM(fp.net_profit) FROM fpa_forecast_periods fp WHERE fp.forecast_id = rf.id
        ), 0),
        'created_at', rf.created_at
      ) ORDER BY rf.created_at DESC
    )
    FROM (
      SELECT * FROM fpa_rolling_forecasts
      WHERE organization_id = p_org_id
      ORDER BY created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 20), 1)
    ) rf
    JOIN fpa_scenarios s ON s.id = rf.scenario_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_rolling_forecasts(UUID, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Scenario comparison (uses latest active forecast per scenario)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compare_fpa_scenarios(
  p_org_id UUID,
  p_scenario_ids JSONB DEFAULT NULL,
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
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'scenario_id', s.id,
        'scenario_name', s.name,
        'scenario_type', s.scenario_type,
        'revenue_adjustment_pct', s.revenue_adjustment_pct,
        'expense_adjustment_pct', s.expense_adjustment_pct,
        'forecast_id', rf.id,
        'forecast_name', rf.name,
        'horizon_months', rf.horizon_months,
        'total_revenue', COALESCE((
          SELECT SUM(fp.revenue) FROM fpa_forecast_periods fp WHERE fp.forecast_id = rf.id
        ), 0),
        'total_net_profit', COALESCE((
          SELECT SUM(fp.net_profit) FROM fpa_forecast_periods fp WHERE fp.forecast_id = rf.id
        ), 0),
        'forecast_net_profit', COALESCE((
          SELECT SUM(fp.net_profit) FROM fpa_forecast_periods fp
          WHERE fp.forecast_id = rf.id AND NOT fp.is_actual
        ), 0)
      ) ORDER BY s.is_baseline DESC, s.name
    )
    FROM fpa_scenarios s
    LEFT JOIN LATERAL (
      SELECT rf.*
      FROM fpa_rolling_forecasts rf
      WHERE rf.scenario_id = s.id
        AND rf.organization_id = p_org_id
        AND rf.status = 'active'
        AND rf.as_of_date <= v_as_of
      ORDER BY rf.as_of_date DESC, rf.created_at DESC
      LIMIT 1
    ) rf ON true
    WHERE s.organization_id = p_org_id
      AND s.is_active
      AND (
        p_scenario_ids IS NULL
        OR jsonb_array_length(COALESCE(p_scenario_ids, '[]'::jsonb)) = 0
        OR s.id::text IN (SELECT jsonb_array_elements_text(p_scenario_ids))
      )
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.compare_fpa_scenarios(UUID, JSONB, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- FP&A dashboard summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fpa_dashboard(
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
  v_ytd_from DATE := date_trunc('year', v_as_of)::date;
  v_ytd_pnl JSONB;
  v_run_rate JSONB;
  v_baseline_id UUID;
  v_latest_forecast JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_ytd_pnl := public.profit_and_loss(p_org_id, v_ytd_from, v_as_of, 'gl');
  v_run_rate := public._fpa_trailing_run_rate(p_org_id, v_as_of, 3);

  SELECT id INTO v_baseline_id
  FROM fpa_scenarios
  WHERE organization_id = p_org_id AND is_baseline AND is_active
  LIMIT 1;

  IF v_baseline_id IS NOT NULL THEN
    SELECT public.get_rolling_forecast(rf.id) INTO v_latest_forecast
    FROM fpa_rolling_forecasts rf
    WHERE rf.organization_id = p_org_id
      AND rf.scenario_id = v_baseline_id
      AND rf.status = 'active'
    ORDER BY rf.created_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'ytd', jsonb_build_object(
      'from', v_ytd_from,
      'to', v_as_of,
      'revenue', COALESCE((v_ytd_pnl->>'revenue')::NUMERIC, 0),
      'net_profit', COALESCE((v_ytd_pnl->>'net_profit')::NUMERIC, 0),
      'operating_expenses', COALESCE((v_ytd_pnl->>'operating_expenses')::NUMERIC, 0)
    ),
    'trailing_run_rate', v_run_rate,
    'baseline_forecast', v_latest_forecast,
    'scenario_count', (
      SELECT COUNT(*)::INT FROM fpa_scenarios WHERE organization_id = p_org_id AND is_active
    ),
    'active_forecast_count', (
      SELECT COUNT(*)::INT FROM fpa_rolling_forecasts
      WHERE organization_id = p_org_id AND status = 'active'
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_fpa_dashboard(UUID, DATE) TO authenticated;

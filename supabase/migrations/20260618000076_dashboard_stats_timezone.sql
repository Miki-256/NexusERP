-- Fix dashboard "today" KPIs using UTC midnight instead of organization timezone.
-- Accounting/reports already use org timezone; dashboard_stats did not.

CREATE OR REPLACE FUNCTION public.dashboard_stats(p_organization_id UUID, p_store_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_tz TEXT;
  v_today DATE;
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM organizations WHERE id = p_organization_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT jsonb_build_object(
    'sales_total', COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed'), 0),
    'transaction_count', COUNT(*) FILTER (WHERE s.status = 'completed'),
    'cash_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'cash'
        AND (s2.created_at AT TIME ZONE v_tz)::date = v_today
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'mobile_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'mobile_money'
        AND (s2.created_at AT TIME ZONE v_tz)::date = v_today
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'bank_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'bank_transfer'
        AND (s2.created_at AT TIME ZONE v_tz)::date = v_today
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0)
  ) INTO v_result
  FROM sales s
  WHERE s.organization_id = p_organization_id
    AND (s.created_at AT TIME ZONE v_tz)::date = v_today
    AND (p_store_id IS NULL OR s.store_id = p_store_id);

  RETURN v_result;
END;
$$;

-- Prefer live sales for today in the 14-day chart (stale rollup rows must not mask today's total).
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

  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM organizations WHERE id = p_org_id;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_mtd_from := date_trunc('month', v_today::timestamp)::date;
  v_mtd_to := v_today;
  v_prev_from := (date_trunc('month', v_today::timestamp) - interval '1 month')::date;
  v_prev_to := (date_trunc('month', v_today::timestamp) - interval '1 day')::date;
  v_trend_start := v_today - 13;

  v_today_stats := public.dashboard_stats(p_org_id, NULL);

  IF COALESCE(p_include_accounting, true) THEN
    v_mtd_pnl := public.profit_and_loss(p_org_id, v_mtd_from, v_mtd_to);
    v_prev_pnl := public.profit_and_loss(p_org_id, v_prev_from, v_prev_to);
    v_mtd_cf := public.cash_flow(p_org_id, v_mtd_from, v_mtd_to);

    SELECT COALESCE(SUM(total), 0) INTO v_ar_total
    FROM customer_invoices
    WHERE organization_id = p_org_id
      AND status IN ('posted', 'draft');

    SELECT COALESCE(SUM(total), 0) INTO v_ap_total
    FROM vendor_bills
    WHERE organization_id = p_org_id
      AND status = 'open';
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

GRANT EXECUTE ON FUNCTION public.dashboard_stats(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_bundle(UUID, BOOLEAN, BOOLEAN) TO authenticated;

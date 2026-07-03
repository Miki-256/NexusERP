-- Week 2: Query & app efficiency — rollup-based financials charts, product pagination, dashboard bundle.

-- ---------------------------------------------------------------------------
-- SUP-001: Financials chart data from daily rollups (not full sales/payments scan)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.financials_chart_data(
  p_org_id UUID,
  p_from DATE,
  p_to DATE
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
  v_daily_revenue JSONB := '[]'::jsonb;
  v_daily_expenses JSONB := '[]'::jsonb;
  v_payment_mix JSONB := '[]'::jsonb;
  v_expense_categories JSONB := '[]'::jsonb;
  v_cash NUMERIC := 0;
  v_mobile NUMERIC := 0;
  v_bank NUMERIC := 0;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM organizations WHERE id = p_org_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- Historical daily revenue from rollups
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', s.summary_date::text,
      'value', s.sales_total
    ) ORDER BY s.summary_date
  ), '[]'::jsonb)
  INTO v_daily_revenue
  FROM org_daily_sales_summary s
  WHERE s.organization_id = p_org_id
    AND s.store_id = '00000000-0000-0000-0000-000000000000'::uuid
    AND s.summary_date BETWEEN p_from AND p_to
    AND s.summary_date < v_today;

  -- Today live revenue when in range
  IF p_to >= v_today AND p_from <= v_today THEN
    SELECT v_daily_revenue || jsonb_build_array(jsonb_build_object(
      'date', v_today::text,
      'value', COALESCE(SUM(s.total), 0)
    ))
    INTO v_daily_revenue
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_tz)::date = v_today;
  END IF;

  -- Daily expenses (smaller table; indexed by org + date)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', e.expense_date::text,
      'value', e.day_total
    ) ORDER BY e.expense_date
  ), '[]'::jsonb)
  INTO v_daily_expenses
  FROM (
    SELECT expense_date, SUM(amount) AS day_total
    FROM expenses
    WHERE organization_id = p_org_id
      AND expense_date BETWEEN p_from AND p_to
    GROUP BY expense_date
  ) e;

  -- Payment mix from rollups (historical) + today live
  SELECT
    COALESCE(SUM(cash_total), 0),
    COALESCE(SUM(mobile_total), 0),
    COALESCE(SUM(bank_total), 0)
  INTO v_cash, v_mobile, v_bank
  FROM org_daily_sales_summary
  WHERE organization_id = p_org_id
    AND store_id = '00000000-0000-0000-0000-000000000000'::uuid
    AND summary_date BETWEEN p_from AND p_to
    AND summary_date < v_today;

  IF p_to >= v_today AND p_from <= v_today THEN
    SELECT
      v_cash + COALESCE(SUM(pay.amount) FILTER (WHERE pay.method = 'cash'), 0),
      v_mobile + COALESCE(SUM(pay.amount) FILTER (WHERE pay.method = 'mobile_money'), 0),
      v_bank + COALESCE(SUM(pay.amount) FILTER (WHERE pay.method = 'bank_transfer'), 0)
    INTO v_cash, v_mobile, v_bank
    FROM payments pay
    WHERE pay.organization_id = p_org_id
      AND pay.status = 'completed'
      AND (pay.created_at AT TIME ZONE v_tz)::date = v_today;
  END IF;

  v_payment_mix := jsonb_build_array(
    jsonb_build_object('name', 'cash', 'value', v_cash),
    jsonb_build_object('name', 'mobile money', 'value', v_mobile),
    jsonb_build_object('name', 'bank transfer', 'value', v_bank)
  );

  -- Expense breakdown by category
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name', COALESCE(ec.name, 'Uncategorized'),
      'value', x.cat_total
    ) ORDER BY x.cat_total DESC
  ), '[]'::jsonb)
  INTO v_expense_categories
  FROM (
    SELECT e.category_id, SUM(e.amount) AS cat_total
    FROM expenses e
    WHERE e.organization_id = p_org_id
      AND e.expense_date BETWEEN p_from AND p_to
    GROUP BY e.category_id
  ) x
  LEFT JOIN expense_categories ec ON ec.id = x.category_id;

  RETURN jsonb_build_object(
    'daily_revenue', v_daily_revenue,
    'daily_expenses', v_daily_expenses,
    'payment_mix', v_payment_mix,
    'expense_by_category', v_expense_categories
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.financials_chart_data(UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- SUP-008: Paginated product catalog
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_products_page(
  p_org_id UUID,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_search TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_active_only BOOLEAN DEFAULT FALSE
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
  v_total BIGINT;
  v_rows JSONB;
  v_category_counts JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM products p
  WHERE p.organization_id = p_org_id
    AND (NOT COALESCE(p_active_only, false) OR p.is_active = true)
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
    AND (
      v_q IS NULL
      OR p.name ILIKE '%' || v_q || '%'
      OR p.sku ILIKE '%' || v_q || '%'
      OR p.barcode ILIKE '%' || v_q || '%'
    );

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      p.id,
      p.name,
      p.sku,
      p.barcode,
      p.sell_price,
      p.cost_price,
      p.reorder_point,
      p.is_active,
      p.image_url,
      p.category_id,
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('name', c.name) ELSE NULL END AS categories,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', pv.id,
            'name', pv.name,
            'sell_price', pv.sell_price,
            'barcode', pv.barcode
          ) ORDER BY pv.name
        )
        FROM product_variants pv
        WHERE pv.product_id = p.id
      ), '[]'::jsonb) AS product_variants
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.organization_id = p_org_id
      AND (NOT COALESCE(p_active_only, false) OR p.is_active = true)
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (
        v_q IS NULL
        OR p.name ILIKE '%' || v_q || '%'
        OR p.sku ILIKE '%' || v_q || '%'
        OR p.barcode ILIKE '%' || v_q || '%'
      )
    ORDER BY p.name
    LIMIT v_limit
    OFFSET v_offset
  ) t;

  SELECT COALESCE(jsonb_object_agg(cat_key, cnt), '{}'::jsonb)
  INTO v_category_counts
  FROM (
    SELECT COALESCE(category_id::text, '__none__') AS cat_key, COUNT(*)::bigint AS cnt
    FROM products
    WHERE organization_id = p_org_id
    GROUP BY category_id
  ) cc;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'category_counts', v_category_counts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_products_page(
  UUID, INT, INT, TEXT, UUID, BOOLEAN
) TO authenticated;

-- ---------------------------------------------------------------------------
-- SUP-014: Dashboard bundle — one round-trip for KPIs, trends, sidebar
-- ---------------------------------------------------------------------------

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

  -- 14-day sales trend from rollups + today live
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
        WHEN days.d = v_today THEN COALESCE(r.sales_total, (SELECT sales_total FROM today_live))
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

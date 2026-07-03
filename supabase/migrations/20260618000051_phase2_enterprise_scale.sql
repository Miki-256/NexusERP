-- Phase 2: Enterprise scale — daily rollups, scoped DB audit, retention, queue depth.

-- ---------------------------------------------------------------------------
-- 1. Daily sales / P&L summary table (refreshed by cron, not per-sale triggers)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.org_daily_sales_summary (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,
  store_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  transaction_count BIGINT NOT NULL DEFAULT 0,
  sales_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax_collected NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cogs NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cash_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  mobile_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  bank_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, summary_date, store_id)
);

CREATE INDEX IF NOT EXISTS idx_org_daily_sales_summary_org_date
  ON public.org_daily_sales_summary (organization_id, summary_date DESC);

ALTER TABLE public.org_daily_sales_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_daily_sales_summary_select ON public.org_daily_sales_summary;
CREATE POLICY org_daily_sales_summary_select ON public.org_daily_sales_summary
  FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

COMMENT ON TABLE public.org_daily_sales_summary IS
  'Pre-aggregated daily sales metrics. store_id = 00000000-0000-0000-0000-000000000000 is org-wide rollup.';

CREATE OR REPLACE FUNCTION public.refresh_org_daily_summaries(p_days_back INT DEFAULT 7)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from DATE;
  v_rows INT := 0;
BEGIN
  v_from := (current_date - GREATEST(1, LEAST(COALESCE(p_days_back, 7), 90)));

  -- Per-store daily rows
  INSERT INTO org_daily_sales_summary (
    organization_id, summary_date, store_id,
    transaction_count, sales_total, revenue, tax_collected, cogs,
    cash_total, mobile_total, bank_total, refreshed_at
  )
  WITH sale_days AS (
    SELECT
      s.id AS sale_id,
      s.organization_id,
      (s.created_at AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date AS summary_date,
      COALESCE(s.store_id, '00000000-0000-0000-0000-000000000000'::uuid) AS store_id,
      s.status,
      s.total,
      s.subtotal,
      s.discount_amount,
      s.tax_amount
    FROM sales s
    JOIN organizations o ON o.id = s.organization_id
    WHERE (s.created_at AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date >= v_from
  ),
  sale_cogs AS (
    SELECT
      sd.sale_id,
      SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)) AS line_cogs
    FROM sale_days sd
    JOIN sale_lines sl ON sl.sale_id = sd.sale_id
    LEFT JOIN product_variants pv ON pv.id = sl.variant_id
    LEFT JOIN products p ON p.id = pv.product_id
    WHERE sd.status = 'completed'
    GROUP BY sd.sale_id
  ),
  sale_payments AS (
    SELECT
      sd.sale_id,
      COALESCE(SUM(pay.amount) FILTER (WHERE pay.method = 'cash'), 0) AS cash_total,
      COALESCE(SUM(pay.amount) FILTER (WHERE pay.method = 'mobile_money'), 0) AS mobile_total,
      COALESCE(SUM(pay.amount) FILTER (WHERE pay.method = 'bank_transfer'), 0) AS bank_total
    FROM sale_days sd
    JOIN payments pay ON pay.sale_id = sd.sale_id
    WHERE sd.status = 'completed'
    GROUP BY sd.sale_id
  )
  SELECT
    sd.organization_id,
    sd.summary_date,
    sd.store_id,
    COUNT(*) FILTER (WHERE sd.status = 'completed')::bigint,
    COALESCE(SUM(sd.total) FILTER (WHERE sd.status = 'completed'), 0),
    COALESCE(SUM(sd.subtotal - sd.discount_amount) FILTER (WHERE sd.status = 'completed'), 0),
    COALESCE(SUM(sd.tax_amount) FILTER (WHERE sd.status = 'completed'), 0),
    COALESCE(SUM(sc.line_cogs), 0),
    COALESCE(SUM(sp.cash_total), 0),
    COALESCE(SUM(sp.mobile_total), 0),
    COALESCE(SUM(sp.bank_total), 0),
    now()
  FROM sale_days sd
  LEFT JOIN sale_cogs sc ON sc.sale_id = sd.sale_id
  LEFT JOIN sale_payments sp ON sp.sale_id = sd.sale_id
  GROUP BY sd.organization_id, sd.summary_date, sd.store_id
  ON CONFLICT (organization_id, summary_date, store_id) DO UPDATE SET
    transaction_count = EXCLUDED.transaction_count,
    sales_total = EXCLUDED.sales_total,
    revenue = EXCLUDED.revenue,
    tax_collected = EXCLUDED.tax_collected,
    cogs = EXCLUDED.cogs,
    cash_total = EXCLUDED.cash_total,
    mobile_total = EXCLUDED.mobile_total,
    bank_total = EXCLUDED.bank_total,
    refreshed_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Org-wide rollup rows (all stores combined per day)
  INSERT INTO org_daily_sales_summary (
    organization_id, summary_date, store_id,
    transaction_count, sales_total, revenue, tax_collected, cogs,
    cash_total, mobile_total, bank_total, refreshed_at
  )
  SELECT
    organization_id,
    summary_date,
    '00000000-0000-0000-0000-000000000000'::uuid,
    SUM(transaction_count),
    SUM(sales_total),
    SUM(revenue),
    SUM(tax_collected),
    SUM(cogs),
    SUM(cash_total),
    SUM(mobile_total),
    SUM(bank_total),
    now()
  FROM org_daily_sales_summary
  WHERE summary_date >= v_from
    AND store_id <> '00000000-0000-0000-0000-000000000000'::uuid
  GROUP BY organization_id, summary_date
  ON CONFLICT (organization_id, summary_date, store_id) DO UPDATE SET
    transaction_count = EXCLUDED.transaction_count,
    sales_total = EXCLUDED.sales_total,
    revenue = EXCLUDED.revenue,
    tax_collected = EXCLUDED.tax_collected,
    cogs = EXCLUDED.cogs,
    cash_total = EXCLUDED.cash_total,
    mobile_total = EXCLUDED.mobile_total,
    bank_total = EXCLUDED.bank_total,
    refreshed_at = now();

  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_org_daily_summaries(INT) TO service_role;

-- profit_and_loss: use rollups for past days, live scan for today only
CREATE OR REPLACE FUNCTION public.profit_and_loss(
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
  v_revenue NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_cogs NUMERIC := 0;
  v_opex NUMERIC := 0;
  v_gross NUMERIC := 0;
  v_net NUMERIC := 0;
  v_tz TEXT;
  v_today DATE;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM organizations WHERE id = p_org_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- Historical days from summary table
  SELECT
    COALESCE(SUM(revenue), 0),
    COALESCE(SUM(tax_collected), 0),
    COALESCE(SUM(cogs), 0)
  INTO v_revenue, v_tax, v_cogs
  FROM org_daily_sales_summary
  WHERE organization_id = p_org_id
    AND store_id = '00000000-0000-0000-0000-000000000000'::uuid
    AND summary_date BETWEEN p_from AND p_to
    AND summary_date < v_today;

  -- Today (live) when range includes today
  IF p_to >= v_today AND p_from <= v_today THEN
    SELECT
      v_revenue + COALESCE(SUM(s.subtotal - s.discount_amount), 0),
      v_tax + COALESCE(SUM(s.tax_amount), 0)
    INTO v_revenue, v_tax
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_tz)::date = v_today;

    SELECT v_cogs + COALESCE(SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
    INTO v_cogs
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    LEFT JOIN product_variants pv ON pv.id = sl.variant_id
    LEFT JOIN products p ON p.id = pv.product_id
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_tz)::date = v_today;
  END IF;

  -- Fallback: no summary rows yet — full live scan (backward compatible)
  IF NOT EXISTS (
    SELECT 1 FROM org_daily_sales_summary
    WHERE organization_id = p_org_id AND summary_date BETWEEN p_from AND LEAST(p_to, v_today - 1)
  ) AND p_from < v_today THEN
    SELECT COALESCE(SUM(s.subtotal - s.discount_amount), 0), COALESCE(SUM(s.tax_amount), 0)
      INTO v_revenue, v_tax
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND s.created_at::date BETWEEN p_from AND p_to;

    SELECT COALESCE(SUM(sl.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
      INTO v_cogs
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    LEFT JOIN product_variants pv ON pv.id = sl.variant_id
    LEFT JOIN products p ON p.id = pv.product_id
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND s.created_at::date BETWEEN p_from AND p_to;
  END IF;

  SELECT COALESCE(SUM(e.amount), 0) INTO v_opex
  FROM expenses e
  WHERE e.organization_id = p_org_id
    AND e.expense_date BETWEEN p_from AND p_to;

  v_gross := v_revenue - v_cogs;
  v_net := v_gross - v_opex;

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenue', v_revenue,
    'tax_collected', v_tax,
    'cogs', v_cogs,
    'gross_profit', v_gross,
    'gross_margin_pct', CASE WHEN v_revenue > 0 THEN round((v_gross / v_revenue) * 100, 1) ELSE 0 END,
    'operating_expenses', v_opex,
    'net_profit', v_net,
    'net_margin_pct', CASE WHEN v_revenue > 0 THEN round((v_net / v_revenue) * 100, 1) ELSE 0 END,
    'source', CASE
      WHEN EXISTS (
        SELECT 1 FROM org_daily_sales_summary
        WHERE organization_id = p_org_id AND summary_date BETWEEN p_from AND p_to
      ) THEN 'rollup'
      ELSE 'live'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.profit_and_loss(UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Webhook queue depth (monitoring)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_payment_webhook_queue_depth()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'pending', (SELECT count(*)::int FROM payment_webhook_queue WHERE processed_at IS NULL),
    'oldest_pending', (SELECT min(created_at) FROM payment_webhook_queue WHERE processed_at IS NULL)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_payment_webhook_queue_depth() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Scope db_activity_log triggers to sensitive tables + enable RLS
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
  t TEXT;
  v_sensitive TEXT[] := ARRAY[
    'organizations', 'organization_members', 'platform_admins',
    'sales', 'payments',
    'journal_entries', 'journal_entry_lines', 'accounts',
    'org_api_keys', 'auth_lockouts', 'staff_invites',
    'plan_change_requests', 'platform_settings',
    'customer_receivables', 'inventory_levels',
    'expenses', 'vendor_bills', 'purchase_orders',
    'platform_security_events', 'user_security_flags'
  ];
BEGIN
  -- Drop audit triggers from all public tables
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_%I_row_changes ON public.%I',
      r.tablename, r.tablename
    );
  END LOOP;

  -- Re-attach only on sensitive tables
  FOREACH t IN ARRAY v_sensitive
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER audit_%I_row_changes
           AFTER INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.log_db_activity()',
        t, t
      );
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.db_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS db_activity_log_deny ON public.db_activity_log;
CREATE POLICY db_activity_log_deny ON public.db_activity_log
  FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.prune_db_activity_log(p_retention_days INT DEFAULT 90)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM db_activity_log
  WHERE created_at < now() - make_interval(days => GREATEST(7, LEAST(COALESCE(p_retention_days, 90), 365)));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_db_activity_log(INT) TO service_role;

-- Initial backfill of summaries (last 90 days)
SELECT public.refresh_org_daily_summaries(90);

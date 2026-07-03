-- Phase 3: Enterprise archive pipeline, BRIN scale index, read-replica maintenance RPC.

-- ---------------------------------------------------------------------------
-- 1. BRIN index for time-range scans on high-volume sales table
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_sales_created_brin
  ON public.sales USING BRIN (created_at)
  WITH (pages_per_range = 128);

-- ---------------------------------------------------------------------------
-- 2. Archive tables (cold storage — partitioned by archived month via column)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sales_archive (
  LIKE public.sales INCLUDING DEFAULTS,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archive_month DATE
);

CREATE INDEX IF NOT EXISTS idx_sales_archive_org_created
  ON public.sales_archive (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_archive_month
  ON public.sales_archive (archive_month);

CREATE TABLE IF NOT EXISTS public.sale_lines_archive (
  LIKE public.sale_lines INCLUDING DEFAULTS,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_lines_archive_sale
  ON public.sale_lines_archive (sale_id);

CREATE TABLE IF NOT EXISTS public.payments_archive (
  LIKE public.payments INCLUDING DEFAULTS,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_archive_sale
  ON public.payments_archive (sale_id);

CREATE TABLE IF NOT EXISTS public.audit_logs_archive (
  LIKE public.audit_logs INCLUDING DEFAULTS,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_org
  ON public.audit_logs_archive (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_security_events_archive (
  LIKE public.platform_security_events INCLUDING DEFAULTS,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_archive_created
  ON public.platform_security_events_archive (created_at DESC);

ALTER TABLE public.sales_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_lines_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_security_events_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_archive_select ON public.sales_archive;
CREATE POLICY sales_archive_select ON public.sales_archive FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS sale_lines_archive_select ON public.sale_lines_archive;
CREATE POLICY sale_lines_archive_select ON public.sale_lines_archive FOR SELECT
  USING (
    sale_id IN (
      SELECT id FROM public.sales_archive
      WHERE organization_id IN (SELECT public.user_organization_ids())
    )
  );

DROP POLICY IF EXISTS payments_archive_select ON public.payments_archive;
CREATE POLICY payments_archive_select ON public.payments_archive FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS audit_logs_archive_select ON public.audit_logs_archive;
CREATE POLICY audit_logs_archive_select ON public.audit_logs_archive FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS security_events_archive_select ON public.platform_security_events_archive;
CREATE POLICY security_events_archive_select ON public.platform_security_events_archive FOR SELECT
  USING (public.platform_admin_can_read());

-- ---------------------------------------------------------------------------
-- 3. Archive functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.archive_old_security_events(p_retention_days INT DEFAULT 180)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_moved INT;
BEGIN
  v_cutoff := now() - make_interval(days => GREATEST(30, LEAST(COALESCE(p_retention_days, 180), 730)));
  WITH moved AS (
    DELETE FROM platform_security_events
    WHERE created_at < v_cutoff
    RETURNING *
  )
  INSERT INTO platform_security_events_archive
  SELECT m.*, now() FROM moved m;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_old_audit_logs(
  p_retention_days INT DEFAULT 365,
  p_batch_size INT DEFAULT 2000
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_moved INT;
BEGIN
  v_cutoff := now() - make_interval(days => GREATEST(90, LEAST(COALESCE(p_retention_days, 365), 1825)));
  WITH picked AS (
    SELECT id FROM audit_logs
    WHERE created_at < v_cutoff
    ORDER BY created_at
    LIMIT GREATEST(100, LEAST(COALESCE(p_batch_size, 2000), 10000))
  ),
  moved AS (
    DELETE FROM audit_logs a
    USING picked p
    WHERE a.id = p.id
    RETURNING a.*
  )
  INSERT INTO audit_logs_archive
  SELECT m.*, now() FROM moved m;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_cold_sales(
  p_min_age_months INT DEFAULT 24,
  p_batch_size INT DEFAULT 200
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_sale RECORD;
  v_moved INT := 0;
  v_limit INT;
BEGIN
  v_limit := GREATEST(10, LEAST(COALESCE(p_batch_size, 200), 1000));
  v_cutoff := date_trunc('month', now()) - make_interval(months => GREATEST(12, LEAST(COALESCE(p_min_age_months, 24), 120)));

  FOR v_sale IN
    SELECT s.id
    FROM sales s
    WHERE s.status = 'completed'
      AND s.created_at < v_cutoff
      AND NOT EXISTS (SELECT 1 FROM sale_returns sr WHERE sr.sale_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM sales s2 WHERE s2.original_sale_id = s.id)
      AND EXISTS (
        SELECT 1 FROM org_daily_sales_summary ods
        WHERE ods.organization_id = s.organization_id
          AND ods.store_id = '00000000-0000-0000-0000-000000000000'::uuid
          AND ods.summary_date = (s.created_at AT TIME ZONE 'UTC')::date
      )
    ORDER BY s.created_at
    LIMIT v_limit
  LOOP
    INSERT INTO sales_archive
    SELECT s.*, now(), date_trunc('month', s.created_at AT TIME ZONE 'UTC')::date
    FROM sales s WHERE s.id = v_sale.id;

    INSERT INTO sale_lines_archive
    SELECT sl.*, now() FROM sale_lines sl WHERE sl.sale_id = v_sale.id;

    INSERT INTO payments_archive
    SELECT p.*, now() FROM payments p WHERE p.sale_id = v_sale.id;

    DELETE FROM sale_lines WHERE sale_id = v_sale.id;
    DELETE FROM payments WHERE sale_id = v_sale.id;
    DELETE FROM sales WHERE id = v_sale.id;

    v_moved := v_moved + 1;
  END LOOP;

  RETURN v_moved;
END;
$$;

-- Combined maintenance batch (cron / ops)
CREATE OR REPLACE FUNCTION public.run_enterprise_maintenance(
  p_archive_sales BOOLEAN DEFAULT false,
  p_sales_min_age_months INT DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summaries INT;
  v_db_log INT;
  v_security INT;
  v_audit INT;
  v_sales INT := 0;
BEGIN
  v_summaries := public.refresh_org_daily_summaries(7);
  v_db_log := public.prune_db_activity_log(90);
  v_security := public.archive_old_security_events(180);
  v_audit := public.archive_old_audit_logs(365, 2000);

  IF COALESCE(p_archive_sales, false) THEN
    v_sales := public.archive_cold_sales(p_sales_min_age_months, 200);
  END IF;

  RETURN jsonb_build_object(
    'summaries_refreshed', v_summaries,
    'db_activity_log_pruned', v_db_log,
    'security_events_archived', v_security,
    'audit_logs_archived', v_audit,
    'sales_archived', v_sales,
    'ran_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_old_security_events(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_old_audit_logs(INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_cold_sales(INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_enterprise_maintenance(BOOLEAN, INT) TO service_role;

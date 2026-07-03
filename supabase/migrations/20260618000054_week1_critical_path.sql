-- Week 1 critical path: payments index, rollup freshness helper, summary backfill.

-- Financials / dashboard filter payments by org + created_at range.
CREATE INDEX IF NOT EXISTS idx_payments_org_created
  ON public.payments (organization_id, created_at DESC)
  WHERE status = 'completed';

COMMENT ON INDEX public.idx_payments_org_created IS
  'Org-scoped payment reports and cash-flow charts (completed payments only).';

-- Ops: orgs whose daily rollups are missing or older than p_max_lag_days.
CREATE OR REPLACE FUNCTION public.rollup_freshness_stale_orgs(p_max_lag_days INT DEFAULT 2)
RETURNS TABLE (
  organization_id UUID,
  latest_summary DATE,
  lag_days INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id AS organization_id,
    max(s.summary_date) AS latest_summary,
    (current_date - max(s.summary_date))::int AS lag_days
  FROM organizations o
  LEFT JOIN org_daily_sales_summary s
    ON s.organization_id = o.id
    AND s.store_id = '00000000-0000-0000-0000-000000000000'::uuid
  GROUP BY o.id
  HAVING max(s.summary_date) IS NULL
     OR max(s.summary_date) < current_date - GREATEST(1, LEAST(COALESCE(p_max_lag_days, 2), 30));
$$;

GRANT EXECUTE ON FUNCTION public.rollup_freshness_stale_orgs(INT) TO service_role;

-- Idempotent backfill so profit_and_loss uses rollups instead of full sales scans.
SELECT public.refresh_org_daily_summaries(90);

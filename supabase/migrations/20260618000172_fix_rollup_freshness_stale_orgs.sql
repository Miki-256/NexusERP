-- Ops: only flag orgs whose sales rollups lag behind completed sales.
-- Empty / inactive orgs (no sales) were incorrectly counted as stale because
-- refresh_org_daily_summaries only inserts days that have sales activity.

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
  WITH params AS (
    SELECT GREATEST(1, LEAST(COALESCE(p_max_lag_days, 2), 30)) AS max_lag
  ),
  latest_sale AS (
    SELECT
      s.organization_id,
      max((s.created_at AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date) AS latest_sale_date
    FROM sales s
    JOIN organizations o ON o.id = s.organization_id
    WHERE s.status = 'completed'
    GROUP BY s.organization_id
  ),
  latest_summary AS (
    SELECT
      organization_id,
      max(summary_date) AS latest_summary
    FROM org_daily_sales_summary
    WHERE store_id = '00000000-0000-0000-0000-000000000000'::uuid
    GROUP BY organization_id
  )
  SELECT
    sale.organization_id,
    sum.latest_summary,
    (sale.latest_sale_date - COALESCE(sum.latest_summary, DATE '1970-01-01'))::int AS lag_days
  FROM latest_sale sale
  CROSS JOIN params p
  LEFT JOIN latest_summary sum ON sum.organization_id = sale.organization_id
  WHERE
    -- Ignore dormant orgs whose last sale is outside the freshness window
    -- unless they never received an org-wide rollup at all.
    (
      sale.latest_sale_date >= current_date - p.max_lag
      OR sum.latest_summary IS NULL
    )
    AND (
      sum.latest_summary IS NULL
      OR sum.latest_summary < sale.latest_sale_date
    );
$$;

COMMENT ON FUNCTION public.rollup_freshness_stale_orgs(INT) IS
  'Orgs with completed sales whose org-wide daily rollup is missing or behind the latest sale date.';

GRANT EXECUTE ON FUNCTION public.rollup_freshness_stale_orgs(INT) TO service_role;

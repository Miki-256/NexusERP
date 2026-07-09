-- Dashboard today KPIs: org-local day bounds (timestamptz) + P&L fallback timezone fix.
-- Idempotent — safe to re-run if 00076 was already applied.

CREATE OR REPLACE FUNCTION public._org_local_day_bounds(p_org_id UUID, p_day DATE DEFAULT NULL)
RETURNS TABLE(day_start TIMESTAMPTZ, day_end TIMESTAMPTZ, local_day DATE, tz TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_day DATE;
BEGIN
  SELECT COALESCE(NULLIF(trim(timezone), ''), 'Africa/Addis_Ababa')
  INTO v_tz
  FROM organizations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    v_tz := 'Africa/Addis_Ababa';
  END IF;

  v_day := COALESCE(p_day, (now() AT TIME ZONE v_tz)::date);
  day_start := (v_day::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  day_end := day_start + interval '1 day';
  local_day := v_day;
  tz := v_tz;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_stats(p_organization_id UUID, p_store_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_bounds RECORD;
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_bounds FROM public._org_local_day_bounds(p_organization_id);

  SELECT jsonb_build_object(
    'sales_total', COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed'), 0),
    'transaction_count', COUNT(*) FILTER (WHERE s.status = 'completed'),
    'cash_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'cash'
        AND s2.created_at >= v_bounds.day_start
        AND s2.created_at < v_bounds.day_end
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'mobile_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'mobile_money'
        AND s2.created_at >= v_bounds.day_start
        AND s2.created_at < v_bounds.day_end
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'bank_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'bank_transfer'
        AND s2.created_at >= v_bounds.day_start
        AND s2.created_at < v_bounds.day_end
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0)
  ) INTO v_result
  FROM sales s
  WHERE s.organization_id = p_organization_id
    AND s.created_at >= v_bounds.day_start
    AND s.created_at < v_bounds.day_end
    AND (p_store_id IS NULL OR s.store_id = p_store_id);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public._org_local_day_bounds(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_stats(UUID, UUID) TO authenticated;

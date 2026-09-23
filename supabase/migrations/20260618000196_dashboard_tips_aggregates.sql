-- Aggregated dashboard / finance helpers (avoid pull-all-rows client scans)

CREATE OR REPLACE FUNCTION public.dashboard_today_stats_live(
  p_organization_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sales_total NUMERIC;
  v_tips_total NUMERIC;
  v_txn_count BIGINT;
  v_cash NUMERIC;
  v_mobile NUMERIC;
  v_bank NUMERIC;
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT
    COALESCE(SUM(total), 0),
    COALESCE(SUM(COALESCE(tip_amount, 0)), 0),
    COUNT(*)
  INTO v_sales_total, v_tips_total, v_txn_count
  FROM sales
  WHERE organization_id = p_organization_id
    AND status = 'completed'
    AND created_at >= p_from
    AND created_at <= p_to;

  SELECT
    COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN p.method = 'mobile_money' THEN p.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN p.method = 'bank_transfer' THEN p.amount ELSE 0 END), 0)
  INTO v_cash, v_mobile, v_bank
  FROM payments p
  JOIN sales s ON s.id = p.sale_id
  WHERE p.organization_id = p_organization_id
    AND s.status = 'completed'
    AND p.created_at >= p_from
    AND p.created_at <= p_to;

  RETURN jsonb_build_object(
    'sales_total', v_sales_total,
    'tips_total', v_tips_total,
    'transaction_count', v_txn_count,
    'cash_total', v_cash,
    'mobile_total', v_mobile,
    'bank_total', v_bank
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_today_stats_live(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.sum_sales_tips(
  p_organization_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sum NUMERIC;
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(SUM(COALESCE(tip_amount, 0)), 0)
  INTO v_sum
  FROM sales
  WHERE organization_id = p_organization_id
    AND status = 'completed'
    AND sold_at >= p_from
    AND sold_at <= p_to;

  RETURN v_sum;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sum_sales_tips(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

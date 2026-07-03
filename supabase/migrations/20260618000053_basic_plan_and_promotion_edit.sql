-- Rename Free plan display name to Basic; add promotion update RPC.

UPDATE public.platform_plans
SET name = 'Basic'
WHERE id = 'free';

CREATE OR REPLACE FUNCTION public.update_promotion(
  p_promotion_id UUID,
  p_name TEXT,
  p_code TEXT,
  p_discount_type TEXT,
  p_discount_value NUMERIC,
  p_min_order_total NUMERIC DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM promotions WHERE id = p_promotion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promotion not found';
  END IF;
  IF NOT public.user_can_manage(v_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'Invalid discount type';
  END IF;
  IF p_discount_type = 'percent' AND p_discount_value > 100 THEN
    RAISE EXCEPTION 'Percent discount cannot exceed 100';
  END IF;

  UPDATE promotions
  SET
    name = trim(p_name),
    code = NULLIF(trim(p_code), ''),
    discount_type = p_discount_type,
    discount_value = p_discount_value,
    min_order_total = COALESCE(p_min_order_total, 0),
    updated_at = now()
  WHERE id = p_promotion_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_promotion TO authenticated;

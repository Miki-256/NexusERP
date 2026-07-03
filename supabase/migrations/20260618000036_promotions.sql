-- Promotions module (discount rules — apply at POS in a future pass).

CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC NOT NULL CHECK (discount_value > 0),
  min_order_total NUMERIC NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotions_org ON promotions(organization_id);

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promotions_select ON promotions;
CREATE POLICY promotions_select ON promotions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS promotions_manage ON promotions;
CREATE POLICY promotions_manage ON promotions FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

CREATE OR REPLACE FUNCTION public.list_promotions(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC)
      FROM promotions p
      WHERE p.organization_id = p_organization_id
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_promotions TO authenticated;

CREATE OR REPLACE FUNCTION public.create_promotion(
  p_organization_id UUID,
  p_name TEXT,
  p_code TEXT,
  p_discount_type TEXT,
  p_discount_value NUMERIC,
  p_min_order_total NUMERIC DEFAULT 0,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'Invalid discount type';
  END IF;
  IF p_discount_type = 'percent' AND p_discount_value > 100 THEN
    RAISE EXCEPTION 'Percent discount cannot exceed 100';
  END IF;

  INSERT INTO promotions (
    organization_id, name, code, discount_type, discount_value,
    min_order_total, starts_at, ends_at
  ) VALUES (
    p_organization_id, p_name, NULLIF(trim(p_code), ''), p_discount_type, p_discount_value,
    COALESCE(p_min_order_total, 0), p_starts_at, p_ends_at
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_promotion TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_promotion(p_promotion_id UUID, p_active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM promotions WHERE id = p_promotion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Promotion not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE promotions SET is_active = p_active, updated_at = now() WHERE id = p_promotion_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.toggle_promotion TO authenticated;

-- Register app id in all_erp_app_ids via migration patch
CREATE OR REPLACE FUNCTION public.all_erp_app_ids()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'dashboard', 'pos', 'sales', 'invoicing', 'crm', 'customers', 'refunds', 'credits', 'receivables',
    'products', 'inventory', 'purchasing', 'manufacturing',
    'accounting', 'expenses', 'reports', 'documents',
    'hr', 'recruitment', 'timeoff', 'projects', 'helpdesk',
    'promotions',
    'stores', 'team', 'settings'
  ]::TEXT[];
$$;

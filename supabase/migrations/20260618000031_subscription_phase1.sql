-- Phase 1: Tenant subscription visibility (usage RPCs, public plan catalog).
-- Module visibility: all tiers show full nav by default (modules NULL = all apps).
-- Plan caps (stores/members/sales) enforced in 00030.

CREATE OR REPLACE FUNCTION public.list_public_plans()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'max_stores', p.max_stores,
          'max_members', p.max_members,
          'max_sales_per_month', p.max_sales_per_month,
          'modules', p.modules
        )
        ORDER BY p.sort_order
      )
      FROM platform_plans p
    ),
    '[]'::jsonb
  );
$$;
GRANT EXECUTE ON FUNCTION public.list_public_plans TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_org_plan_usage(p_organization_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_org organizations%ROWTYPE;
  v_plan platform_plans%ROWTYPE;
  v_stores INT;
  v_members INT;
  v_sales_month INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_organization_id IS NOT NULL THEN
    v_org_id := p_organization_id;
  ELSE
    SELECT m.organization_id INTO v_org_id
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = auth.uid()
      AND m.is_active = true
      AND o.status = 'active'
    ORDER BY m.created_at
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization';
  END IF;

  IF NOT public.user_has_org_access(v_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  SELECT * INTO v_plan FROM platform_plans WHERE id = COALESCE(v_org.plan, 'free');
  IF NOT FOUND THEN
    SELECT * INTO v_plan FROM platform_plans WHERE id = 'free';
  END IF;

  SELECT COUNT(*) INTO v_stores FROM stores WHERE organization_id = v_org_id;
  SELECT COUNT(*) INTO v_members
  FROM organization_members
  WHERE organization_id = v_org_id AND is_active = true;
  SELECT COUNT(*) INTO v_sales_month
  FROM sales
  WHERE organization_id = v_org_id
    AND status = 'completed'
    AND created_at >= date_trunc('month', now());

  RETURN jsonb_build_object(
    'organization_id', v_org.id,
    'plan', v_org.plan,
    'plan_name', v_plan.name,
    'limits', jsonb_build_object(
      'max_stores', v_plan.max_stores,
      'max_members', v_plan.max_members,
      'max_sales_per_month', v_plan.max_sales_per_month,
      'modules', v_plan.modules
    ),
    'usage', jsonb_build_object(
      'stores', v_stores,
      'members', v_members,
      'sales_this_month', v_sales_month
    ),
    'within_limits', jsonb_build_object(
      'stores', v_plan.max_stores IS NULL OR v_stores <= v_plan.max_stores,
      'members', v_plan.max_members IS NULL OR v_members <= v_plan.max_members,
      'sales', v_plan.max_sales_per_month IS NULL OR v_sales_month <= v_plan.max_sales_per_month
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_org_plan_usage TO authenticated;

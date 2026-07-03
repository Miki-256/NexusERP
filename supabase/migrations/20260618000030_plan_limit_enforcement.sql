-- Plan limit enforcement (stores, team seats, monthly sales).

CREATE OR REPLACE FUNCTION public.check_org_plan_limit(p_org_id UUID, p_metric TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_plan platform_plans%ROWTYPE;
  v_count INT;
  v_max INT;
BEGIN
  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_plan FROM platform_plans WHERE id = COALESCE(v_org.plan, 'free');
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_metric = 'stores' THEN
    v_max := v_plan.max_stores;
    IF v_max IS NULL THEN
      RETURN;
    END IF;
    SELECT COUNT(*) INTO v_count FROM stores WHERE organization_id = p_org_id;
    IF v_count >= v_max THEN
      RAISE EXCEPTION 'Plan limit reached: maximum % store(s) on the % plan. Upgrade your plan to add more.',
        v_max, v_plan.name;
    END IF;
  ELSIF p_metric = 'members' THEN
    v_max := v_plan.max_members;
    IF v_max IS NULL THEN
      RETURN;
    END IF;
    SELECT COUNT(*) INTO v_count
    FROM organization_members
    WHERE organization_id = p_org_id AND is_active = true;
    SELECT v_count + COUNT(*) INTO v_count
    FROM staff_invites
    WHERE organization_id = p_org_id AND accepted_at IS NULL;
    IF v_count >= v_max THEN
      RAISE EXCEPTION 'Plan limit reached: maximum % team member(s) on the % plan. Upgrade your plan to invite more.',
        v_max, v_plan.name;
    END IF;
  ELSIF p_metric = 'sales' THEN
    v_max := v_plan.max_sales_per_month;
    IF v_max IS NULL THEN
      RETURN;
    END IF;
    SELECT COUNT(*) INTO v_count
    FROM sales
    WHERE organization_id = p_org_id
      AND status = 'completed'
      AND created_at >= date_trunc('month', now());
    IF v_count >= v_max THEN
      RAISE EXCEPTION 'Plan limit reached: maximum % completed sales per month on the % plan. Upgrade your plan to continue selling.',
        v_max, v_plan.name;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown plan metric: %', p_metric;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_org_plan_limit_stores()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.check_org_plan_limit(NEW.organization_id, 'stores');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_org_plan_limit_invites()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.check_org_plan_limit(NEW.organization_id, 'members');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_org_plan_limit_members()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INT;
  v_count INT;
  v_plan TEXT;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(o.plan, 'free') INTO v_plan
  FROM organizations o
  WHERE o.id = NEW.organization_id;

  SELECT max_members INTO v_max
  FROM platform_plans
  WHERE id = v_plan;

  IF v_max IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM organization_members
  WHERE organization_id = NEW.organization_id AND is_active = true;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Plan limit reached: maximum % team member(s). Upgrade your plan to add more.', v_max;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_org_plan_limit_sales()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    PERFORM public.check_org_plan_limit(NEW.organization_id, 'sales');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stores_plan_limit ON stores;
CREATE TRIGGER trg_stores_plan_limit
  BEFORE INSERT ON stores
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_org_plan_limit_stores();

DROP TRIGGER IF EXISTS trg_staff_invites_plan_limit ON staff_invites;
CREATE TRIGGER trg_staff_invites_plan_limit
  BEFORE INSERT ON staff_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_org_plan_limit_invites();

DROP TRIGGER IF EXISTS trg_members_plan_limit ON organization_members;
CREATE TRIGGER trg_members_plan_limit
  BEFORE INSERT ON organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_org_plan_limit_members();

DROP TRIGGER IF EXISTS trg_sales_plan_limit ON sales;
CREATE TRIGGER trg_sales_plan_limit
  BEFORE INSERT ON sales
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_org_plan_limit_sales();

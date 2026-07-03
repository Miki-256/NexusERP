-- Callable from Team UI when migration 00016 was not applied yet.

CREATE OR REPLACE FUNCTION public.ensure_org_department_roles(p_org_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before INTEGER;
  v_after INTEGER;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_before
  FROM department_roles WHERE organization_id = p_org_id;

  PERFORM public.seed_department_roles(p_org_id);

  SELECT COUNT(*)::INTEGER INTO v_after
  FROM department_roles WHERE organization_id = p_org_id;

  RETURN GREATEST(v_after - v_before, v_after);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_org_department_roles TO authenticated;

-- Hotfix: user_can_manage_communications missing when 00088 was skipped but 00091 was applied.
-- Safe to run even if the function already exists (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.user_can_manage_communications(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF public.user_can_manage(p_org_id) THEN
    RETURN true;
  END IF;

  SELECT om.id INTO v_member_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
    AND om.organization_id = p_org_id
    AND om.is_active = true;

  IF v_member_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN 'communications' = ANY(public.resolve_member_manage_app_ids(v_member_id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_manage_communications(UUID) TO authenticated;

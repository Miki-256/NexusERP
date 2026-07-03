-- Single source of truth for the logged-in user's workspace (bypasses RLS visibility gaps).

CREATE OR REPLACE FUNCTION public.get_my_workspace()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member organization_members%ROWTYPE;
  v_org organizations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT m.* INTO v_member
  FROM organization_members m
  WHERE m.user_id = auth.uid() AND m.is_active = true
  ORDER BY m.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT o.* INTO v_org
  FROM organizations o
  WHERE o.id = v_member.organization_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'member', to_jsonb(v_member),
    'organization', to_jsonb(v_org)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_workspace TO authenticated;

-- Ensure pending orgs remain visible to their members (idempotent).
CREATE OR REPLACE FUNCTION public.user_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.organization_id
  FROM organization_members m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
    AND m.is_active = true
    AND (o.status IN ('active', 'pending') OR public.is_platform_admin());
$$;

-- Restore workspace RPCs accidentally dropped by 20260618000084_multi_org_switcher_fix.sql
-- (that migration only contained DROP statements).

CREATE OR REPLACE FUNCTION public.get_my_workspace(p_organization_id UUID DEFAULT NULL)
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

  IF p_organization_id IS NOT NULL THEN
    SELECT m.* INTO v_member
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = auth.uid()
      AND m.is_active = true
      AND m.organization_id = p_organization_id
      AND (o.status = 'active' OR public.is_platform_admin());
  ELSE
    SELECT m.* INTO v_member
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = auth.uid()
      AND m.is_active = true
      AND (o.status = 'active' OR public.is_platform_admin())
    ORDER BY m.created_at
    LIMIT 1;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.get_my_workspace(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_app_permissions(p_organization_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member organization_members%ROWTYPE;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    SELECT m.* INTO v_member
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = auth.uid()
      AND m.is_active = true
      AND m.organization_id = p_organization_id
      AND (o.status = 'active' OR public.is_platform_admin());
  ELSE
    SELECT m.* INTO v_member
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = auth.uid()
      AND m.is_active = true
      AND (o.status = 'active' OR public.is_platform_admin())
    ORDER BY m.created_at
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'member_id', NULL,
      'organization_id', NULL,
      'role', NULL,
      'accessible_apps', '[]'::jsonb,
      'manage_apps', '[]'::jsonb,
      'uses_custom_permissions', false
    );
  END IF;

  RETURN jsonb_build_object(
    'member_id', v_member.id,
    'organization_id', v_member.organization_id,
    'role', v_member.role,
    'accessible_apps', to_jsonb(public.resolve_member_app_ids(v_member.id)),
    'manage_apps', to_jsonb(public.resolve_member_manage_app_ids(v_member.id)),
    'uses_custom_permissions', public.member_uses_custom_permissions(v_member.id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_app_permissions(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_workspaces()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'organization_id', o.id,
        'organization_name', o.name,
        'role', m.role,
        'member_id', m.id,
        'joined_at', m.created_at
      )
      ORDER BY m.created_at
    ),
    '[]'::jsonb
  )
  FROM organization_members m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
    AND m.is_active = true
    AND (o.status = 'active' OR public.is_platform_admin());
$$;

GRANT EXECUTE ON FUNCTION public.list_my_workspaces TO authenticated;

NOTIFY pgrst, 'reload schema';

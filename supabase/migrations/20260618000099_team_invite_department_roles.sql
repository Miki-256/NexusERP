-- Invite-time department roles + team member management helpers.

ALTER TABLE staff_invites
  ADD COLUMN IF NOT EXISTS department_role_ids UUID[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.accept_staff_invite(p_invite_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite staff_invites%ROWTYPE;
  v_user_id UUID;
  v_email TEXT;
  v_member_id UUID;
  v_role_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invite FROM staff_invites
  WHERE id = p_invite_id AND accepted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found or already accepted';
  END IF;

  IF lower(v_invite.email) <> lower(v_email) THEN
    RAISE EXCEPTION 'Invite email does not match your account';
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role, store_ids)
  VALUES (v_invite.organization_id, v_user_id, v_invite.role, v_invite.store_ids)
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET role = EXCLUDED.role, store_ids = EXCLUDED.store_ids, is_active = true
  RETURNING id INTO v_member_id;

  IF v_invite.department_role_ids IS NOT NULL
     AND cardinality(v_invite.department_role_ids) > 0 THEN
    DELETE FROM organization_member_department_roles WHERE member_id = v_member_id;
    FOREACH v_role_id IN ARRAY v_invite.department_role_ids LOOP
      IF EXISTS (
        SELECT 1 FROM department_roles
        WHERE id = v_role_id AND organization_id = v_invite.organization_id
      ) THEN
        INSERT INTO organization_member_department_roles (member_id, role_id)
        VALUES (v_member_id, v_role_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  UPDATE staff_invites SET accepted_at = now() WHERE id = p_invite_id;

  RETURN v_invite.organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_staff_invite_preview(p_invite_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite staff_invites%ROWTYPE;
  v_org_name TEXT;
  v_dept_roles JSONB;
BEGIN
  SELECT * INTO v_invite
  FROM staff_invites
  WHERE id = p_invite_id AND accepted_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_org_name FROM organizations WHERE id = v_invite.organization_id;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('id', dr.id, 'name', dr.name) ORDER BY dr.name),
    '[]'::jsonb
  ) INTO v_dept_roles
  FROM department_roles dr
  WHERE dr.organization_id = v_invite.organization_id
    AND dr.id = ANY(COALESCE(v_invite.department_role_ids, '{}'::UUID[]));

  RETURN jsonb_build_object(
    'email', v_invite.email,
    'role', v_invite.role,
    'organization_name', v_org_name,
    'department_roles', v_dept_roles
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_organization_team_members(p_org_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  email TEXT,
  display_name TEXT,
  role member_role,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.user_id,
    u.email::TEXT,
    COALESCE(
      NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''),
      split_part(u.email::TEXT, '@', 1)
    ) AS display_name,
    m.role,
    m.is_active,
    m.created_at
  FROM organization_members m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = p_org_id
  ORDER BY
    CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
    m.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_organization_member(
  p_member_id UUID,
  p_role member_role DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member organization_members%ROWTYPE;
BEGIN
  SELECT * INTO v_member FROM organization_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF NOT public.user_can_manage(v_member.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_member.role = 'owner' THEN
    RAISE EXCEPTION 'Cannot change the organization owner';
  END IF;

  IF p_role IS NOT NULL AND p_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot promote a member to owner';
  END IF;

  UPDATE organization_members
  SET
    role = COALESCE(p_role, role),
    is_active = COALESCE(p_is_active, is_active)
  WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_team_members TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_organization_member TO authenticated;

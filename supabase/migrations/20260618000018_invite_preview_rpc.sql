-- Public preview for invite acceptance flow (invite UUID acts as the secret token).

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
BEGIN
  SELECT * INTO v_invite
  FROM staff_invites
  WHERE id = p_invite_id AND accepted_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_org_name FROM organizations WHERE id = v_invite.organization_id;

  RETURN jsonb_build_object(
    'email', v_invite.email,
    'role', v_invite.role,
    'organization_name', v_org_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_staff_invite_preview TO anon, authenticated;

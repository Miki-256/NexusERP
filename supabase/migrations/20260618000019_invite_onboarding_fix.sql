-- Fix invited users stuck on /onboarding and owners looping after org creation (pending org invisible via RLS).

-- Allow members to see their org while it is pending approval.
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

-- Pending staff invite for the logged-in user's email.
CREATE OR REPLACE FUNCTION public.get_my_pending_staff_invite()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_invite_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT si.id INTO v_invite_id
  FROM staff_invites si
  WHERE lower(si.email) = lower(v_email)
    AND si.accepted_at IS NULL
  ORDER BY si.created_at DESC
  LIMIT 1;

  RETURN v_invite_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_pending_staff_invite TO authenticated;

-- Accept the current user's pending invite (if any). Idempotent when already a member.
CREATE OR REPLACE FUNCTION public.accept_my_pending_staff_invite()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite_id UUID;
  v_org_id UUID;
BEGIN
  v_invite_id := public.get_my_pending_staff_invite();
  IF v_invite_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_org_id := public.accept_staff_invite(v_invite_id);
  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_my_pending_staff_invite TO authenticated;

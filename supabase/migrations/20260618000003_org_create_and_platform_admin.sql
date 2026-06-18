-- Phase 0/1 glue: seed accounts on org creation, bootstrap first platform admin,
-- and provide server-side platform-admin actions for the Super Admin console (S1).

-- Recreate org creation to: seed default chart of accounts, and bootstrap the very
-- first platform admin + auto-activate their first org (so the system is usable).
CREATE OR REPLACE FUNCTION public.create_organization_with_owner(
  p_name TEXT,
  p_currency TEXT DEFAULT 'ETB',
  p_timezone TEXT DEFAULT 'Africa/Addis_Ababa',
  p_tax_rate NUMERIC DEFAULT 15,
  p_tax_inclusive BOOLEAN DEFAULT false,
  p_store_name TEXT DEFAULT 'Main Store',
  p_register_name TEXT DEFAULT 'Register 1'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_store_id UUID;
  v_user_id UUID;
  v_is_first BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM platform_admins) INTO v_is_first;

  INSERT INTO organizations (name, currency, timezone, tax_rate, tax_inclusive, status)
  VALUES (p_name, p_currency, p_timezone, p_tax_rate, p_tax_inclusive,
          CASE WHEN v_is_first THEN 'active'::org_status ELSE 'pending'::org_status END)
  RETURNING id INTO v_org_id;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  INSERT INTO stores (organization_id, name)
  VALUES (v_org_id, p_store_name)
  RETURNING id INTO v_store_id;

  INSERT INTO registers (store_id, organization_id, name)
  VALUES (v_store_id, v_org_id, p_register_name);

  INSERT INTO receipt_sequences (store_id, organization_id, last_number)
  VALUES (v_store_id, v_org_id, 0);

  -- Bootstrap: the first ever org creator becomes the platform admin.
  IF v_is_first THEN
    INSERT INTO platform_admins (user_id) VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  PERFORM public.ensure_default_accounts(v_org_id);

  RETURN v_org_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner TO authenticated;

-- Platform-admin: list all shops (server-side enforced; replaces client-only gating).
CREATE OR REPLACE FUNCTION public.admin_list_organizations()
RETURNS TABLE (
  id UUID, name TEXT, status org_status, plan TEXT, currency TEXT,
  member_count BIGINT, created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.name, o.status, o.plan, o.currency,
         (SELECT COUNT(*) FROM organization_members m WHERE m.organization_id = o.id) AS member_count,
         o.created_at
  FROM organizations o
  WHERE public.is_platform_admin()
  ORDER BY o.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations TO authenticated;

-- Platform-admin: change an organization's status (approve / suspend / reject).
CREATE OR REPLACE FUNCTION public.admin_set_org_status(p_org_id UUID, p_status org_status)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  UPDATE organizations SET status = p_status WHERE id = p_org_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_org_status TO authenticated;

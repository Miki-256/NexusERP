-- Department roles + per-user app overrides for granular ERP access.

CREATE TYPE app_access_override AS ENUM ('grant', 'deny');

CREATE TABLE department_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  app_ids TEXT[] NOT NULL DEFAULT '{}',
  is_system BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX idx_department_roles_org ON department_roles(organization_id);

CREATE TABLE organization_member_department_roles (
  member_id UUID NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES department_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (member_id, role_id)
);

CREATE TABLE organization_member_app_overrides (
  member_id UUID NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  access app_access_override NOT NULL,
  PRIMARY KEY (member_id, app_id)
);

ALTER TABLE department_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_member_department_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_member_app_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY department_roles_select ON department_roles FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY department_roles_write ON department_roles FOR ALL
  USING (public.user_can_manage(organization_id))
  WITH CHECK (public.user_can_manage(organization_id));

CREATE POLICY member_dept_roles_select ON organization_member_department_roles FOR SELECT
  USING (
    member_id IN (
      SELECT id FROM organization_members
      WHERE organization_id IN (SELECT public.user_organization_ids())
    )
  );

CREATE POLICY member_dept_roles_write ON organization_member_department_roles FOR ALL
  USING (
    member_id IN (
      SELECT id FROM organization_members m
      WHERE public.user_can_manage(m.organization_id)
    )
  )
  WITH CHECK (
    member_id IN (
      SELECT id FROM organization_members m
      WHERE public.user_can_manage(m.organization_id)
    )
  );

CREATE POLICY member_app_overrides_select ON organization_member_app_overrides FOR SELECT
  USING (
    member_id IN (
      SELECT id FROM organization_members
      WHERE organization_id IN (SELECT public.user_organization_ids())
    )
  );

CREATE POLICY member_app_overrides_write ON organization_member_app_overrides FOR ALL
  USING (
    member_id IN (
      SELECT id FROM organization_members m
      WHERE public.user_can_manage(m.organization_id)
    )
  )
  WITH CHECK (
    member_id IN (
      SELECT id FROM organization_members m
      WHERE public.user_can_manage(m.organization_id)
    )
  );

-- Canonical app ids (must match apps/web/src/lib/apps-registry.ts).
CREATE OR REPLACE FUNCTION public.all_erp_app_ids()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'dashboard', 'pos', 'sales', 'invoicing', 'crm', 'customers', 'refunds', 'credits', 'receivables',
    'products', 'inventory', 'purchasing', 'manufacturing',
    'accounting', 'expenses', 'reports', 'documents',
    'hr', 'recruitment', 'timeoff', 'projects', 'helpdesk',
    'stores', 'team', 'settings'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.cashier_default_app_ids()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'dashboard', 'pos', 'sales', 'customers', 'products', 'inventory',
    'credits', 'receivables', 'crm', 'timeoff', 'helpdesk', 'projects'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.seed_department_roles(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO department_roles (organization_id, code, name, description, app_ids, is_system) VALUES
    (p_org_id, 'hr_manager', 'HR Manager', 'Employees, recruitment, and leave',
      ARRAY['hr', 'recruitment', 'timeoff', 'documents'], true),
    (p_org_id, 'finance_manager', 'Finance Manager', 'Accounting, expenses, invoicing, and reports',
      ARRAY['accounting', 'expenses', 'invoicing', 'reports', 'documents', 'credits', 'receivables'], true),
    (p_org_id, 'inventory_manager', 'Inventory Manager', 'Products, stock, purchasing, and manufacturing',
      ARRAY['products', 'inventory', 'purchasing', 'manufacturing', 'documents'], true),
    (p_org_id, 'sales_manager', 'Sales Manager', 'POS, sales, CRM, and customer billing',
      ARRAY['pos', 'sales', 'invoicing', 'crm', 'customers', 'refunds', 'credits', 'receivables'], true),
    (p_org_id, 'operations_manager', 'Operations Manager', 'Projects, helpdesk, and store setup',
      ARRAY['projects', 'helpdesk', 'documents', 'stores'], true),
    (p_org_id, 'full_admin', 'Full Admin', 'All applications including team and settings',
      public.all_erp_app_ids(), true)
  ON CONFLICT (organization_id, code) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.member_uses_custom_permissions(p_member_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_member_department_roles WHERE member_id = p_member_id
  ) OR EXISTS (
    SELECT 1 FROM organization_member_app_overrides WHERE member_id = p_member_id
  );
$$;

CREATE OR REPLACE FUNCTION public.resolve_member_app_ids(p_member_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member organization_members%ROWTYPE;
  v_apps TEXT[];
  v_has_custom BOOLEAN;
BEGIN
  SELECT * INTO v_member FROM organization_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RETURN '{}'::TEXT[];
  END IF;

  IF v_member.role = 'owner' THEN
    RETURN public.all_erp_app_ids();
  END IF;

  v_has_custom := public.member_uses_custom_permissions(p_member_id);

  IF NOT v_has_custom THEN
    IF v_member.role = 'manager' THEN
      RETURN public.all_erp_app_ids();
    END IF;
    RETURN public.cashier_default_app_ids();
  END IF;

  SELECT COALESCE(array_agg(DISTINCT a ORDER BY a), '{}'::TEXT[])
  INTO v_apps
  FROM (
    SELECT unnest(dr.app_ids) AS a
    FROM organization_member_department_roles mdr
    JOIN department_roles dr ON dr.id = mdr.role_id
    WHERE mdr.member_id = p_member_id
  ) role_apps;

  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::TEXT[])
  INTO v_apps
  FROM (
    SELECT unnest(v_apps) AS x
    UNION
    SELECT o.app_id
    FROM organization_member_app_overrides o
    WHERE o.member_id = p_member_id AND o.access = 'grant'
  ) merged;

  SELECT COALESCE(array_agg(a ORDER BY a), '{}'::TEXT[])
  INTO v_apps
  FROM unnest(v_apps) AS a
  WHERE a NOT IN (
    SELECT o.app_id
    FROM organization_member_app_overrides o
    WHERE o.member_id = p_member_id AND o.access = 'deny'
  );

  IF NOT ('dashboard' = ANY(v_apps)) THEN
    v_apps := array_append(v_apps, 'dashboard');
  END IF;

  RETURN v_apps;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_member_manage_app_ids(p_member_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member organization_members%ROWTYPE;
  v_accessible TEXT[];
  v_role_apps TEXT[];
BEGIN
  SELECT * INTO v_member FROM organization_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RETURN '{}'::TEXT[];
  END IF;

  v_accessible := public.resolve_member_app_ids(p_member_id);

  IF v_member.role = 'owner' THEN
    RETURN v_accessible;
  END IF;

  IF v_member.role = 'manager' THEN
    RETURN v_accessible;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT a ORDER BY a), '{}'::TEXT[])
  INTO v_role_apps
  FROM (
    SELECT unnest(dr.app_ids) AS a
    FROM organization_member_department_roles mdr
    JOIN department_roles dr ON dr.id = mdr.role_id
    WHERE mdr.member_id = p_member_id
  ) role_apps;

  SELECT COALESCE(array_agg(a ORDER BY a), '{}'::TEXT[])
  INTO v_role_apps
  FROM unnest(v_role_apps) AS a
  WHERE a = ANY(v_accessible);

  RETURN v_role_apps;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_app_permissions()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member organization_members%ROWTYPE;
BEGIN
  SELECT m.* INTO v_member
  FROM organization_members m
  WHERE m.user_id = auth.uid() AND m.is_active = true
  ORDER BY m.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'member_id', NULL,
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

GRANT EXECUTE ON FUNCTION public.get_my_app_permissions TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_department_roles TO authenticated;

CREATE OR REPLACE FUNCTION public.save_member_permissions(
  p_member_id UUID,
  p_department_role_ids UUID[],
  p_overrides JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member organization_members%ROWTYPE;
  v_override JSONB;
  v_app_id TEXT;
  v_access TEXT;
  v_role_id UUID;
  v_valid_apps TEXT[];
BEGIN
  SELECT * INTO v_member FROM organization_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF v_member.role = 'owner' THEN
    RAISE EXCEPTION 'Cannot change owner permissions';
  END IF;

  IF NOT public.user_can_manage(v_member.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_valid_apps := public.all_erp_app_ids();

  IF p_department_role_ids IS NOT NULL THEN
    FOREACH v_role_id IN ARRAY p_department_role_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM department_roles
        WHERE id = v_role_id AND organization_id = v_member.organization_id
      ) THEN
        RAISE EXCEPTION 'Invalid department role';
      END IF;
    END LOOP;
  END IF;

  DELETE FROM organization_member_department_roles WHERE member_id = p_member_id;
  IF p_department_role_ids IS NOT NULL THEN
    INSERT INTO organization_member_department_roles (member_id, role_id)
    SELECT p_member_id, unnest(p_department_role_ids)
    ON CONFLICT DO NOTHING;
  END IF;

  DELETE FROM organization_member_app_overrides WHERE member_id = p_member_id;

  IF p_overrides IS NOT NULL AND jsonb_typeof(p_overrides) = 'array' THEN
    FOR v_override IN SELECT * FROM jsonb_array_elements(p_overrides) LOOP
      v_app_id := v_override->>'app_id';
      v_access := v_override->>'access';
      IF v_app_id IS NULL OR v_app_id = 'dashboard' THEN
        CONTINUE;
      END IF;
      IF NOT (v_app_id = ANY(v_valid_apps)) THEN
        RAISE EXCEPTION 'Invalid app id: %', v_app_id;
      END IF;
      IF v_access NOT IN ('grant', 'deny') THEN
        RAISE EXCEPTION 'Invalid access override';
      END IF;
      INSERT INTO organization_member_app_overrides (member_id, app_id, access)
      VALUES (p_member_id, v_app_id, v_access::app_access_override);
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_member_permissions TO authenticated;

-- Seed roles for existing orgs and hook into org creation.
SELECT public.seed_department_roles(id) FROM organizations;

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

  IF v_is_first THEN
    INSERT INTO platform_admins (user_id) VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  PERFORM public.ensure_default_accounts(v_org_id);
  PERFORM public.seed_department_roles(v_org_id);

  RETURN v_org_id;
END;
$$;

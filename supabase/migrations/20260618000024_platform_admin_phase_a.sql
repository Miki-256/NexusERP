-- Phase A: Platform admin roles, audit logs, org detail RPCs.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_admin_role') THEN
    CREATE TYPE platform_admin_role AS ENUM ('super_admin', 'support', 'security');
  END IF;
END $$;

ALTER TABLE platform_admins
  ADD COLUMN IF NOT EXISTS role platform_admin_role NOT NULL DEFAULT 'super_admin';

UPDATE platform_admins SET role = 'super_admin' WHERE role IS NULL;

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_org ON platform_audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON platform_audit_logs(action, created_at DESC);

ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;

-- Internal helper — not granted to authenticated directly.
CREATE OR REPLACE FUNCTION public.log_platform_audit(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_organization_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO platform_audit_logs (
    actor_user_id, actor_email, action, entity_type, entity_id, organization_id, payload
  ) VALUES (
    auth.uid(), v_email, p_action, p_entity_type, p_entity_id, p_organization_id, COALESCE(p_payload, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_platform_admin_role()
RETURNS platform_admin_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pa.role
  FROM platform_admins pa
  WHERE pa.user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_can_read()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_can_write()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_admins
    WHERE user_id = auth.uid()
      AND role IN ('super_admin', 'support')
  );
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_can_manage_admins()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_admins
    WHERE user_id = auth.uid()
      AND role = 'super_admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.platform_admin_can_manage_admins TO authenticated;

DROP POLICY IF EXISTS platform_audit_logs_select ON platform_audit_logs;
CREATE POLICY platform_audit_logs_select ON platform_audit_logs FOR SELECT
  USING (public.platform_admin_can_read());

-- Backward-compatible alias.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.platform_admin_can_read();
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_admin_role TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_can_read TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_can_write TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_can_manage_admins TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_my_role()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role platform_admin_role;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RETURN jsonb_build_object('is_admin', false);
  END IF;

  v_role := public.get_platform_admin_role();

  RETURN jsonb_build_object(
    'is_admin', true,
    'role', v_role,
    'can_write', public.platform_admin_can_write(),
    'can_manage_admins', public.platform_admin_can_manage_admins()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_my_role TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_pending_organizations()
RETURNS TABLE (
  id UUID,
  name TEXT,
  status org_status,
  plan TEXT,
  currency TEXT,
  member_count BIGINT,
  owner_email TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.name,
    o.status,
    o.plan,
    o.currency,
    (SELECT COUNT(*) FROM organization_members m WHERE m.organization_id = o.id) AS member_count,
    (
      SELECT u.email::text
      FROM organization_members m
      JOIN auth.users u ON u.id = m.user_id
      WHERE m.organization_id = o.id AND m.role = 'owner'
      ORDER BY m.created_at
      LIMIT 1
    ) AS owner_email,
    o.created_at
  FROM organizations o
  WHERE public.platform_admin_can_read()
    AND o.status = 'pending'
  ORDER BY o.created_at ASC;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_organizations TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_organization_detail(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_members JSONB;
  v_stores JSONB;
  v_status_history JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'member_id', m.id,
        'user_id', m.user_id,
        'email', u.email,
        'role', m.role,
        'is_active', m.is_active,
        'joined_at', m.created_at
      )
      ORDER BY m.created_at
    ),
    '[]'::jsonb
  ) INTO v_members
  FROM organization_members m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = p_org_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'store_id', s.id,
        'name', s.name,
        'created_at', s.created_at
      )
      ORDER BY s.name
    ),
    '[]'::jsonb
  ) INTO v_stores
  FROM stores s
  WHERE s.organization_id = p_org_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'action', l.action,
        'actor_email', l.actor_email,
        'payload', l.payload,
        'created_at', l.created_at
      )
      ORDER BY l.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_status_history
  FROM platform_audit_logs l
  WHERE l.organization_id = p_org_id
    AND l.entity_type = 'organization'
    AND l.action IN ('org.approve', 'org.suspend', 'org.reject', 'org.reactivate');

  RETURN jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'status', v_org.status,
      'plan', v_org.plan,
      'currency', v_org.currency,
      'timezone', v_org.timezone,
      'tax_rate', v_org.tax_rate,
      'created_at', v_org.created_at,
      'updated_at', v_org.updated_at
    ),
    'members', v_members,
    'stores', v_stores,
    'status_history', v_status_history,
    'stats', jsonb_build_object(
      'sales_count', (SELECT COUNT(*) FROM sales WHERE organization_id = p_org_id AND status = 'completed'),
      'sales_total', (SELECT COALESCE(SUM(total), 0) FROM sales WHERE organization_id = p_org_id AND status = 'completed')
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_organization_detail TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_platform_audit_logs(
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0,
  p_organization_id UUID DEFAULT NULL,
  p_action TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_total BIGINT;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM platform_audit_logs l
  WHERE (p_organization_id IS NULL OR l.organization_id = p_organization_id)
    AND (p_action IS NULL OR l.action = p_action);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'actor_user_id', x.actor_user_id,
        'actor_email', x.actor_email,
        'action', x.action,
        'entity_type', x.entity_type,
        'entity_id', x.entity_id,
        'organization_id', x.organization_id,
        'payload', x.payload,
        'created_at', x.created_at
      )
      ORDER BY x.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_rows
  FROM (
    SELECT l.*
    FROM platform_audit_logs l
    WHERE (p_organization_id IS NULL OR l.organization_id = p_organization_id)
      AND (p_action IS NULL OR l.action = p_action)
    ORDER BY l.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    OFFSET GREATEST(0, p_offset)
  ) x;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_platform_audit_logs TO authenticated;

-- ---------------------------------------------------------------------------
-- Patch existing admin RPCs to audit + enforce role tiers.
-- DROP first when OUT/return signatures changed (CREATE OR REPLACE is not enough).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_list_platform_admins();
DROP FUNCTION IF EXISTS public.admin_grant_platform_admin(TEXT);
DROP FUNCTION IF EXISTS public.admin_grant_platform_admin(TEXT, platform_admin_role);
DROP FUNCTION IF EXISTS public.admin_set_platform_admin_role(UUID, platform_admin_role);

CREATE OR REPLACE FUNCTION public.admin_set_org_status(p_org_id UUID, p_status org_status)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old org_status;
  v_action TEXT;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT status INTO v_old FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  UPDATE organizations SET status = p_status, updated_at = now() WHERE id = p_org_id;

  v_action := CASE p_status
    WHEN 'active' THEN 'org.approve'
    WHEN 'suspended' THEN 'org.suspend'
    WHEN 'pending' THEN 'org.reactivate'
    ELSE 'org.status_change'
  END;

  PERFORM public.log_platform_audit(
    v_action,
    'organization',
    p_org_id,
    p_org_id,
    jsonb_build_object('from', v_old, 'to', p_status)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_platform_admins()
RETURNS TABLE (user_id UUID, email TEXT, role platform_admin_role, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pa.user_id, u.email::text, pa.role, pa.created_at
  FROM platform_admins pa
  JOIN auth.users u ON u.id = pa.user_id
  WHERE public.platform_admin_can_read()
  ORDER BY pa.created_at;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_platform_admin(
  p_email TEXT,
  p_role platform_admin_role DEFAULT 'support'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NOT public.platform_admin_can_manage_admins() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_role = 'super_admin' AND NOT public.platform_admin_can_manage_admins() THEN
    RAISE EXCEPTION 'Only super admins can grant super admin role';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found with email %', p_email;
  END IF;

  INSERT INTO platform_admins (user_id, role) VALUES (v_user_id, p_role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  PERFORM public.log_platform_audit(
    'admin.grant',
    'platform_admin',
    v_user_id,
    NULL,
    jsonb_build_object('email', trim(p_email), 'role', p_role)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_platform_admin(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF NOT public.platform_admin_can_manage_admins() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF (SELECT COUNT(*) FROM platform_admins) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last platform admin';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;

  DELETE FROM platform_admins WHERE user_id = p_user_id;

  PERFORM public.log_platform_audit(
    'admin.revoke',
    'platform_admin',
    p_user_id,
    NULL,
    jsonb_build_object('email', v_email)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_platform_admin_role(
  p_user_id UUID,
  p_role platform_admin_role
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_old platform_admin_role;
BEGIN
  IF NOT public.platform_admin_can_manage_admins() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT role, (SELECT email FROM auth.users WHERE id = p_user_id)
  INTO v_old, v_email
  FROM platform_admins
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Platform admin not found';
  END IF;

  UPDATE platform_admins SET role = p_role WHERE user_id = p_user_id;

  PERFORM public.log_platform_audit(
    'admin.role_change',
    'platform_admin',
    p_user_id,
    NULL,
    jsonb_build_object('email', v_email, 'from', v_old, 'to', p_role)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_admin_role TO authenticated;

-- Audit data imports.
CREATE OR REPLACE FUNCTION public.admin_import_customers(p_org_id UUID, p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_imported INT := 0;
  v_skipped INT := 0;
  v_phone TEXT;
  v_result JSONB;
BEGIN
  IF NOT (public.platform_admin_can_write() OR public.user_can_manage(p_org_id)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_phone := NULLIF(trim(v_row->>'phone'), '');

    IF v_phone IS NOT NULL AND EXISTS (
      SELECT 1 FROM customers WHERE organization_id = p_org_id AND phone = v_phone
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO customers (organization_id, name, phone, email, address, notes)
    VALUES (
      p_org_id,
      NULLIF(trim(v_row->>'name'), ''),
      v_phone,
      NULLIF(trim(v_row->>'email'), ''),
      NULLIF(trim(v_row->>'address'), ''),
      NULLIF(trim(v_row->>'notes'), '')
    );
    v_imported := v_imported + 1;
  END LOOP;

  v_result := jsonb_build_object('imported', v_imported, 'skipped', v_skipped);

  IF public.platform_admin_can_read() THEN
    PERFORM public.log_platform_audit(
      'import.customers',
      'organization',
      p_org_id,
      p_org_id,
      v_result || jsonb_build_object('row_count', jsonb_array_length(p_rows))
    );
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_import_products(
  p_org_id UUID,
  p_rows JSONB,
  p_store_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_imported INT := 0;
  v_skipped INT := 0;
  v_name TEXT;
  v_sku TEXT;
  v_cat TEXT;
  v_cat_id UUID;
  v_product_id UUID;
  v_variant_id UUID;
  v_qty NUMERIC;
  v_sell NUMERIC;
  v_cost NUMERIC;
  v_result JSONB;
BEGIN
  IF NOT (public.platform_admin_can_write() OR public.user_can_manage(p_org_id)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_name := NULLIF(trim(v_row->>'name'), '');
    IF v_name IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_sku := NULLIF(trim(v_row->>'sku'), '');
    v_sell := COALESCE((v_row->>'sell_price')::NUMERIC, 0);
    v_cost := COALESCE((v_row->>'cost_price')::NUMERIC, 0);
    v_qty := COALESCE((v_row->>'quantity')::NUMERIC, 0);

    IF v_sku IS NOT NULL AND EXISTS (
      SELECT 1 FROM products WHERE organization_id = p_org_id AND sku = v_sku
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    ELSIF v_sku IS NULL AND EXISTS (
      SELECT 1 FROM products WHERE organization_id = p_org_id AND name = v_name
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_cat := NULLIF(trim(v_row->>'category'), '');
    v_cat_id := NULL;
    IF v_cat IS NOT NULL THEN
      SELECT id INTO v_cat_id FROM categories WHERE organization_id = p_org_id AND name = v_cat;
      IF v_cat_id IS NULL THEN
        INSERT INTO categories (organization_id, name) VALUES (p_org_id, v_cat)
        RETURNING id INTO v_cat_id;
      END IF;
    END IF;

    INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
    VALUES (p_org_id, v_cat_id, v_name, v_sku, NULLIF(trim(v_row->>'barcode'), ''), v_sell, v_cost)
    RETURNING id INTO v_product_id;

    INSERT INTO product_variants (product_id, organization_id, name, sku, sell_price, cost_price)
    VALUES (v_product_id, p_org_id, 'Default', v_sku, v_sell, v_cost)
    RETURNING id INTO v_variant_id;

    IF p_store_id IS NOT NULL AND v_qty <> 0 THEN
      INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
      VALUES (p_store_id, v_variant_id, p_org_id, v_qty)
      ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;
    END IF;

    v_imported := v_imported + 1;
  END LOOP;

  v_result := jsonb_build_object('imported', v_imported, 'skipped', v_skipped);

  IF public.platform_admin_can_read() THEN
    PERFORM public.log_platform_audit(
      'import.products',
      'organization',
      p_org_id,
      p_org_id,
      v_result || jsonb_build_object('row_count', jsonb_array_length(p_rows), 'store_id', p_store_id)
    );
  END IF;

  RETURN v_result;
END;
$$;

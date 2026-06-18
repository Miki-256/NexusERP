-- Phase 5: Super Admin console (server-enforced) + Base44 data migration tools.
-- Builds on platform_admins / is_platform_admin() from the Phase 0 hardening.

-- ---------------------------------------------------------------------------
-- Platform-wide metrics for the Super Admin dashboard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_platform_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'org_count',        (SELECT COUNT(*) FROM organizations),
    'orgs_active',      (SELECT COUNT(*) FROM organizations WHERE status = 'active'),
    'orgs_pending',     (SELECT COUNT(*) FROM organizations WHERE status = 'pending'),
    'orgs_suspended',   (SELECT COUNT(*) FROM organizations WHERE status = 'suspended'),
    'member_count',     (SELECT COUNT(*) FROM organization_members WHERE is_active),
    'sales_count',      (SELECT COUNT(*) FROM sales WHERE status = 'completed'),
    'sales_total',      (SELECT COALESCE(SUM(total), 0) FROM sales WHERE status = 'completed'),
    'admin_count',      (SELECT COUNT(*) FROM platform_admins)
  ) INTO v;

  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_platform_stats TO authenticated;

-- ---------------------------------------------------------------------------
-- Platform-admin management.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_platform_admins()
RETURNS TABLE (user_id UUID, email TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pa.user_id, u.email::text, pa.created_at
  FROM platform_admins pa
  JOIN auth.users u ON u.id = pa.user_id
  WHERE public.is_platform_admin()
  ORDER BY pa.created_at;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_platform_admins TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_grant_platform_admin(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found with email %', p_email;
  END IF;

  INSERT INTO platform_admins (user_id) VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_grant_platform_admin TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_platform_admin(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF (SELECT COUNT(*) FROM platform_admins) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last platform admin';
  END IF;
  DELETE FROM platform_admins WHERE user_id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_revoke_platform_admin TO authenticated;

-- Platform-admin: list stores for any org (members get this via RLS already,
-- but platform admins are not members of every org).
CREATE OR REPLACE FUNCTION public.admin_list_stores(p_org_id UUID)
RETURNS TABLE (id UUID, name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name
  FROM stores s
  WHERE s.organization_id = p_org_id
    AND (public.is_platform_admin() OR public.user_can_manage(p_org_id))
  ORDER BY s.name;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_stores TO authenticated;

-- ---------------------------------------------------------------------------
-- Base44 data migration: import customers into an organization.
-- p_rows: [{name, phone, email, address, notes}] ; dedupes on phone when present.
-- Callable by a platform admin or a manager of the target org.
-- ---------------------------------------------------------------------------
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
BEGIN
  IF NOT (public.is_platform_admin() OR public.user_can_manage(p_org_id)) THEN
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

  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_import_customers TO authenticated;

-- ---------------------------------------------------------------------------
-- Base44 data migration: import products (+ default variant + optional stock).
-- p_rows: [{name, sku, barcode, sell_price, cost_price, category, quantity}]
-- Dedupes on sku (when present) else name. Stock applied to p_store_id if given.
-- ---------------------------------------------------------------------------
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
BEGIN
  IF NOT (public.is_platform_admin() OR public.user_can_manage(p_org_id)) THEN
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

    -- Dedupe
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

    -- Category (upsert by name)
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

  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_import_products TO authenticated;

-- Row Level Security policies

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Organizations
CREATE POLICY org_select ON organizations FOR SELECT
  USING (id IN (SELECT public.user_organization_ids()));

CREATE POLICY org_update ON organizations FOR UPDATE
  USING (public.user_role_in_org(id) = 'owner');

CREATE POLICY org_insert ON organizations FOR INSERT
  WITH CHECK (true);

-- Members
CREATE POLICY members_select ON organization_members FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY members_insert ON organization_members FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY members_update ON organization_members FOR UPDATE
  USING (public.user_can_manage(organization_id));

-- Stores
CREATE POLICY stores_all ON stores FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND (public.user_can_manage(organization_id) OR current_setting('request.jwt.claims', true) IS NOT NULL)
  );

-- Registers
CREATE POLICY registers_all ON registers FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

-- Sessions
CREATE POLICY sessions_all ON register_sessions FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

-- Categories, products, variants
CREATE POLICY categories_all ON categories FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY products_select ON products FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY products_manage ON products FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY products_update ON products FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY products_delete ON products FOR DELETE
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY variants_select ON product_variants FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY variants_manage ON product_variants FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

-- Inventory
CREATE POLICY inventory_select ON inventory_levels FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY inventory_manage ON inventory_levels FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY adjustments_all ON inventory_adjustments FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY receipt_seq ON receipt_sequences FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

-- Sales (cashiers can insert/select)
CREATE POLICY sales_select ON sales FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY sales_insert ON sales FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY sales_update ON sales FOR UPDATE
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY sale_lines_all ON sale_lines FOR ALL
  USING (
    sale_id IN (
      SELECT id FROM sales WHERE organization_id IN (SELECT public.user_organization_ids())
    )
  );

CREATE POLICY payments_all ON payments FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY customers_all ON customers FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY invites_all ON staff_invites FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY audit_select ON audit_logs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

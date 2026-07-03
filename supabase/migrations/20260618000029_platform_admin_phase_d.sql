-- Phase D: Plans & limits, feature flags, platform health, tenant export (no Stripe).

CREATE TABLE IF NOT EXISTS platform_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_stores INT,
  max_members INT,
  max_sales_per_month INT,
  modules JSONB,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_plans (id, name, max_stores, max_members, max_sales_per_month, modules, sort_order)
VALUES
  ('free', 'Free', 1, 3, 500, NULL, 1),
  ('pro', 'Pro', 5, 15, NULL, NULL, 2),
  ('enterprise', 'Enterprise', NULL, NULL, NULL, NULL, 3)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  max_stores = EXCLUDED.max_stores,
  max_members = EXCLUDED.max_members,
  max_sales_per_month = EXCLUDED.max_sales_per_month,
  modules = EXCLUDED.modules,
  sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS platform_feature_flags (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO platform_feature_flags (key, label, description, enabled)
VALUES
  ('module_crm', 'CRM', 'Pipeline and opportunities', true),
  ('module_purchasing', 'Purchasing', 'Purchase orders and vendor bills', true),
  ('module_manufacturing', 'Manufacturing', 'BOM and production orders', true),
  ('module_hr', 'HR & Payroll', 'Employees and payroll runs', true),
  ('module_recruitment', 'Recruitment', 'Jobs and applicants', true),
  ('module_projects', 'Projects', 'Project tasks and delivery', true),
  ('module_helpdesk', 'Helpdesk', 'Support tickets', true),
  ('module_documents', 'Documents', 'File storage and links', true),
  ('module_invoicing', 'Invoicing', 'Customer invoices module', true),
  ('module_receivables', 'Receivables', 'Pay-later customer balances', true)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE platform_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_plans_select ON platform_plans;
CREATE POLICY platform_plans_select ON platform_plans FOR SELECT
  USING (true);

DROP POLICY IF EXISTS platform_feature_flags_select ON platform_feature_flags;
CREATE POLICY platform_feature_flags_select ON platform_feature_flags FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.get_platform_feature_flags()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(key, enabled),
    '{}'::jsonb
  )
  FROM platform_feature_flags;
$$;
GRANT EXECUTE ON FUNCTION public.get_platform_feature_flags TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.admin_list_plans()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'max_stores', p.max_stores,
          'max_members', p.max_members,
          'max_sales_per_month', p.max_sales_per_month,
          'modules', p.modules,
          'org_count', (SELECT COUNT(*) FROM organizations o WHERE o.plan = p.id)
        )
        ORDER BY p.sort_order
      )
      FROM platform_plans p
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_plans TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_org_plan_usage(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_plan platform_plans%ROWTYPE;
  v_stores INT;
  v_members INT;
  v_sales_month INT;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  SELECT * INTO v_plan FROM platform_plans WHERE id = v_org.plan;
  IF NOT FOUND THEN
    SELECT * INTO v_plan FROM platform_plans WHERE id = 'free';
  END IF;

  SELECT COUNT(*) INTO v_stores FROM stores WHERE organization_id = p_org_id;
  SELECT COUNT(*) INTO v_members FROM organization_members WHERE organization_id = p_org_id AND is_active = true;
  SELECT COUNT(*) INTO v_sales_month
  FROM sales
  WHERE organization_id = p_org_id
    AND status = 'completed'
    AND created_at >= date_trunc('month', now());

  RETURN jsonb_build_object(
    'organization_id', v_org.id,
    'plan', v_org.plan,
    'plan_name', v_plan.name,
    'limits', jsonb_build_object(
      'max_stores', v_plan.max_stores,
      'max_members', v_plan.max_members,
      'max_sales_per_month', v_plan.max_sales_per_month,
      'modules', v_plan.modules
    ),
    'usage', jsonb_build_object(
      'stores', v_stores,
      'members', v_members,
      'sales_this_month', v_sales_month
    ),
    'within_limits', jsonb_build_object(
      'stores', v_plan.max_stores IS NULL OR v_stores <= v_plan.max_stores,
      'members', v_plan.max_members IS NULL OR v_members <= v_plan.max_members,
      'sales', v_plan.max_sales_per_month IS NULL OR v_sales_month <= v_plan.max_sales_per_month
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_org_plan_usage TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_org_plan(p_org_id UUID, p_plan TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old TEXT;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM platform_plans WHERE id = p_plan) THEN
    RAISE EXCEPTION 'Unknown plan: %', p_plan;
  END IF;

  SELECT plan INTO v_old FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  UPDATE organizations SET plan = p_plan, updated_at = now() WHERE id = p_org_id;

  PERFORM public.log_platform_audit(
    'org.plan_change',
    'organization',
    p_org_id,
    p_org_id,
    jsonb_build_object('from', v_old, 'to', p_plan)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_org_plan TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_feature_flags()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', f.key,
          'label', f.label,
          'description', f.description,
          'enabled', f.enabled,
          'updated_at', f.updated_at
        )
        ORDER BY f.key
      )
      FROM platform_feature_flags f
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_feature_flags TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_feature_flag(p_key TEXT, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_manage_admins() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE platform_feature_flags
  SET enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
  WHERE key = p_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feature flag not found: %', p_key;
  END IF;

  PERFORM public.log_platform_audit(
    'settings.feature_flag',
    'platform_feature_flags',
    NULL,
    NULL,
    jsonb_build_object('key', p_key, 'enabled', p_enabled)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_feature_flag TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_platform_health()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'organizations', (SELECT COUNT(*) FROM organizations),
    'organization_members', (SELECT COUNT(*) FROM organization_members WHERE is_active),
    'stores', (SELECT COUNT(*) FROM stores),
    'products', (SELECT COUNT(*) FROM products),
    'customers', (SELECT COUNT(*) FROM customers),
    'sales', (SELECT COUNT(*) FROM sales),
    'sales_completed', (SELECT COUNT(*) FROM sales WHERE status = 'completed'),
    'audit_logs', (SELECT COUNT(*) FROM audit_logs),
    'platform_audit_logs', (SELECT COUNT(*) FROM platform_audit_logs),
    'security_events', (SELECT COUNT(*) FROM platform_security_events)
  ) INTO v_counts;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'table_counts', v_counts,
    'estimated_rows', (SELECT SUM((value)::bigint) FROM jsonb_each_text(v_counts)),
    'orgs_by_status', jsonb_build_object(
      'active', (SELECT COUNT(*) FROM organizations WHERE status = 'active'),
      'pending', (SELECT COUNT(*) FROM organizations WHERE status = 'pending'),
      'suspended', (SELECT COUNT(*) FROM organizations WHERE status = 'suspended')
    ),
    'orgs_by_plan', COALESCE(
      (
        SELECT jsonb_object_agg(plan, cnt)
        FROM (
          SELECT plan, COUNT(*) AS cnt
          FROM organizations
          GROUP BY plan
        ) x
      ),
      '{}'::jsonb
    ),
    'recent_org_activity', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'organization_id', o.id,
            'organization_name', o.name,
            'plan', o.plan,
            'status', o.status,
            'last_sale_at', (
              SELECT MAX(s.created_at)
              FROM sales s
              WHERE s.organization_id = o.id AND s.status = 'completed'
            ),
            'sales_count', (SELECT COUNT(*) FROM sales s WHERE s.organization_id = o.id AND s.status = 'completed')
          )
          ORDER BY (
            SELECT MAX(s.created_at)
            FROM sales s
            WHERE s.organization_id = o.id AND s.status = 'completed'
          ) DESC NULLS LAST
        )
        FROM organizations o
        LIMIT 25
      ),
      '[]'::jsonb
    ),
    'inactive_orgs_30d', (
      SELECT COUNT(*)
      FROM organizations o
      WHERE NOT EXISTS (
        SELECT 1 FROM sales s
        WHERE s.organization_id = o.id
          AND s.status = 'completed'
          AND s.created_at >= now() - interval '30 days'
      )
      AND o.status = 'active'
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_platform_health TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_export_organization(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  PERFORM public.log_platform_audit(
    'org.export',
    'organization',
    p_org_id,
    p_org_id,
    jsonb_build_object('name', v_org.name)
  );

  RETURN jsonb_build_object(
    'exported_at', now(),
    'schema_version', 'phase_d_1',
    'organization', to_jsonb(v_org),
    'stores', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM stores s WHERE s.organization_id = p_org_id), '[]'::jsonb),
    'registers', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM registers r WHERE r.organization_id = p_org_id), '[]'::jsonb),
    'members', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'member', to_jsonb(m),
            'email', u.email
          )
        )
        FROM organization_members m
        JOIN auth.users u ON u.id = m.user_id
        WHERE m.organization_id = p_org_id
      ),
      '[]'::jsonb
    ),
    'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM categories c WHERE c.organization_id = p_org_id), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM products p WHERE p.organization_id = p_org_id), '[]'::jsonb),
    'product_variants', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM product_variants v WHERE v.organization_id = p_org_id), '[]'::jsonb),
    'customers', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM customers c WHERE c.organization_id = p_org_id), '[]'::jsonb),
    'sales_summary', jsonb_build_object(
      'total_count', (SELECT COUNT(*) FROM sales WHERE organization_id = p_org_id),
      'completed_count', (SELECT COUNT(*) FROM sales WHERE organization_id = p_org_id AND status = 'completed'),
      'completed_total', (SELECT COALESCE(SUM(total), 0) FROM sales WHERE organization_id = p_org_id AND status = 'completed')
    ),
    'recent_sales', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(s))
        FROM (
          SELECT * FROM sales
          WHERE organization_id = p_org_id
          ORDER BY created_at DESC
          LIMIT 100
        ) s
      ),
      '[]'::jsonb
    ),
    'support_notes', public.admin_list_org_support_notes(p_org_id),
    'plan_usage', public.admin_get_org_plan_usage(p_org_id)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_export_organization TO authenticated;

-- Tenant-side: filter apps by global feature flags
CREATE OR REPLACE FUNCTION public.get_org_enabled_app_ids(p_org_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flags JSONB;
  v_plan_modules JSONB;
  v_plan TEXT;
BEGIN
  v_flags := public.get_platform_feature_flags();

  SELECT plan INTO v_plan FROM organizations WHERE id = p_org_id;
  SELECT modules INTO v_plan_modules FROM platform_plans WHERE id = COALESCE(v_plan, 'free');

  RETURN ARRAY(
    SELECT app_id
    FROM unnest(public.all_erp_app_ids()) AS app_id
    WHERE
      CASE app_id
        WHEN 'crm' THEN COALESCE((v_flags->>'module_crm')::boolean, true)
        WHEN 'purchasing' THEN COALESCE((v_flags->>'module_purchasing')::boolean, true)
        WHEN 'manufacturing' THEN COALESCE((v_flags->>'module_manufacturing')::boolean, true)
        WHEN 'hr' THEN COALESCE((v_flags->>'module_hr')::boolean, true)
        WHEN 'recruitment' THEN COALESCE((v_flags->>'module_recruitment')::boolean, true)
        WHEN 'projects' THEN COALESCE((v_flags->>'module_projects')::boolean, true)
        WHEN 'helpdesk' THEN COALESCE((v_flags->>'module_helpdesk')::boolean, true)
        WHEN 'documents' THEN COALESCE((v_flags->>'module_documents')::boolean, true)
        WHEN 'invoicing' THEN COALESCE((v_flags->>'module_invoicing')::boolean, true)
        WHEN 'receivables' THEN COALESCE((v_flags->>'module_receivables')::boolean, true)
        ELSE true
      END
      AND (
        v_plan_modules IS NULL
        OR app_id = ANY (SELECT jsonb_array_elements_text(v_plan_modules))
      )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_org_enabled_app_ids TO authenticated;

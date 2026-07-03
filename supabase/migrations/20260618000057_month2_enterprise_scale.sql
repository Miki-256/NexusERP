-- Month 2: Enterprise scale — RLS hot-path optimization, POS audit trim, weekly sales archive.

-- ---------------------------------------------------------------------------
-- SUP-004: Faster per-row org access check (replaces IN (SELECT user_organization_ids()))
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_has_org_access(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = auth.uid()
      AND m.organization_id = org_id
      AND m.is_active = true
      AND (o.status IN ('active', 'pending') OR public.is_platform_admin())
  );
$$;

CREATE INDEX IF NOT EXISTS idx_org_members_user_org_active
  ON public.organization_members (user_id, organization_id)
  WHERE is_active = true;

-- Hot tables: sales / POS path
DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales FOR SELECT
  USING (public.user_has_org_access(organization_id));

DROP POLICY IF EXISTS sales_update_manage ON public.sales;
CREATE POLICY sales_update_manage ON public.sales FOR UPDATE
  USING (public.user_has_org_access(organization_id) AND public.user_can_manage(organization_id))
  WITH CHECK (public.user_has_org_access(organization_id) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS sale_lines_select ON public.sale_lines;
CREATE POLICY sale_lines_select ON public.sale_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_lines.sale_id
        AND public.user_has_org_access(s.organization_id)
    )
  );

DROP POLICY IF EXISTS payments_all ON public.payments;
DROP POLICY IF EXISTS payments_select ON public.payments;
DROP POLICY IF EXISTS payments_write ON public.payments;
CREATE POLICY payments_all ON public.payments FOR ALL
  USING (public.user_has_org_access(organization_id))
  WITH CHECK (public.user_has_org_access(organization_id));

-- Catalog + inventory
DROP POLICY IF EXISTS products_select ON public.products;
CREATE POLICY products_select ON public.products FOR SELECT
  USING (public.user_has_org_access(organization_id));

DROP POLICY IF EXISTS products_manage ON public.products;
CREATE POLICY products_manage ON public.products FOR INSERT
  WITH CHECK (public.user_has_org_access(organization_id) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS products_update ON public.products;
CREATE POLICY products_update ON public.products FOR UPDATE
  USING (public.user_has_org_access(organization_id) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS products_delete ON public.products;
CREATE POLICY products_delete ON public.products FOR DELETE
  USING (public.user_has_org_access(organization_id) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS variants_select ON public.product_variants;
CREATE POLICY variants_select ON public.product_variants FOR SELECT
  USING (public.user_has_org_access(organization_id));

DROP POLICY IF EXISTS variants_manage ON public.product_variants;
CREATE POLICY variants_manage ON public.product_variants FOR ALL
  USING (public.user_has_org_access(organization_id))
  WITH CHECK (public.user_has_org_access(organization_id) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS inventory_select ON public.inventory_levels;
CREATE POLICY inventory_select ON public.inventory_levels FOR SELECT
  USING (public.user_has_org_access(organization_id));

DROP POLICY IF EXISTS inventory_manage ON public.inventory_levels;
CREATE POLICY inventory_manage ON public.inventory_levels FOR ALL
  USING (public.user_has_org_access(organization_id))
  WITH CHECK (public.user_has_org_access(organization_id));

DROP POLICY IF EXISTS customers_all ON public.customers;
CREATE POLICY customers_all ON public.customers FOR ALL
  USING (public.user_has_org_access(organization_id))
  WITH CHECK (public.user_has_org_access(organization_id));

DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses FOR SELECT
  USING (public.user_has_org_access(organization_id));

DROP POLICY IF EXISTS org_daily_sales_summary_select ON public.org_daily_sales_summary;
CREATE POLICY org_daily_sales_summary_select ON public.org_daily_sales_summary FOR SELECT
  USING (public.user_has_org_access(organization_id));

-- Archive tables (reporting)
DROP POLICY IF EXISTS sales_archive_select ON public.sales_archive;
CREATE POLICY sales_archive_select ON public.sales_archive FOR SELECT
  USING (public.user_has_org_access(organization_id));

DROP POLICY IF EXISTS sale_lines_archive_select ON public.sale_lines_archive;
CREATE POLICY sale_lines_archive_select ON public.sale_lines_archive FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_archive sa
      WHERE sa.id = sale_lines_archive.sale_id
        AND public.user_has_org_access(sa.organization_id)
    )
  );

DROP POLICY IF EXISTS payments_archive_select ON public.payments_archive;
CREATE POLICY payments_archive_select ON public.payments_archive FOR SELECT
  USING (public.user_has_org_access(organization_id));

-- ---------------------------------------------------------------------------
-- SUP-007: Remove db_activity_log triggers from POS hot tables (audit_logs remains)
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS audit_sales_row_changes ON public.sales;
DROP TRIGGER IF EXISTS audit_payments_row_changes ON public.payments;

-- ---------------------------------------------------------------------------
-- SUP-002: Weekly cold sales archive (Sunday UTC when p_archive_sales IS NULL)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_enterprise_maintenance(
  p_archive_sales BOOLEAN DEFAULT NULL,
  p_sales_min_age_months INT DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summaries INT;
  v_db_log INT;
  v_security INT;
  v_audit INT;
  v_sales INT := 0;
  v_should_archive BOOLEAN;
BEGIN
  v_should_archive := COALESCE(
    p_archive_sales,
    extract(dow FROM now() AT TIME ZONE 'UTC') = 0
  );

  v_summaries := public.refresh_org_daily_summaries(7);
  v_db_log := public.prune_db_activity_log(90);
  v_security := public.archive_old_security_events(180);
  v_audit := public.archive_old_audit_logs(365, 2000);

  IF v_should_archive THEN
    v_sales := public.archive_cold_sales(p_sales_min_age_months, 200);
  END IF;

  RETURN jsonb_build_object(
    'summaries_refreshed', v_summaries,
    'db_activity_log_pruned', v_db_log,
    'security_events_archived', v_security,
    'audit_logs_archived', v_audit,
    'sales_archived', v_sales,
    'sales_archive_ran', v_should_archive,
    'ran_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.run_enterprise_maintenance IS
  'Cron maintenance. p_archive_sales NULL = auto-archive cold sales on Sunday UTC.';

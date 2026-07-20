-- Align organization_feature_flags RLS with Phase C (user_has_org_access).

DROP POLICY IF EXISTS organization_feature_flags_select ON public.organization_feature_flags;
CREATE POLICY organization_feature_flags_select ON public.organization_feature_flags
  FOR SELECT USING (
    public.platform_admin_can_read()
    OR public.user_has_org_access(organization_id)
  );

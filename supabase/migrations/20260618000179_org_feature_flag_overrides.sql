-- Per-tenant feature flag overrides (Support L5 tenancy).

CREATE TABLE IF NOT EXISTS public.organization_feature_flags (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flag_key TEXT NOT NULL REFERENCES public.platform_feature_flags(key) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id, flag_key)
);

CREATE INDEX IF NOT EXISTS idx_org_feature_flags_org
  ON public.organization_feature_flags (organization_id);

ALTER TABLE public.organization_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_feature_flags_select ON public.organization_feature_flags;
CREATE POLICY organization_feature_flags_select ON public.organization_feature_flags
  FOR SELECT USING (
    public.platform_admin_can_read()
    OR organization_id IN (SELECT public.user_organization_ids())
  );

CREATE OR REPLACE FUNCTION public.get_org_feature_flags(p_org_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(
      f.key,
      COALESCE(o.enabled, f.enabled)
    ),
    '{}'::jsonb
  )
  FROM platform_feature_flags f
  LEFT JOIN organization_feature_flags o
    ON o.flag_key = f.key
   AND o.organization_id = p_org_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_feature_flags(UUID) TO authenticated, anon;

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
  v_flags := public.get_org_feature_flags(p_org_id);

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

GRANT EXECUTE ON FUNCTION public.get_org_enabled_app_ids(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_org_feature_flags(p_org_id UUID)
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

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', f.key,
          'label', f.label,
          'description', f.description,
          'global_enabled', f.enabled,
          'override_enabled', o.enabled,
          'effective_enabled', COALESCE(o.enabled, f.enabled),
          'has_override', o.flag_key IS NOT NULL,
          'note', o.note,
          'updated_at', COALESCE(o.updated_at, f.updated_at)
        )
        ORDER BY f.label
      )
      FROM platform_feature_flags f
      LEFT JOIN organization_feature_flags o
        ON o.flag_key = f.key
       AND o.organization_id = p_org_id
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_org_feature_flags(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_org_feature_flag(
  p_org_id UUID,
  p_key TEXT,
  p_enabled BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM platform_feature_flags WHERE key = p_key) THEN
    RAISE EXCEPTION 'Unknown feature flag';
  END IF;

  INSERT INTO organization_feature_flags (
    organization_id, flag_key, enabled, note, updated_at, updated_by
  ) VALUES (
    p_org_id, p_key, p_enabled, NULLIF(trim(COALESCE(p_note, '')), ''), now(), auth.uid()
  )
  ON CONFLICT (organization_id, flag_key) DO UPDATE
  SET
    enabled = EXCLUDED.enabled,
    note = COALESCE(EXCLUDED.note, organization_feature_flags.note),
    updated_at = now(),
    updated_by = auth.uid();

  PERFORM public.log_platform_audit(
    'settings.org_feature_flag',
    'organization_feature_flags',
    p_org_id,
    p_org_id,
    jsonb_build_object('key', p_key, 'enabled', p_enabled, 'note', p_note)
  );

  RETURN public.admin_list_org_feature_flags(p_org_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_org_feature_flag(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_clear_org_feature_flag(
  p_org_id UUID,
  p_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM organization_feature_flags
  WHERE organization_id = p_org_id
    AND flag_key = p_key;

  PERFORM public.log_platform_audit(
    'settings.org_feature_flag_clear',
    'organization_feature_flags',
    p_org_id,
    p_org_id,
    jsonb_build_object('key', p_key)
  );

  RETURN public.admin_list_org_feature_flags(p_org_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_clear_org_feature_flag(UUID, TEXT) TO authenticated;

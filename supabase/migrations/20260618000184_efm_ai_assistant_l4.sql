-- EFM AI Assistant L4 — retention settings + manager purge

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS financial_ai_retention_days INT NOT NULL DEFAULT 90
    CHECK (financial_ai_retention_days >= 0 AND financial_ai_retention_days <= 3650);

COMMENT ON COLUMN public.organizations.financial_ai_retention_days IS
  'Days to retain AI conversations/insights; 0 = keep forever (no automatic purge).';

CREATE OR REPLACE FUNCTION public.get_financial_ai_settings(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;

  RETURN jsonb_build_object(
    'financial_ai_enabled', COALESCE(v_org.financial_ai_enabled, true),
    'financial_ai_provider', COALESCE(v_org.financial_ai_provider, 'internal'),
    'financial_ai_model', COALESCE(v_org.financial_ai_model, 'gpt-4o-mini'),
    'financial_ai_retention_days', COALESCE(v_org.financial_ai_retention_days, 90),
    'llm_configured_note', 'Set FINANCIAL_AI_API_KEY or OPENAI_API_KEY in app env for OpenAI responses.'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_financial_ai_settings(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_financial_ai_settings(
  p_org_id UUID,
  p_financial_ai_enabled BOOLEAN DEFAULT NULL,
  p_financial_ai_provider TEXT DEFAULT NULL,
  p_financial_ai_model TEXT DEFAULT NULL,
  p_financial_ai_retention_days INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_financial_ai_retention_days IS NOT NULL
     AND (p_financial_ai_retention_days < 0 OR p_financial_ai_retention_days > 3650) THEN
    RAISE EXCEPTION 'Retention days must be between 0 and 3650';
  END IF;

  UPDATE organizations SET
    financial_ai_enabled = COALESCE(p_financial_ai_enabled, financial_ai_enabled),
    financial_ai_provider = COALESCE(NULLIF(trim(p_financial_ai_provider), ''), financial_ai_provider),
    financial_ai_model = COALESCE(NULLIF(trim(p_financial_ai_model), ''), financial_ai_model),
    financial_ai_retention_days = COALESCE(p_financial_ai_retention_days, financial_ai_retention_days)
  WHERE id = p_org_id;

  RETURN public.get_financial_ai_settings(p_org_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_financial_ai_settings(UUID, BOOLEAN, TEXT, TEXT, INT) TO authenticated;

-- Drop old 4-arg overload if present (Wave 16 signature)
DROP FUNCTION IF EXISTS public.update_financial_ai_settings(UUID, BOOLEAN, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.purge_financial_ai_history(
  p_org_id UUID,
  p_older_than_days INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INT;
  v_cutoff TIMESTAMPTZ;
  v_deleted_conversations INT := 0;
  v_deleted_insights INT := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_older_than_days IS NULL THEN
    SELECT financial_ai_retention_days INTO v_days
    FROM organizations WHERE id = p_org_id;
    v_days := COALESCE(v_days, 90);
  ELSE
    v_days := p_older_than_days;
  END IF;

  IF v_days <= 0 THEN
    RAISE EXCEPTION 'Retention is unlimited (0). Pass an explicit p_older_than_days > 0 to purge.';
  END IF;

  IF v_days > 3650 THEN
    RAISE EXCEPTION 'older_than_days must be between 1 and 3650';
  END IF;

  v_cutoff := now() - make_interval(days => v_days);

  WITH deleted AS (
    DELETE FROM financial_ai_conversations
    WHERE organization_id = p_org_id
      AND updated_at < v_cutoff
    RETURNING id
  )
  SELECT COUNT(*)::INT INTO v_deleted_conversations FROM deleted;

  WITH deleted AS (
    DELETE FROM financial_ai_insights
    WHERE organization_id = p_org_id
      AND created_at < v_cutoff
    RETURNING id
  )
  SELECT COUNT(*)::INT INTO v_deleted_insights FROM deleted;

  RETURN jsonb_build_object(
    'organization_id', p_org_id,
    'older_than_days', v_days,
    'cutoff', v_cutoff,
    'deleted_conversations', v_deleted_conversations,
    'deleted_insights', v_deleted_insights
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.purge_financial_ai_history(UUID, INT) TO authenticated;

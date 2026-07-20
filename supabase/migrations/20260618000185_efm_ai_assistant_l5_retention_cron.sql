-- EFM AI Assistant L5 — scheduled retention purge (service_role / process-queue)

CREATE OR REPLACE FUNCTION public.run_financial_ai_retention_purge()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org RECORD;
  v_cutoff TIMESTAMPTZ;
  v_deleted_conversations INT;
  v_deleted_insights INT;
  v_orgs_processed INT := 0;
  v_total_conversations INT := 0;
  v_total_insights INT := 0;
  v_details JSONB := '[]'::jsonb;
BEGIN
  FOR v_org IN
    SELECT id, financial_ai_retention_days
    FROM organizations
    WHERE COALESCE(financial_ai_retention_days, 90) > 0
  LOOP
    v_cutoff := now() - make_interval(days => LEAST(v_org.financial_ai_retention_days, 3650));

    WITH deleted AS (
      DELETE FROM financial_ai_conversations
      WHERE organization_id = v_org.id
        AND updated_at < v_cutoff
      RETURNING id
    )
    SELECT COUNT(*)::INT INTO v_deleted_conversations FROM deleted;

    WITH deleted AS (
      DELETE FROM financial_ai_insights
      WHERE organization_id = v_org.id
        AND created_at < v_cutoff
      RETURNING id
    )
    SELECT COUNT(*)::INT INTO v_deleted_insights FROM deleted;

    IF v_deleted_conversations > 0 OR v_deleted_insights > 0 THEN
      v_orgs_processed := v_orgs_processed + 1;
      v_total_conversations := v_total_conversations + v_deleted_conversations;
      v_total_insights := v_total_insights + v_deleted_insights;
      v_details := v_details || jsonb_build_array(
        jsonb_build_object(
          'organization_id', v_org.id,
          'retention_days', v_org.financial_ai_retention_days,
          'deleted_conversations', v_deleted_conversations,
          'deleted_insights', v_deleted_insights
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'orgs_touched', v_orgs_processed,
    'deleted_conversations', v_total_conversations,
    'deleted_insights', v_total_insights,
    'details', v_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_financial_ai_retention_purge() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_financial_ai_retention_purge() FROM authenticated;
REVOKE ALL ON FUNCTION public.run_financial_ai_retention_purge() FROM anon;
GRANT EXECUTE ON FUNCTION public.run_financial_ai_retention_purge() TO service_role;

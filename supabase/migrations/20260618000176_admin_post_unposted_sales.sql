-- Platform admin: batch-post eligible unposted sales for a tenant (Health Level 2).

CREATE OR REPLACE FUNCTION public.admin_post_unposted_sales_batch(
  p_org_id UUID,
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID;
  v_posted INT := 0;
  v_skipped INT := 0;
  v_entry_id UUID;
  v_limit INT := GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
  v_remaining INT := 0;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  FOR v_sale_id IN
    SELECT s.id
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.sale_id = s.id AND p.status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.organization_id = s.organization_id
          AND je.source_type = 'sale' AND je.source_id = s.id
      )
    ORDER BY s.created_at ASC
    LIMIT v_limit
  LOOP
    BEGIN
      v_entry_id := public.post_sale_to_ledger_internal(v_sale_id);
      IF v_entry_id IS NOT NULL THEN
        v_posted := v_posted + 1;
        DELETE FROM sale_ledger_post_queue WHERE sale_id = v_sale_id;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  SELECT COUNT(*)::INT INTO v_remaining
  FROM sales s
  WHERE s.organization_id = p_org_id
    AND s.status = 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM payments p
      WHERE p.sale_id = s.id AND p.status = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.organization_id = s.organization_id
        AND je.source_type = 'sale' AND je.source_id = s.id
    );

  RETURN jsonb_build_object(
    'organization_id', p_org_id,
    'posted', v_posted,
    'skipped', v_skipped,
    'remaining', v_remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_post_unposted_sales_batch(UUID, INT) TO authenticated;

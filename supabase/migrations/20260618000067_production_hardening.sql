-- Production hardening: restore RLS lockdown, restrict internal RPC grants, inventory floor.

-- ---------------------------------------------------------------------------
-- payments — read-only for org members; writes via SECURITY DEFINER RPCs
-- (Reverts permissive payments_all from 00057)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS payments_all ON public.payments;
DROP POLICY IF EXISTS payments_select ON public.payments;
DROP POLICY IF EXISTS payments_write ON public.payments;

CREATE POLICY payments_select ON public.payments FOR SELECT
  USING (public.user_has_org_access(organization_id));

-- ---------------------------------------------------------------------------
-- inventory_levels — read for members; writes for managers only
-- (Reverts permissive inventory_manage from 00057)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS inventory_manage ON public.inventory_levels;
DROP POLICY IF EXISTS inventory_insert ON public.inventory_levels;
DROP POLICY IF EXISTS inventory_update ON public.inventory_levels;
DROP POLICY IF EXISTS inventory_delete ON public.inventory_levels;

CREATE POLICY inventory_insert ON public.inventory_levels FOR INSERT
  WITH CHECK (
    public.user_has_org_access(organization_id)
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY inventory_update ON public.inventory_levels FOR UPDATE
  USING (
    public.user_has_org_access(organization_id)
    AND public.user_can_manage(organization_id)
  )
  WITH CHECK (
    public.user_has_org_access(organization_id)
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY inventory_delete ON public.inventory_levels FOR DELETE
  USING (
    public.user_has_org_access(organization_id)
    AND public.user_can_manage(organization_id)
  );

-- ---------------------------------------------------------------------------
-- Internal ledger RPCs — not callable by tenant clients
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.post_sale_to_ledger_internal(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_sale_ledger_post_queue(INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._post_journal_entry_balanced(
  UUID, TEXT, DATE, TEXT, TEXT, UUID, JSONB, UUID, journal_entry_status
) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- adjust_inventory — prevent negative on-hand after adjustment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_inventory(
  p_store_id UUID,
  p_variant_id UUID,
  p_delta NUMERIC,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
  v_new_qty NUMERIC;
BEGIN
  v_user_id := auth.uid();
  SELECT organization_id INTO v_org_id FROM stores WHERE id = p_store_id;

  IF NOT public.user_can_manage(v_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT quantity + p_delta INTO v_new_qty
  FROM inventory_levels
  WHERE store_id = p_store_id AND variant_id = p_variant_id
  FOR UPDATE;

  IF v_new_qty IS NULL THEN
    IF p_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient stock for adjustment';
    END IF;
    v_new_qty := p_delta;
    INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
    VALUES (p_store_id, p_variant_id, v_org_id, v_new_qty);
  ELSE
    IF v_new_qty < 0 THEN
      RAISE EXCEPTION 'Adjustment would result in negative stock (%.2f)', v_new_qty;
    END IF;
    UPDATE inventory_levels
    SET quantity = v_new_qty, updated_at = now()
    WHERE store_id = p_store_id AND variant_id = p_variant_id;
  END IF;

  INSERT INTO inventory_adjustments (store_id, variant_id, organization_id, delta, reason, user_id)
  VALUES (p_store_id, p_variant_id, v_org_id, p_delta, p_reason, v_user_id);

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (v_org_id, v_user_id, 'inventory', p_variant_id, 'adjusted',
    jsonb_build_object('store_id', p_store_id, 'delta', p_delta, 'reason', p_reason));
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_inventory(UUID, UUID, NUMERIC, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Platform health probe (service/cron — no tenant data)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_platform_health_probe()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ledger_pending INT;
  v_webhook_pending INT;
BEGIN
  SELECT COUNT(*)::INT INTO v_ledger_pending FROM sale_ledger_post_queue;
  SELECT COUNT(*)::INT INTO v_webhook_pending
  FROM payment_webhook_queue WHERE processed_at IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'ledger_queue_pending', v_ledger_pending,
    'payment_webhook_queue_pending', v_webhook_pending,
    'checked_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_health_probe() FROM PUBLIC, anon, authenticated;

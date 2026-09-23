-- Durable multi-device offline queue resolution.
-- Lets any org member ask: "is this local queue row already on the server?"
-- Covers lost-response, other-device sync, and stock-conflict fingerprints.

CREATE OR REPLACE FUNCTION public.resolve_offline_queued_sale(
  p_organization_id UUID,
  p_idempotency_key UUID DEFAULT NULL,
  p_store_id UUID DEFAULT NULL,
  p_register_id UUID DEFAULT NULL,
  p_paid_total NUMERIC DEFAULT NULL,
  p_queued_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID;
  v_receipt TEXT;
  v_total NUMERIC;
  v_created TIMESTAMPTZ;
  v_anchor TIMESTAMPTZ := COALESCE(p_queued_at, now());
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required';
  END IF;

  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- 1) Exact idempotency match (preferred)
  IF p_idempotency_key IS NOT NULL THEN
    SELECT s.id, s.receipt_no, s.total
    INTO v_sale_id, v_receipt, v_total
    FROM sales s
    WHERE s.organization_id = p_organization_id
      AND s.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'resolve', 'clear',
        'reason', 'idempotency',
        'sale_id', v_sale_id,
        'receipt_no', v_receipt,
        'total', v_total
      );
    END IF;
  END IF;

  -- 2) Fingerprint: same store/register + paid total near queue time
  --    (handles stock conflicts when another device posted a matching sale)
  IF p_store_id IS NOT NULL
     AND p_register_id IS NOT NULL
     AND p_paid_total IS NOT NULL
     AND p_paid_total > 0 THEN
    SELECT s.id, s.receipt_no, s.total, s.created_at
    INTO v_sale_id, v_receipt, v_total, v_created
    FROM sales s
    WHERE s.organization_id = p_organization_id
      AND s.store_id = p_store_id
      AND s.register_id = p_register_id
      AND s.created_at BETWEEN (v_anchor - interval '36 hours') AND (v_anchor + interval '36 hours')
      AND abs(s.total - p_paid_total) < 0.05
    ORDER BY abs(extract(epoch FROM (s.created_at - v_anchor))) ASC
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'resolve', 'clear',
        'reason', 'fingerprint',
        'sale_id', v_sale_id,
        'receipt_no', v_receipt,
        'total', v_total
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('resolve', 'keep', 'reason', 'none');
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_offline_queued_sale TO authenticated;

COMMENT ON FUNCTION public.resolve_offline_queued_sale IS
  'Multi-device offline sync: decide whether a local queued sale can be cleared because it already exists on the server (idempotency or register/total/time fingerprint).';

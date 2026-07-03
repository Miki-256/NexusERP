-- Tenant audit RPC, webhook queue, org catalog API support.

CREATE TABLE IF NOT EXISTS payment_webhook_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'other',
  amount NUMERIC,
  external_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_queue_ref
  ON payment_webhook_queue(organization_id, reference)
  WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION public.queue_payment_webhook(
  p_organization_id UUID,
  p_reference TEXT,
  p_provider TEXT,
  p_amount NUMERIC,
  p_external_id TEXT,
  p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO payment_webhook_queue (
    organization_id, reference, provider, amount, external_id, payload
  ) VALUES (
    p_organization_id, p_reference, COALESCE(p_provider, 'other'), p_amount, p_external_id, COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_payment_webhook_queue(p_limit INT DEFAULT 50)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row payment_webhook_queue%ROWTYPE;
  v_result JSONB;
  v_processed INT := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM payment_webhook_queue
    WHERE processed_at IS NULL
    ORDER BY created_at
    LIMIT p_limit
  LOOP
    v_result := public.confirm_payment_webhook(
      v_row.organization_id,
      v_row.reference,
      v_row.provider,
      v_row.amount,
      v_row.external_id
    );
    IF COALESCE((v_result->>'matched')::boolean, false) THEN
      UPDATE payment_webhook_queue SET processed_at = now() WHERE id = v_row.id;
      v_processed := v_processed + 1;
    END IF;
  END LOOP;
  RETURN v_processed;
END;
$$;
GRANT EXECUTE ON FUNCTION public.queue_payment_webhook TO service_role;
GRANT EXECUTE ON FUNCTION public.process_payment_webhook_queue TO service_role;

CREATE OR REPLACE FUNCTION public.list_org_audit_logs(
  p_organization_id UUID,
  p_limit INT DEFAULT 200,
  p_offset INT DEFAULT 0,
  p_action TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'created_at') DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', a.id,
          'created_at', a.created_at,
          'action', a.action,
          'entity_type', a.entity_type,
          'entity_id', a.entity_id,
          'user_id', a.user_id,
          'actor_email', u.email,
          'payload', a.payload
        ) AS row_data
        FROM audit_logs a
        LEFT JOIN auth.users u ON u.id = a.user_id
        WHERE a.organization_id = p_organization_id
          AND (p_action IS NULL OR a.action = p_action)
        ORDER BY a.created_at DESC
        LIMIT LEAST(p_limit, 500)
        OFFSET GREATEST(p_offset, 0)
      ) x
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_org_audit_logs TO authenticated;

CREATE OR REPLACE FUNCTION public.get_org_catalog_export(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.user_can_manage(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'exported_at', now(),
    'products', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'description', p.description,
            'sell_price', p.sell_price,
            'tax_rate', p.tax_rate,
            'is_active', p.is_active,
            'reorder_point', p.reorder_point,
            'variants', (
              SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                  'id', v.id,
                  'name', v.name,
                  'barcode', v.barcode,
                  'sell_price', v.sell_price
                )
              ), '[]'::jsonb)
              FROM product_variants v
              WHERE v.product_id = p.id AND v.is_active = true
            )
          )
        )
        FROM products p
        WHERE p.organization_id = p_organization_id AND p.is_active = true
      ),
      '[]'::jsonb
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_org_catalog_export TO authenticated, service_role;

-- Cross-device pending MM alerts + stronger offline queue fingerprinting.
-- 1) Webhook confirm always sets status=completed (heal leftovers)
-- 2) Alerts only count real pending mobile_money in/near the selected range
-- 3) Offline resolve: 7-day fingerprint + store+total fallback

CREATE OR REPLACE FUNCTION public.confirm_payment_webhook(
  p_organization_id UUID,
  p_reference TEXT,
  p_provider TEXT,
  p_amount NUMERIC DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
BEGIN
  SELECT p.* INTO v_payment
  FROM payments p
  WHERE p.organization_id = p_organization_id
    AND p.reference = p_reference
    AND p.method = 'mobile_money'
  ORDER BY p.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'Payment reference not found');
  END IF;

  IF p_amount IS NOT NULL AND abs(v_payment.amount - p_amount) > 0.02 THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'Amount mismatch',
      'expected', v_payment.amount,
      'received', p_amount
    );
  END IF;

  UPDATE payments
  SET webhook_confirmed_at = now(),
      status = 'completed',
      external_id = COALESCE(p_external_id, external_id),
      provider = COALESCE(NULLIF(p_provider, '')::mobile_money_provider, provider)
  WHERE id = v_payment.id;

  PERFORM public.maybe_auto_post_sale(v_payment.sale_id);

  RETURN jsonb_build_object(
    'matched', true,
    'payment_id', v_payment.id,
    'sale_id', v_payment.sale_id,
    'amount', v_payment.amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_webhook TO service_role;

UPDATE payments
SET status = 'completed'
WHERE method = 'mobile_money'
  AND status = 'pending'
  AND webhook_confirmed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sales_register_analytics(
  p_organization_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_store_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_total_sales BIGINT;
  v_void_count BIGINT;
  v_completed_count BIGINT;
  v_discount_total NUMERIC;
  v_gross NUMERIC;
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE s.status = 'voided'),
    COUNT(*) FILTER (WHERE s.status = 'completed'),
    COALESCE(SUM(s.discount_amount) FILTER (WHERE s.status = 'completed'), 0),
    COALESCE(SUM(s.subtotal + s.discount_amount) FILTER (WHERE s.status = 'completed'), 0)
  INTO v_total_sales, v_void_count, v_completed_count, v_discount_total, v_gross
  FROM sales s
  WHERE s.organization_id = p_organization_id
    AND s.created_at >= p_from
    AND s.created_at <= p_to
    AND (p_store_id IS NULL OR s.store_id = p_store_id);

  SELECT jsonb_build_object(
    'daily_trend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', d.day,
        'revenue', d.revenue,
        'count', d.cnt
      ) ORDER BY d.day)
      FROM (
        SELECT
          date_trunc('day', s.created_at)::DATE AS day,
          SUM(s.total) AS revenue,
          COUNT(*) AS cnt
        FROM sales s
        WHERE s.organization_id = p_organization_id
          AND s.status = 'completed'
          AND s.created_at >= p_from
          AND s.created_at <= p_to
          AND (p_store_id IS NULL OR s.store_id = p_store_id)
        GROUP BY 1
        ORDER BY 1
      ) d
    ), '[]'::jsonb),
    'hourly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'hour', h.hr,
        'revenue', h.revenue,
        'count', h.cnt
      ) ORDER BY h.hr)
      FROM (
        SELECT
          EXTRACT(HOUR FROM s.created_at)::INT AS hr,
          SUM(s.total) AS revenue,
          COUNT(*) AS cnt
        FROM sales s
        WHERE s.organization_id = p_organization_id
          AND s.status = 'completed'
          AND s.created_at >= p_from
          AND s.created_at <= p_to
          AND (p_store_id IS NULL OR s.store_id = p_store_id)
        GROUP BY 1
      ) h
    ), '[]'::jsonb),
    'by_store', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', st.name,
        'value', agg.revenue
      ) ORDER BY agg.revenue DESC)
      FROM (
        SELECT s.store_id, SUM(s.total) AS revenue
        FROM sales s
        WHERE s.organization_id = p_organization_id
          AND s.status = 'completed'
          AND s.created_at >= p_from
          AND s.created_at <= p_to
          AND (p_store_id IS NULL OR s.store_id = p_store_id)
        GROUP BY s.store_id
      ) agg
      JOIN stores st ON st.id = agg.store_id
    ), '[]'::jsonb),
    'top_products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', tp.name,
        'quantity', tp.qty,
        'revenue', tp.revenue
      ) ORDER BY tp.revenue DESC)
      FROM (
        SELECT
          sl.product_name AS name,
          SUM(sl.quantity - sl.returned_quantity) AS qty,
          SUM(sl.line_total * (1 - sl.returned_quantity / NULLIF(sl.quantity, 0))) AS revenue
        FROM sale_lines sl
        JOIN sales s ON s.id = sl.sale_id
        WHERE s.organization_id = p_organization_id
          AND s.status IN ('completed', 'returned')
          AND s.created_at >= p_from
          AND s.created_at <= p_to
          AND (p_store_id IS NULL OR s.store_id = p_store_id)
        GROUP BY sl.product_name
        ORDER BY revenue DESC
        LIMIT 10
      ) tp
    ), '[]'::jsonb),
    'top_staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', ps.display_name,
        'revenue', ts.revenue,
        'count', ts.cnt
      ) ORDER BY ts.revenue DESC)
      FROM (
        SELECT s.pos_staff_id, SUM(s.total) AS revenue, COUNT(*) AS cnt
        FROM sales s
        WHERE s.organization_id = p_organization_id
          AND s.status = 'completed'
          AND s.created_at >= p_from
          AND s.created_at <= p_to
          AND s.pos_staff_id IS NOT NULL
          AND (p_store_id IS NULL OR s.store_id = p_store_id)
        GROUP BY s.pos_staff_id
        ORDER BY revenue DESC
        LIMIT 10
      ) ts
      JOIN pos_staff ps ON ps.id = ts.pos_staff_id
    ), '[]'::jsonb),
    'kpis', jsonb_build_object(
      'discount_rate_pct', CASE WHEN v_gross > 0 THEN round((v_discount_total / v_gross) * 100, 1) ELSE 0 END,
      'void_rate_pct', CASE WHEN v_total_sales > 0 THEN round((v_void_count::NUMERIC / v_total_sales) * 100, 1) ELSE 0 END,
      'avg_ticket', CASE WHEN v_completed_count > 0 THEN round(
        (SELECT COALESCE(SUM(total), 0) FROM sales
         WHERE organization_id = p_organization_id AND status = 'completed'
           AND created_at >= p_from AND created_at <= p_to
           AND (p_store_id IS NULL OR store_id = p_store_id)) / v_completed_count, 2
      ) ELSE 0 END
    ),
    'alerts', COALESCE((
      SELECT jsonb_agg(alert ORDER BY (alert->>'severity') DESC)
      FROM (
        SELECT jsonb_build_object(
          'type', 'pending_payments',
          'severity', 'high',
          'message', format('%s sale(s) have pending mobile money payments', cnt),
          'count', cnt
        ) AS alert
        FROM (
          SELECT COUNT(DISTINCT s.id) AS cnt
          FROM sales s
          JOIN payments p ON p.sale_id = s.id
          WHERE s.organization_id = p_organization_id
            AND s.status = 'completed'
            AND p.status = 'pending'
            AND p.method = 'mobile_money'
            AND p.webhook_confirmed_at IS NULL
            AND s.created_at >= p_from - INTERVAL '7 days'
            AND s.created_at <= p_to
            AND (p_store_id IS NULL OR s.store_id = p_store_id)
        ) x
        WHERE cnt > 0
        UNION ALL
        SELECT jsonb_build_object(
          'type', 'high_void_rate',
          'severity', 'medium',
          'message', format('Void rate is %s%% in selected period', round((v_void_count::NUMERIC / NULLIF(v_total_sales, 0)) * 100, 1)),
          'count', v_void_count
        )
        WHERE v_total_sales >= 5
          AND (v_void_count::NUMERIC / v_total_sales) > 0.05
        UNION ALL
        SELECT jsonb_build_object(
          'type', 'high_discount_rate',
          'severity', 'medium',
          'message', format('Discount rate is %s%% of gross merchandise', round((v_discount_total / NULLIF(v_gross, 0)) * 100, 1)),
          'count', 0
        )
        WHERE v_gross > 0 AND (v_discount_total / v_gross) > 0.15
      ) alerts
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sales_register_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

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
      AND s.created_at BETWEEN (v_anchor - interval '7 days') AND (v_anchor + interval '7 days')
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

  IF p_store_id IS NOT NULL
     AND p_paid_total IS NOT NULL
     AND p_paid_total > 0 THEN
    SELECT s.id, s.receipt_no, s.total, s.created_at
    INTO v_sale_id, v_receipt, v_total, v_created
    FROM sales s
    WHERE s.organization_id = p_organization_id
      AND s.store_id = p_store_id
      AND s.status = 'completed'
      AND s.created_at BETWEEN (v_anchor - interval '7 days') AND (v_anchor + interval '7 days')
      AND abs(s.total - p_paid_total) < 0.05
    ORDER BY abs(extract(epoch FROM (s.created_at - v_anchor))) ASC
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'resolve', 'clear',
        'reason', 'fingerprint_store',
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

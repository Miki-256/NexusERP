-- Sales register: list/analytics RPCs, back-office returns & payment confirm, customer 360

-- ---------------------------------------------------------------------------
-- customer_summary: prefer customer_id, fallback phone match
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.customer_summary(p_org_id UUID)
RETURNS TABLE (
  customer_id UUID,
  name TEXT,
  phone TEXT,
  email TEXT,
  total_spent NUMERIC,
  order_count BIGINT,
  last_order TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    c.phone,
    c.email,
    COALESCE(SUM(s.total), 0),
    COUNT(s.id),
    MAX(s.created_at)
  FROM customers c
  LEFT JOIN sales s ON s.organization_id = c.organization_id
    AND s.status = 'completed'
    AND (
      s.customer_id = c.id
      OR (
        s.customer_id IS NULL
        AND c.phone IS NOT NULL
        AND s.customer_phone IS NOT NULL
        AND s.customer_phone = c.phone
      )
    )
  WHERE c.organization_id = p_org_id
  GROUP BY c.id, c.name, c.phone, c.email
  ORDER BY COALESCE(SUM(s.total), 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.customer_summary(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Customer purchase history
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_customer_purchases(
  p_customer_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  sale_id UUID,
  receipt_no TEXT,
  total NUMERIC,
  status sale_status,
  store_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_phone TEXT;
BEGIN
  SELECT organization_id, phone INTO v_org, v_phone
  FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT public.user_has_org_access(v_org) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.receipt_no,
    s.total,
    s.status,
    st.name,
    s.created_at
  FROM sales s
  LEFT JOIN stores st ON st.id = s.store_id
  WHERE s.organization_id = v_org
    AND s.status = 'completed'
    AND (
      s.customer_id = p_customer_id
      OR (
        s.customer_id IS NULL
        AND v_phone IS NOT NULL
        AND s.customer_phone = v_phone
      )
    )
  ORDER BY s.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_customer_purchases(UUID, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Paginated sales register list
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_sales_register(
  p_organization_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_status TEXT DEFAULT NULL,
  p_store_id UUID DEFAULT NULL,
  p_register_id UUID DEFAULT NULL,
  p_staff_id UUID DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_total BIGINT;
  v_summary JSONB;
  v_q TEXT := NULLIF(trim(p_search), '');
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM sales s
  WHERE s.organization_id = p_organization_id
    AND s.created_at >= p_from
    AND s.created_at <= p_to
    AND (p_status IS NULL OR p_status = 'all' OR s.status::TEXT = p_status)
    AND (p_store_id IS NULL OR s.store_id = p_store_id)
    AND (p_register_id IS NULL OR s.register_id = p_register_id)
    AND (p_staff_id IS NULL OR s.pos_staff_id = p_staff_id)
    AND (
      p_payment_method IS NULL OR p_payment_method = 'all'
      OR EXISTS (
        SELECT 1 FROM payments p
        WHERE p.sale_id = s.id AND p.method::TEXT = p_payment_method
      )
    )
    AND (
      p_payment_status IS NULL OR p_payment_status = 'all'
      OR (
        p_payment_status = 'pending'
        AND EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.status = 'pending')
      )
      OR (
        p_payment_status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.status = 'pending')
      )
    )
    AND (
      v_q IS NULL
      OR s.receipt_no ILIKE '%' || v_q || '%'
      OR COALESCE(s.customer_name, '') ILIKE '%' || v_q || '%'
      OR COALESCE(s.customer_phone, '') ILIKE '%' || v_q || '%'
      OR EXISTS (
        SELECT 1 FROM stores st
        WHERE st.id = s.store_id AND st.name ILIKE '%' || v_q || '%'
      )
    );

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at' DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', s.id,
      'receipt_no', s.receipt_no,
      'total', s.total,
      'subtotal', s.subtotal,
      'tax_amount', s.tax_amount,
      'discount_amount', s.discount_amount,
      'tip_amount', COALESCE(s.tip_amount, 0),
      'status', s.status,
      'created_at', s.created_at,
      'customer_id', s.customer_id,
      'customer_name', s.customer_name,
      'customer_phone', s.customer_phone,
      'store_id', s.store_id,
      'store_name', st.name,
      'register_id', s.register_id,
      'register_name', r.name,
      'staff_name', ps.display_name,
      'promotion_id', s.promotion_id,
      'has_pending_payment', EXISTS (
        SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.status = 'pending'
      ),
      'payments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'method', p.method,
          'amount', p.amount,
          'status', p.status
        ) ORDER BY p.created_at)
        FROM payments p WHERE p.sale_id = s.id
      ), '[]'::jsonb)
    ) AS row
    FROM sales s
    LEFT JOIN stores st ON st.id = s.store_id
    LEFT JOIN registers r ON r.id = s.register_id
    LEFT JOIN pos_staff ps ON ps.id = s.pos_staff_id
    WHERE s.organization_id = p_organization_id
      AND s.created_at >= p_from
      AND s.created_at <= p_to
      AND (p_status IS NULL OR p_status = 'all' OR s.status::TEXT = p_status)
      AND (p_store_id IS NULL OR s.store_id = p_store_id)
      AND (p_register_id IS NULL OR s.register_id = p_register_id)
      AND (p_staff_id IS NULL OR s.pos_staff_id = p_staff_id)
      AND (
        p_payment_method IS NULL OR p_payment_method = 'all'
        OR EXISTS (
          SELECT 1 FROM payments p
          WHERE p.sale_id = s.id AND p.method::TEXT = p_payment_method
        )
      )
      AND (
        p_payment_status IS NULL OR p_payment_status = 'all'
        OR (
          p_payment_status = 'pending'
          AND EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.status = 'pending')
        )
        OR (
          p_payment_status = 'completed'
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.status = 'pending')
        )
      )
      AND (
        v_q IS NULL
        OR s.receipt_no ILIKE '%' || v_q || '%'
        OR COALESCE(s.customer_name, '') ILIKE '%' || v_q || '%'
        OR COALESCE(s.customer_phone, '') ILIKE '%' || v_q || '%'
        OR st.name ILIKE '%' || v_q || '%'
      )
    ORDER BY s.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) sub;

  SELECT jsonb_build_object(
    'count', COUNT(*) FILTER (WHERE s.status = 'completed'),
    'gross', COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed'), 0),
    'tax', COALESCE(SUM(s.tax_amount) FILTER (WHERE s.status = 'completed'), 0),
    'discounts', COALESCE(SUM(s.discount_amount) FILTER (WHERE s.status = 'completed'), 0),
    'tips', COALESCE(SUM(s.tip_amount) FILTER (WHERE s.status = 'completed'), 0),
    'voided', COUNT(*) FILTER (WHERE s.status = 'voided'),
    'returned', COUNT(*) FILTER (WHERE s.status = 'returned')
  )
  INTO v_summary
  FROM sales s
  LEFT JOIN stores st ON st.id = s.store_id
  WHERE s.organization_id = p_organization_id
    AND s.created_at >= p_from
    AND s.created_at <= p_to
    AND (p_status IS NULL OR p_status = 'all' OR s.status::TEXT = p_status)
    AND (p_store_id IS NULL OR s.store_id = p_store_id)
    AND (p_register_id IS NULL OR s.register_id = p_register_id)
    AND (p_staff_id IS NULL OR s.pos_staff_id = p_staff_id)
    AND (
      p_payment_method IS NULL OR p_payment_method = 'all'
      OR EXISTS (
        SELECT 1 FROM payments p
        WHERE p.sale_id = s.id AND p.method::TEXT = p_payment_method
      )
    )
    AND (
      p_payment_status IS NULL OR p_payment_status = 'all'
      OR (
        p_payment_status = 'pending'
        AND EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.status = 'pending')
      )
      OR (
        p_payment_status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.status = 'pending')
      )
    )
    AND (
      v_q IS NULL
      OR s.receipt_no ILIKE '%' || v_q || '%'
      OR COALESCE(s.customer_name, '') ILIKE '%' || v_q || '%'
      OR COALESCE(s.customer_phone, '') ILIKE '%' || v_q || '%'
      OR st.name ILIKE '%' || v_q || '%'
    );

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'summary', v_summary
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_sales_register(
  UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, UUID, UUID, TEXT, TEXT, TEXT, INT, INT
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Sales analytics + alerts
-- ---------------------------------------------------------------------------

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
            AND s.created_at >= p_from - INTERVAL '7 days'
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

-- ---------------------------------------------------------------------------
-- Sale detail bundle (returns, audit, promotion)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_sale_detail_bundle(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  IF NOT public.user_has_org_access(v_sale.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'sale', to_jsonb(s) || jsonb_build_object(
      'store_name', st.name,
      'store_address', st.address,
      'register_name', r.name,
      'staff_name', ps.display_name,
      'customer_linked_name', c.name,
      'promotion_name', pr.name,
      'promotion_code', pr.code
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(sl.*) ORDER BY sl.product_name)
      FROM sale_lines sl WHERE sl.sale_id = p_sale_id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.created_at)
      FROM payments p WHERE p.sale_id = p_sale_id
    ), '[]'::jsonb),
    'returns', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(sr.*) || jsonb_build_object(
          'lines', COALESCE((
            SELECT jsonb_agg(to_jsonb(srl.*))
            FROM sale_return_lines srl WHERE srl.return_id = sr.id
          ), '[]'::jsonb),
          'staff_name', ps2.display_name
        )
        ORDER BY sr.created_at DESC
      )
      FROM sale_returns sr
      LEFT JOIN pos_staff ps2 ON ps2.id = sr.pos_staff_id
      WHERE sr.original_sale_id = p_sale_id
    ), '[]'::jsonb),
    'audit', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', al.id,
          'action', al.action,
          'created_at', al.created_at,
          'user_id', al.user_id,
          'payload', al.payload
        )
        ORDER BY al.created_at
      )
      FROM audit_logs al
      WHERE al.entity_type = 'sale' AND al.entity_id = p_sale_id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM sales s
  LEFT JOIN stores st ON st.id = s.store_id
  LEFT JOIN registers r ON r.id = s.register_id
  LEFT JOIN pos_staff ps ON ps.id = s.pos_staff_id
  LEFT JOIN customers c ON c.id = s.customer_id
  LEFT JOIN promotions pr ON pr.id = s.promotion_id
  WHERE s.id = p_sale_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sale_detail_bundle(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Back-office confirm pending payment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_sale_payment_backoffice(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF NOT public.user_can_manage(v_payment.organization_id) THEN
    RAISE EXCEPTION 'Only managers can confirm payments';
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment is not pending';
  END IF;

  UPDATE payments
  SET status = 'completed', webhook_confirmed_at = now()
  WHERE id = p_payment_id;

  PERFORM public.maybe_auto_post_sale(v_payment.sale_id);

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_payment.organization_id, v_user_id, 'sale', v_payment.sale_id, 'payment_confirmed',
    jsonb_build_object('payment_id', p_payment_id, 'method', v_payment.method, 'amount', v_payment.amount)
  );

  RETURN jsonb_build_object('payment_id', p_payment_id, 'sale_id', v_payment.sale_id, 'status', 'completed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_sale_payment_backoffice(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Back-office partial return (manager auth user)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.partial_return_sale_backoffice(
  p_sale_id UUID,
  p_lines JSONB,
  p_reason TEXT,
  p_refund_method TEXT DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_user_id UUID;
  v_line JSONB;
  v_sale_line sale_lines%ROWTYPE;
  v_return_id UUID;
  v_return_qty NUMERIC;
  v_available NUMERIC;
  v_refund_subtotal NUMERIC := 0;
  v_refund_tax NUMERIC := 0;
  v_refund_total NUMERIC := 0;
  v_line_refund NUMERIC;
  v_all_returned BOOLEAN := true;
  v_sl sale_lines%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_refund_method NOT IN ('cash', 'store_credit') THEN
    RAISE EXCEPTION 'Invalid refund method';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF NOT public.user_can_manage(v_sale.organization_id) THEN
    RAISE EXCEPTION 'Only managers can process returns';
  END IF;

  IF v_sale.status NOT IN ('completed', 'returned') THEN
    RAISE EXCEPTION 'Sale cannot be returned';
  END IF;

  IF p_refund_method = 'store_credit' AND v_sale.customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer required for store credit refund';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Select at least one line to return';
  END IF;

  INSERT INTO sale_returns (
    organization_id, original_sale_id, refund_method, reason, pos_staff_id
  ) VALUES (
    v_sale.organization_id, p_sale_id, p_refund_method, p_reason, NULL
  ) RETURNING id INTO v_return_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_return_qty := (v_line->>'quantity')::NUMERIC;
    IF v_return_qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be positive';
    END IF;

    SELECT * INTO v_sale_line
    FROM sale_lines
    WHERE id = (v_line->>'saleLineId')::UUID AND sale_id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale line not found';
    END IF;

    v_available := v_sale_line.quantity - v_sale_line.returned_quantity;
    IF v_return_qty > v_available THEN
      RAISE EXCEPTION 'Return quantity exceeds available for %', v_sale_line.product_name;
    END IF;

    v_line_refund := round(v_sale_line.line_total * (v_return_qty / v_sale_line.quantity), 2);
    v_refund_total := v_refund_total + v_line_refund;

    IF v_sale_line.tax_amount > 0 AND v_sale_line.quantity > 0 THEN
      v_refund_tax := v_refund_tax + round(
        v_sale_line.tax_amount * (v_return_qty / v_sale_line.quantity), 2
      );
    END IF;

    v_refund_subtotal := v_refund_subtotal + (v_line_refund - round(
      v_sale_line.tax_amount * (v_return_qty / v_sale_line.quantity), 2
    ));

    UPDATE sale_lines
    SET returned_quantity = returned_quantity + v_return_qty
    WHERE id = v_sale_line.id;

    UPDATE inventory_levels
    SET quantity = quantity + v_return_qty, updated_at = now()
    WHERE store_id = v_sale.store_id AND variant_id = v_sale_line.variant_id;

    INSERT INTO sale_return_lines (return_id, sale_line_id, variant_id, quantity, line_total)
    VALUES (v_return_id, v_sale_line.id, v_sale_line.variant_id, v_return_qty, v_line_refund);
  END LOOP;

  UPDATE sale_returns
  SET subtotal = v_refund_subtotal, tax_amount = v_refund_tax, total = v_refund_total
  WHERE id = v_return_id;

  IF p_refund_method = 'store_credit' AND v_refund_total > 0 THEN
    INSERT INTO customer_credits (organization_id, customer_id, balance)
    VALUES (v_sale.organization_id, v_sale.customer_id, v_refund_total)
    ON CONFLICT (organization_id, customer_id)
    DO UPDATE SET balance = customer_credits.balance + v_refund_total, updated_at = now();

    INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, sale_id)
    VALUES (
      v_sale.organization_id, v_sale.customer_id, v_refund_total,
      'Partial return — ' || p_reason, p_sale_id
    );
  END IF;

  FOR v_sl IN SELECT * FROM sale_lines WHERE sale_id = p_sale_id
  LOOP
    IF v_sl.returned_quantity < v_sl.quantity THEN
      v_all_returned := false;
      EXIT;
    END IF;
  END LOOP;

  UPDATE sales
  SET status = CASE WHEN v_all_returned THEN 'returned'::sale_status ELSE 'completed'::sale_status END,
      void_reason = CASE WHEN v_all_returned THEN p_reason ELSE COALESCE(void_reason, p_reason) END
  WHERE id = p_sale_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_sale.organization_id, v_user_id, 'sale', p_sale_id, 'partial_return',
    jsonb_build_object(
      'return_id', v_return_id,
      'total', v_refund_total,
      'refund_method', p_refund_method,
      'reason', p_reason,
      'source', 'backoffice'
    )
  );

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'refund_total', v_refund_total,
    'refund_method', p_refund_method,
    'fully_returned', v_all_returned
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.partial_return_sale_backoffice(UUID, JSONB, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Refunds register (voided + returned + partial return records)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_refunds_register(
  p_organization_id UUID,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 200
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

  RETURN jsonb_build_object(
    'voided_sales', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'receipt_no', s.receipt_no,
        'total', s.total,
        'status', s.status,
        'void_reason', s.void_reason,
        'created_at', s.created_at,
        'store_name', st.name,
        'kind', 'full_void'
      ) ORDER BY s.created_at DESC)
      FROM sales s
      LEFT JOIN stores st ON st.id = s.store_id
      WHERE s.organization_id = p_organization_id
        AND s.status IN ('voided', 'returned')
        AND (p_from IS NULL OR s.created_at >= p_from)
        AND (p_to IS NULL OR s.created_at <= p_to)
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
    ), '[]'::jsonb),
    'partial_returns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'return_id', sr.id,
        'sale_id', sr.original_sale_id,
        'receipt_no', s.receipt_no,
        'total', sr.total,
        'refund_method', sr.refund_method,
        'reason', sr.reason,
        'created_at', sr.created_at,
        'store_name', st.name,
        'sale_status', s.status,
        'kind', 'partial_return'
      ) ORDER BY sr.created_at DESC)
      FROM sale_returns sr
      JOIN sales s ON s.id = sr.original_sale_id
      LEFT JOIN stores st ON st.id = s.store_id
      WHERE sr.organization_id = p_organization_id
        AND (p_from IS NULL OR sr.created_at >= p_from)
        AND (p_to IS NULL OR sr.created_at <= p_to)
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_refunds_register(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT) TO authenticated;

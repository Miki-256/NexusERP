-- Shift summary includes tips_total for Z-report / close shift.

CREATE OR REPLACE FUNCTION public.get_pos_shift_summary(
  p_session_id UUID,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess register_sessions%ROWTYPE;
  v_staff_name TEXT;
  v_sale_count INT;
  v_void_count INT;
  v_gross_total NUMERIC;
  v_tips_total NUMERIC;
  v_payments JSONB;
BEGIN
  SELECT * INTO v_sess FROM register_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT public.user_has_org_access(v_sess.organization_id) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSIF p_session_token IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.validate_pos_staff_session(p_session_token) s
      WHERE s.organization_id = v_sess.organization_id
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_sess.active_staff_id IS NOT NULL THEN
    SELECT display_name INTO v_staff_name FROM pos_staff WHERE id = v_sess.active_staff_id;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'voided'),
    COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0),
    COALESCE(SUM(COALESCE(tip_amount, 0)) FILTER (WHERE status = 'completed'), 0)
  INTO v_sale_count, v_void_count, v_gross_total, v_tips_total
  FROM sales WHERE session_id = p_session_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('method', method, 'total', total) ORDER BY method
  ), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT p.method::text AS method, SUM(p.amount) AS total
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    WHERE s.session_id = p_session_id AND s.status = 'completed'
    GROUP BY p.method
  ) agg;

  RETURN jsonb_build_object(
    'sessionId', v_sess.id,
    'registerId', v_sess.register_id,
    'openedAt', v_sess.opened_at,
    'closedAt', v_sess.closed_at,
    'openingFloat', v_sess.opening_float,
    'activeStaffName', v_staff_name,
    'saleCount', v_sale_count,
    'voidCount', v_void_count,
    'grossTotal', v_gross_total,
    'tipsTotal', v_tips_total,
    'paymentBreakdown', v_payments,
    'expectedCash',
      v_sess.opening_float + COALESCE((
        SELECT SUM(p.amount)
        FROM payments p
        JOIN sales s ON s.id = p.sale_id
        WHERE s.session_id = p_session_id AND s.status = 'completed' AND p.method = 'cash'
      ), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_shift_summary TO anon, authenticated;

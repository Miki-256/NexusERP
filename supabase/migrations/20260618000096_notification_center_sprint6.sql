-- Sprint 6: Notification Center UI — analytics, failed/DLQ, audit log, dashboard channel breakdown.

-- ---------------------------------------------------------------------------
-- Analytics (30-day delivery trends + channel mix)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_center_analytics(
  p_org_id UUID,
  p_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INT := GREATEST(7, LEAST(COALESCE(p_days, 30), 90));
  v_tz TEXT;
  v_from TIMESTAMPTZ;
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(NULLIF(trim(timezone), ''), 'Africa/Addis_Ababa') INTO v_tz
  FROM organizations WHERE id = p_org_id;

  v_from := (date_trunc('day', now() AT TIME ZONE v_tz) - (v_days - 1) * interval '1 day')
    AT TIME ZONE v_tz;

  RETURN jsonb_build_object(
    'days', v_days,
    'daily', COALESCE((
      SELECT jsonb_agg(row ORDER BY row->>'date')
      FROM (
        SELECT jsonb_build_object(
          'date', d::text,
          'sent', COALESCE((
            SELECT COUNT(*) FROM notification_deliveries nd
            WHERE nd.organization_id = p_org_id
              AND nd.status IN ('sent', 'delivered', 'read')
              AND (nd.sent_at AT TIME ZONE v_tz)::date = d
          ), 0),
          'failed', COALESCE((
            SELECT COUNT(*) FROM notification_deliveries nd
            WHERE nd.organization_id = p_org_id
              AND nd.status IN ('failed', 'dead_letter')
              AND (nd.created_at AT TIME ZONE v_tz)::date = d
          ), 0),
          'total', COALESCE((
            SELECT COUNT(*) FROM notification_deliveries nd
            WHERE nd.organization_id = p_org_id
              AND (nd.created_at AT TIME ZONE v_tz)::date = d
          ), 0)
        ) AS row
        FROM generate_series(
          (v_from AT TIME ZONE v_tz)::date,
          (now() AT TIME ZONE v_tz)::date,
          interval '1 day'
        ) AS d
      ) sub
    ), '[]'::jsonb),
    'by_channel', COALESCE((
      SELECT jsonb_agg(row ORDER BY row->>'channel')
      FROM (
        SELECT jsonb_build_object(
          'channel', channel::text,
          'sent', COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')),
          'failed', COUNT(*) FILTER (WHERE status IN ('failed', 'dead_letter')),
          'total', COUNT(*)
        ) AS row
        FROM notification_deliveries
        WHERE organization_id = p_org_id
          AND created_at >= v_from
        GROUP BY channel
      ) sub
    ), '[]'::jsonb),
    'summary', (
      SELECT jsonb_build_object(
        'total_sent', COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')),
        'total_failed', COUNT(*) FILTER (WHERE status IN ('failed', 'dead_letter')),
        'total', COUNT(*),
        'delivery_rate_pct', CASE WHEN COUNT(*) = 0 THEN 100
          ELSE round(100.0 * COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')) / COUNT(*), 1)
        END
      )
      FROM notification_deliveries
      WHERE organization_id = p_org_id AND created_at >= v_from
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard — add channel breakdown for today
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_center_dashboard(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_start TIMESTAMPTZ;
  v_today_end TIMESTAMPTZ;
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT day_start, day_end INTO v_today_start, v_today_end
  FROM public._org_local_day_bounds(p_org_id);

  RETURN jsonb_build_object(
    'sent_today', (
      SELECT COUNT(*) FROM notification_deliveries
      WHERE organization_id = p_org_id
        AND status IN ('sent', 'delivered', 'read')
        AND sent_at >= v_today_start AND sent_at < v_today_end
    ),
    'queued', (
      SELECT COUNT(*) FROM notification_deliveries
      WHERE organization_id = p_org_id AND status IN ('pending', 'processing', 'failed')
    ),
    'failed', (
      SELECT COUNT(*) FROM notification_deliveries
      WHERE organization_id = p_org_id AND status IN ('failed', 'dead_letter')
    ),
    'events_pending', (
      SELECT COUNT(*) FROM notification_events
      WHERE organization_id = p_org_id AND processed_at IS NULL
    ),
    'delivery_rate_pct', (
      SELECT CASE WHEN COUNT(*) = 0 THEN 100
        ELSE round(100.0 * COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')) / COUNT(*), 1)
      END
      FROM notification_deliveries
      WHERE organization_id = p_org_id
        AND created_at >= v_today_start AND created_at < v_today_end
    ),
    'channel_breakdown', COALESCE((
      SELECT jsonb_agg(row ORDER BY row->>'channel')
      FROM (
        SELECT jsonb_build_object(
          'channel', channel::text,
          'count', COUNT(*)
        ) AS row
        FROM notification_deliveries
        WHERE organization_id = p_org_id
          AND created_at >= v_today_start AND created_at < v_today_end
        GROUP BY channel
      ) sub
    ), '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Failed / dead-letter deliveries
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_notification_failed_deliveries(
  p_org_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY sort_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', d.id,
        'channel', d.channel,
        'recipient_ref', d.recipient_ref,
        'subject', d.subject,
        'status', d.status,
        'attempts', d.attempts,
        'max_attempts', d.max_attempts,
        'last_error', d.last_error,
        'created_at', d.created_at,
        'event_type', e.event_type
      ) AS row,
      d.created_at AS sort_at
      FROM notification_deliveries d
      JOIN notification_events e ON e.id = d.event_id
      WHERE d.organization_id = p_org_id
        AND d.status IN ('failed', 'dead_letter')
      ORDER BY d.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
    ) sub
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_all_failed_notification_deliveries(
  p_org_id UUID,
  p_limit INT DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_retried INT := 0;
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_row IN
    SELECT id FROM notification_deliveries
    WHERE organization_id = p_org_id
      AND status IN ('failed', 'dead_letter')
    ORDER BY created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
  LOOP
    PERFORM public.retry_notification_delivery(p_org_id, v_row.id);
    v_retried := v_retried + 1;
  END LOOP;

  RETURN jsonb_build_object('retried', v_retried);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_notification_delivery(
  p_org_id UUID,
  p_delivery_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE notification_deliveries
  SET status = 'cancelled', last_error = NULL
  WHERE id = p_delivery_id
    AND organization_id = p_org_id
    AND status IN ('pending', 'processing', 'failed');

  INSERT INTO notification_audit_log (organization_id, user_id, action, entity_type, entity_id)
  VALUES (p_org_id, auth.uid(), 'delivery_cancelled', 'notification_deliveries', p_delivery_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Audit log viewer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_notification_audit_log(
  p_org_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY sort_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'entity_type', a.entity_type,
        'entity_id', a.entity_id,
        'details', a.details,
        'user_id', a.user_id,
        'user_email', u.email,
        'created_at', a.created_at
      ) AS row,
      a.created_at AS sort_at
      FROM notification_audit_log a
      LEFT JOIN auth.users u ON u.id = a.user_id
      WHERE a.organization_id = p_org_id
      ORDER BY a.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
    ) sub
  ), '[]'::jsonb);
END;
$$;

-- Align delivery history with communications permissions
CREATE OR REPLACE FUNCTION public.list_notification_delivery_history(
  p_org_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY sort_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', d.id,
        'channel', d.channel,
        'recipient_ref', d.recipient_ref,
        'subject', d.subject,
        'status', d.status,
        'attempts', d.attempts,
        'last_error', d.last_error,
        'sent_at', d.sent_at,
        'created_at', d.created_at,
        'event_type', e.event_type
      ) AS row,
      d.created_at AS sort_at
      FROM notification_deliveries d
      JOIN notification_events e ON e.id = d.event_id
      WHERE d.organization_id = p_org_id
      ORDER BY d.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
    ) sub
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.notification_center_analytics(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_notification_failed_deliveries(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_all_failed_notification_deliveries(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_notification_delivery(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_notification_audit_log(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_notification_delivery_history(UUID, INT) TO authenticated;

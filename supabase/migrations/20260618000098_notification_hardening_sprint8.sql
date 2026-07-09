-- Sprint 8: Hardening — org rate limits, DLQ admin tools, permission alignment.

-- ---------------------------------------------------------------------------
-- Org rate limit: max notification events per minute
-- Default 100/min as documented in NOTIFICATION_CENTER.md
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS notification_rate_limit_per_minute INT;

COMMENT ON COLUMN organizations.notification_rate_limit_per_minute IS
  'Max notification_events enqueued per minute (NULL = platform default 100).';

CREATE OR REPLACE FUNCTION public._notification_org_rate_limit(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT;
BEGIN
  SELECT COALESCE(NULLIF(notification_rate_limit_per_minute, 0), 100)
  INTO v_limit
  FROM organizations
  WHERE id = p_org_id;

  RETURN GREATEST(10, LEAST(COALESCE(v_limit, 100), 10000));
EXCEPTION
  WHEN others THEN
    RETURN 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_notification_event(
  p_org_id UUID,
  p_event_type TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_idempotency_key TEXT DEFAULT NULL,
  p_priority notification_priority DEFAULT 'normal'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
  v_key TEXT := COALESCE(NULLIF(trim(p_idempotency_key), ''), gen_random_uuid()::text);
  v_recent INT;
  v_limit INT;
BEGIN
  -- Rate limit: count distinct events in the last minute (idempotent retries share keys, still count once on insert)
  v_limit := public._notification_org_rate_limit(p_org_id);
  SELECT COUNT(*)::INT INTO v_recent
  FROM notification_events
  WHERE organization_id = p_org_id
    AND created_at >= now() - interval '1 minute';

  IF v_recent >= v_limit THEN
    RAISE EXCEPTION 'Notification rate limit exceeded (% per minute). Try again shortly.', v_limit
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO notification_events (
    organization_id, event_type, entity_type, entity_id, payload, priority, idempotency_key
  ) VALUES (
    p_org_id, p_event_type, p_entity_type, p_entity_id,
    COALESCE(p_payload, '{}'::jsonb), COALESCE(p_priority, 'normal'), v_key
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM notification_events
    WHERE organization_id = p_org_id AND idempotency_key = v_key;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_notification_event(UUID, TEXT, TEXT, UUID, JSONB, TEXT, notification_priority)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Delivery detail (inspect failed / DLQ row)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_notification_delivery_detail(
  p_org_id UUID,
  p_delivery_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'id', d.id,
    'channel', d.channel,
    'recipient_type', d.recipient_type,
    'recipient_ref', d.recipient_ref,
    'subject', d.subject,
    'body', left(d.body, 4000),
    'body_format', d.body_format,
    'status', d.status,
    'attempts', d.attempts,
    'max_attempts', d.max_attempts,
    'last_error', d.last_error,
    'provider_message_id', d.provider_message_id,
    'provider_response', d.provider_response,
    'attachments', d.attachments,
    'next_attempt_at', d.next_attempt_at,
    'sent_at', d.sent_at,
    'created_at', d.created_at,
    'event_id', e.id,
    'event_type', e.event_type,
    'entity_type', e.entity_type,
    'entity_id', e.entity_id,
    'event_payload', e.payload,
    'event_created_at', e.created_at
  )
  INTO v_row
  FROM notification_deliveries d
  JOIN notification_events e ON e.id = d.event_id
  WHERE d.id = p_delivery_id
    AND d.organization_id = p_org_id;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Delivery not found';
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- Align retry / cancel with communications permission + dead_letter cancel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_notification_delivery(
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
  SET
    status = 'pending',
    next_attempt_at = now(),
    last_error = NULL,
    -- Give DLQ one more full attempt budget
    attempts = CASE WHEN status = 'dead_letter' THEN 0 ELSE attempts END
  WHERE id = p_delivery_id
    AND organization_id = p_org_id
    AND status IN ('failed', 'dead_letter');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery not found or not retryable';
  END IF;

  INSERT INTO notification_audit_log (organization_id, user_id, action, entity_type, entity_id, details)
  VALUES (
    p_org_id, auth.uid(), 'delivery_retried', 'notification_deliveries', p_delivery_id,
    jsonb_build_object('source', 'admin_retry')
  );
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
    AND status IN ('pending', 'processing', 'failed', 'dead_letter');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery not found or not cancellable';
  END IF;

  INSERT INTO notification_audit_log (organization_id, user_id, action, entity_type, entity_id)
  VALUES (p_org_id, auth.uid(), 'delivery_cancelled', 'notification_deliveries', p_delivery_id);
END;
$$;

-- Bulk cancel failed / DLQ
CREATE OR REPLACE FUNCTION public.cancel_failed_notification_deliveries(
  p_org_id UUID,
  p_limit INT DEFAULT 50,
  p_status TEXT DEFAULT NULL  -- NULL = failed+dead_letter; or 'failed' / 'dead_letter'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
  v_cancelled INT := 0;
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT array_agg(id) INTO v_ids
  FROM (
    SELECT id
    FROM notification_deliveries
    WHERE organization_id = p_org_id
      AND (
        (p_status IS NULL AND status IN ('failed', 'dead_letter'))
        OR (p_status = 'failed' AND status = 'failed')
        OR (p_status = 'dead_letter' AND status = 'dead_letter')
      )
    ORDER BY created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  ) sub;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('cancelled', 0);
  END IF;

  UPDATE notification_deliveries
  SET status = 'cancelled', last_error = NULL
  WHERE id = ANY(v_ids);

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  INSERT INTO notification_audit_log (organization_id, user_id, action, entity_type, entity_id, details)
  VALUES (
    p_org_id, auth.uid(), 'deliveries_bulk_cancelled', 'notification_deliveries', NULL,
    jsonb_build_object('count', v_cancelled, 'status_filter', p_status)
  );

  RETURN jsonb_build_object('cancelled', v_cancelled);
END;
$$;

-- Purge old cancelled / dead_letter rows (admin housekeeping; soft retention)
CREATE OR REPLACE FUNCTION public.purge_notification_dead_letter(
  p_org_id UUID,
  p_older_than_days INT DEFAULT 30,
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
  v_days INT := GREATEST(7, LEAST(COALESCE(p_older_than_days, 30), 365));
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  WITH doomed AS (
    SELECT id
    FROM notification_deliveries
    WHERE organization_id = p_org_id
      AND status IN ('dead_letter', 'cancelled')
      AND created_at < now() - (v_days || ' days')::interval
    ORDER BY created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  )
  DELETE FROM notification_deliveries d
  USING doomed
  WHERE d.id = doomed.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO notification_audit_log (organization_id, user_id, action, entity_type, entity_id, details)
  VALUES (
    p_org_id, auth.uid(), 'dlq_purged', 'notification_deliveries', NULL,
    jsonb_build_object('deleted', v_deleted, 'older_than_days', v_days)
  );

  RETURN jsonb_build_object('deleted', v_deleted, 'older_than_days', v_days);
END;
$$;

-- Failed list with optional status filter (failed | dead_letter | all)
DROP FUNCTION IF EXISTS public.list_notification_failed_deliveries(UUID, INT);

CREATE OR REPLACE FUNCTION public.list_notification_failed_deliveries(
  p_org_id UUID,
  p_limit INT DEFAULT 50,
  p_status TEXT DEFAULT NULL
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
        AND (
          (p_status IS NULL AND d.status IN ('failed', 'dead_letter'))
          OR (p_status = 'failed' AND d.status = 'failed')
          OR (p_status = 'dead_letter' AND d.status = 'dead_letter')
          OR (p_status = 'all' AND d.status IN ('failed', 'dead_letter'))
        )
      ORDER BY d.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
    ) sub
  ), '[]'::jsonb);
END;
$$;

-- DLQ summary for Failed page header
CREATE OR REPLACE FUNCTION public.notification_dlq_summary(p_org_id UUID)
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

  RETURN (
    SELECT jsonb_build_object(
      'failed', COUNT(*) FILTER (WHERE status = 'failed'),
      'dead_letter', COUNT(*) FILTER (WHERE status = 'dead_letter'),
      'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
      'oldest_failed_at', MIN(created_at) FILTER (WHERE status IN ('failed', 'dead_letter'))
    )
    FROM notification_deliveries
    WHERE organization_id = p_org_id
      AND status IN ('failed', 'dead_letter', 'cancelled')
  );
END;
$$;

-- Load-test helper: enqueue N synthetic events (service_role only; temporary high rate)
CREATE OR REPLACE FUNCTION public.load_test_enqueue_notifications(
  p_org_id UUID,
  p_count INT DEFAULT 100,
  p_event_type TEXT DEFAULT 'system.queue_backlog'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_i INT;
  v_enqueued INT := 0;
  v_id UUID;
  v_batch TEXT := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_count INT := GREATEST(1, LEAST(COALESCE(p_count, 100), 2000));
BEGIN
  -- service_role / postgres only
  IF coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_i IN 1..v_count LOOP
    BEGIN
      v_id := public.enqueue_notification_event(
        p_org_id,
        COALESCE(NULLIF(trim(p_event_type), ''), 'system.queue_backlog'),
        'load_test',
        NULL,
        jsonb_build_object(
          'load_test', true,
          'index', v_i,
          'queued', v_i,
          'events_pending', 0
        ),
        'load_test:' || v_batch || ':' || v_i::text
      );
      IF v_id IS NOT NULL THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION
      WHEN others THEN
        RETURN jsonb_build_object(
          'enqueued', v_enqueued,
          'requested', v_count,
          'stopped_at', v_i,
          'error', SQLERRM
        );
    END;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_enqueued, 'requested', v_count, 'batch', v_batch);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_notification_delivery_detail(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_notification_delivery(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_notification_delivery(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_failed_notification_deliveries(UUID, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_notification_dead_letter(UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_notification_failed_deliveries(UUID, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notification_dlq_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.load_test_enqueue_notifications(UUID, INT, TEXT) TO service_role;

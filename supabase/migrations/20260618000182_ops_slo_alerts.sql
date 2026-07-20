-- Ops SLO thresholds + alert queue (Health L7 external webhook hooks).

CREATE TABLE IF NOT EXISTS public.platform_ops_alert_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'suppressed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_platform_ops_alert_queue_pending
  ON public.platform_ops_alert_queue (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_platform_ops_alert_queue_type_time
  ON public.platform_ops_alert_queue (alert_type, created_at DESC);

ALTER TABLE public.platform_ops_alert_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_ops_alert_queue_select ON public.platform_ops_alert_queue;
CREATE POLICY platform_ops_alert_queue_select ON public.platform_ops_alert_queue
  FOR SELECT USING (public.platform_admin_can_read());

INSERT INTO platform_settings (key, value)
VALUES (
  'ops_slo',
  jsonb_build_object(
    'enabled', false,
    'webhook_url', '',
    'notify_slack', true,
    'cooldown_minutes', 60,
    'thresholds', jsonb_build_object(
      'ledger_queue_pending', 50,
      'ledger_queue_failed', 1,
      'payment_webhook_pending', 20,
      'unposted_completed_sales', 100,
      'notification_deliveries_failed', 20,
      'heartbeat_stale_minutes', 15
    )
  )
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_get_ops_slo_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (SELECT value FROM platform_settings WHERE key = 'ops_slo'),
    '{}'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_ops_slo_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_ops_slo_settings_internal()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM platform_settings WHERE key = 'ops_slo'),
    '{}'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.admin_get_ops_slo_settings_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_ops_slo_settings_internal() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_ops_slo_settings(p_settings JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thresholds JSONB;
  v_value JSONB;
BEGIN
  IF NOT public.platform_admin_can_manage_admins() THEN
    RAISE EXCEPTION 'Only super admins can change ops SLO settings';
  END IF;

  v_thresholds := COALESCE(p_settings->'thresholds', '{}'::jsonb);
  v_value := jsonb_build_object(
    'enabled', COALESCE((p_settings->>'enabled')::boolean, false),
    'webhook_url', COALESCE(p_settings->>'webhook_url', ''),
    'notify_slack', COALESCE((p_settings->>'notify_slack')::boolean, true),
    'cooldown_minutes', GREATEST(5, LEAST(COALESCE((p_settings->>'cooldown_minutes')::int, 60), 1440)),
    'thresholds', jsonb_build_object(
      'ledger_queue_pending', GREATEST(0, COALESCE((v_thresholds->>'ledger_queue_pending')::int, 50)),
      'ledger_queue_failed', GREATEST(0, COALESCE((v_thresholds->>'ledger_queue_failed')::int, 1)),
      'payment_webhook_pending', GREATEST(0, COALESCE((v_thresholds->>'payment_webhook_pending')::int, 20)),
      'unposted_completed_sales', GREATEST(0, COALESCE((v_thresholds->>'unposted_completed_sales')::int, 100)),
      'notification_deliveries_failed', GREATEST(0, COALESCE((v_thresholds->>'notification_deliveries_failed')::int, 20)),
      'heartbeat_stale_minutes', GREATEST(5, COALESCE((v_thresholds->>'heartbeat_stale_minutes')::int, 15))
    )
  );

  INSERT INTO platform_settings (key, value, updated_at, updated_by)
  VALUES ('ops_slo', v_value, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();

  PERFORM public.log_platform_audit(
    'settings.ops_slo',
    'platform_settings',
    NULL,
    NULL,
    jsonb_build_object(
      'enabled', v_value->'enabled',
      'notify_slack', v_value->'notify_slack',
      'cooldown_minutes', v_value->'cooldown_minutes',
      'thresholds', v_value->'thresholds',
      'webhook_configured', NULLIF(trim(COALESCE(v_value->>'webhook_url', '')), '') IS NOT NULL
    )
  );

  RETURN v_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_ops_slo_settings(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public._enqueue_ops_alert(
  p_alert_type TEXT,
  p_severity TEXT,
  p_title TEXT,
  p_detail TEXT,
  p_payload JSONB,
  p_cooldown_minutes INT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_cooldown INT := GREATEST(5, LEAST(COALESCE(p_cooldown_minutes, 60), 1440));
BEGIN
  IF EXISTS (
    SELECT 1
    FROM platform_ops_alert_queue
    WHERE alert_type = p_alert_type
      AND created_at > now() - make_interval(mins => v_cooldown)
      AND status IN ('pending', 'processing', 'sent')
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO platform_ops_alert_queue (
    alert_type, severity, title, detail, payload
  ) VALUES (
    p_alert_type,
    CASE WHEN p_severity IN ('warning', 'critical') THEN p_severity ELSE 'warning' END,
    p_title,
    p_detail,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._enqueue_ops_alert(TEXT, TEXT, TEXT, TEXT, JSONB, INT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_evaluate_ops_slos()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings JSONB;
  v_thresholds JSONB;
  v_cooldown INT;
  v_enqueued INT := 0;
  v_checks JSONB := '[]'::jsonb;
  v_ledger_pending INT := 0;
  v_ledger_failed INT := 0;
  v_webhook_pending INT := 0;
  v_unposted INT := 0;
  v_notif_failed INT := 0;
  v_heartbeat TIMESTAMPTZ;
  v_stale_minutes INT;
  v_id UUID;
  v_current INT;
  v_limit INT;
BEGIN
  v_settings := public.admin_get_ops_slo_settings_internal();
  IF NOT COALESCE((v_settings->>'enabled')::boolean, false) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'disabled');
  END IF;

  v_thresholds := COALESCE(v_settings->'thresholds', '{}'::jsonb);
  v_cooldown := COALESCE((v_settings->>'cooldown_minutes')::int, 60);

  IF to_regclass('public.sale_ledger_post_queue') IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_ledger_pending FROM sale_ledger_post_queue;
    SELECT COUNT(*)::INT INTO v_ledger_failed
    FROM sale_ledger_post_queue WHERE last_error IS NOT NULL;
  END IF;

  IF to_regclass('public.payment_webhook_queue') IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_webhook_pending
    FROM payment_webhook_queue WHERE processed_at IS NULL;
  END IF;

  SELECT COUNT(*)::INT INTO v_unposted
  FROM sales s
  WHERE s.status = 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM payments p
      WHERE p.sale_id = s.id AND p.status = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.organization_id = s.organization_id
        AND je.source_type = 'sale' AND je.source_id = s.id
    );

  IF to_regclass('public.notification_deliveries') IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_notif_failed
    FROM notification_deliveries
    WHERE status IN ('failed', 'dead_letter');
  END IF;

  SELECT last_success_at INTO v_heartbeat
  FROM platform_ops_heartbeat
  WHERE key = 'process_queue';

  v_current := v_ledger_pending;
  v_limit := COALESCE((v_thresholds->>'ledger_queue_pending')::int, 50);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'ledger_queue_pending', 'current', v_current, 'threshold', v_limit, 'breached', v_current > v_limit
  ));
  IF v_current > v_limit THEN
    v_id := public._enqueue_ops_alert(
      'ledger_queue_pending',
      CASE WHEN v_current > v_limit * 2 THEN 'critical' ELSE 'warning' END,
      'Ledger queue backlog',
      format('Pending sale→GL posts: %s (threshold %s)', v_current, v_limit),
      jsonb_build_object('current', v_current, 'threshold', v_limit),
      v_cooldown
    );
    IF v_id IS NOT NULL THEN v_enqueued := v_enqueued + 1; END IF;
  END IF;

  v_current := v_ledger_failed;
  v_limit := COALESCE((v_thresholds->>'ledger_queue_failed')::int, 1);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'ledger_queue_failed', 'current', v_current, 'threshold', v_limit, 'breached', v_current > v_limit
  ));
  IF v_current > v_limit THEN
    v_id := public._enqueue_ops_alert(
      'ledger_queue_failed',
      'critical',
      'Ledger queue failures',
      format('Failed sale→GL posts: %s (threshold %s)', v_current, v_limit),
      jsonb_build_object('current', v_current, 'threshold', v_limit),
      v_cooldown
    );
    IF v_id IS NOT NULL THEN v_enqueued := v_enqueued + 1; END IF;
  END IF;

  v_current := v_webhook_pending;
  v_limit := COALESCE((v_thresholds->>'payment_webhook_pending')::int, 20);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'payment_webhook_pending', 'current', v_current, 'threshold', v_limit, 'breached', v_current > v_limit
  ));
  IF v_current > v_limit THEN
    v_id := public._enqueue_ops_alert(
      'payment_webhook_pending',
      'warning',
      'Payment webhook backlog',
      format('Unprocessed payment webhooks: %s (threshold %s)', v_current, v_limit),
      jsonb_build_object('current', v_current, 'threshold', v_limit),
      v_cooldown
    );
    IF v_id IS NOT NULL THEN v_enqueued := v_enqueued + 1; END IF;
  END IF;

  v_current := v_unposted;
  v_limit := COALESCE((v_thresholds->>'unposted_completed_sales')::int, 100);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'unposted_completed_sales', 'current', v_current, 'threshold', v_limit, 'breached', v_current > v_limit
  ));
  IF v_current > v_limit THEN
    v_id := public._enqueue_ops_alert(
      'unposted_completed_sales',
      CASE WHEN v_current > v_limit * 2 THEN 'critical' ELSE 'warning' END,
      'Unposted completed sales',
      format('Completed sales missing GL: %s (threshold %s)', v_current, v_limit),
      jsonb_build_object('current', v_current, 'threshold', v_limit),
      v_cooldown
    );
    IF v_id IS NOT NULL THEN v_enqueued := v_enqueued + 1; END IF;
  END IF;

  v_current := v_notif_failed;
  v_limit := COALESCE((v_thresholds->>'notification_deliveries_failed')::int, 20);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'notification_deliveries_failed', 'current', v_current, 'threshold', v_limit, 'breached', v_current > v_limit
  ));
  IF v_current > v_limit THEN
    v_id := public._enqueue_ops_alert(
      'notification_deliveries_failed',
      'warning',
      'Failed notification deliveries',
      format('Failed deliveries: %s (threshold %s)', v_current, v_limit),
      jsonb_build_object('current', v_current, 'threshold', v_limit),
      v_cooldown
    );
    IF v_id IS NOT NULL THEN v_enqueued := v_enqueued + 1; END IF;
  END IF;

  v_stale_minutes := COALESCE((v_thresholds->>'heartbeat_stale_minutes')::int, 15);
  v_current := CASE
    WHEN v_heartbeat IS NULL OR v_heartbeat < TIMESTAMPTZ 'epoch' + interval '1 day'
      THEN 999999
    ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - v_heartbeat)) / 60)::INT)
  END;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'heartbeat_stale_minutes',
    'current', v_current,
    'threshold', v_stale_minutes,
    'breached', v_current > v_stale_minutes,
    'last_success_at', v_heartbeat
  ));
  IF v_current > v_stale_minutes THEN
    v_id := public._enqueue_ops_alert(
      'heartbeat_stale',
      'critical',
      'Process-queue heartbeat stale',
      format('Last success %s minutes ago (threshold %s)', v_current, v_stale_minutes),
      jsonb_build_object('current', v_current, 'threshold', v_stale_minutes, 'last_success_at', v_heartbeat),
      v_cooldown
    );
    IF v_id IS NOT NULL THEN v_enqueued := v_enqueued + 1; END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'enqueued', v_enqueued,
    'checks', v_checks,
    'evaluated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_evaluate_ops_slos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_evaluate_ops_slos() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_preview_ops_slos()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings JSONB;
  v_thresholds JSONB;
  v_checks JSONB := '[]'::jsonb;
  v_ledger_pending INT := 0;
  v_ledger_failed INT := 0;
  v_webhook_pending INT := 0;
  v_unposted INT := 0;
  v_notif_failed INT := 0;
  v_heartbeat TIMESTAMPTZ;
  v_stale_minutes INT;
  v_current INT;
  v_limit INT;
  v_breached INT := 0;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_settings := COALESCE(
    (SELECT value FROM platform_settings WHERE key = 'ops_slo'),
    '{}'::jsonb
  );
  v_thresholds := COALESCE(v_settings->'thresholds', '{}'::jsonb);

  IF to_regclass('public.sale_ledger_post_queue') IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_ledger_pending FROM sale_ledger_post_queue;
    SELECT COUNT(*)::INT INTO v_ledger_failed
    FROM sale_ledger_post_queue WHERE last_error IS NOT NULL;
  END IF;

  IF to_regclass('public.payment_webhook_queue') IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_webhook_pending
    FROM payment_webhook_queue WHERE processed_at IS NULL;
  END IF;

  SELECT COUNT(*)::INT INTO v_unposted
  FROM sales s
  WHERE s.status = 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM payments p
      WHERE p.sale_id = s.id AND p.status = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.organization_id = s.organization_id
        AND je.source_type = 'sale' AND je.source_id = s.id
    );

  IF to_regclass('public.notification_deliveries') IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_notif_failed
    FROM notification_deliveries
    WHERE status IN ('failed', 'dead_letter');
  END IF;

  SELECT last_success_at INTO v_heartbeat
  FROM platform_ops_heartbeat
  WHERE key = 'process_queue';

  v_limit := COALESCE((v_thresholds->>'ledger_queue_pending')::int, 50);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'ledger_queue_pending', 'label', 'Ledger queue pending',
    'current', v_ledger_pending, 'threshold', v_limit, 'breached', v_ledger_pending > v_limit
  ));
  IF v_ledger_pending > v_limit THEN v_breached := v_breached + 1; END IF;

  v_limit := COALESCE((v_thresholds->>'ledger_queue_failed')::int, 1);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'ledger_queue_failed', 'label', 'Ledger queue failed',
    'current', v_ledger_failed, 'threshold', v_limit, 'breached', v_ledger_failed > v_limit
  ));
  IF v_ledger_failed > v_limit THEN v_breached := v_breached + 1; END IF;

  v_limit := COALESCE((v_thresholds->>'payment_webhook_pending')::int, 20);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'payment_webhook_pending', 'label', 'Payment webhooks pending',
    'current', v_webhook_pending, 'threshold', v_limit, 'breached', v_webhook_pending > v_limit
  ));
  IF v_webhook_pending > v_limit THEN v_breached := v_breached + 1; END IF;

  v_limit := COALESCE((v_thresholds->>'unposted_completed_sales')::int, 100);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'unposted_completed_sales', 'label', 'Unposted completed sales',
    'current', v_unposted, 'threshold', v_limit, 'breached', v_unposted > v_limit
  ));
  IF v_unposted > v_limit THEN v_breached := v_breached + 1; END IF;

  v_limit := COALESCE((v_thresholds->>'notification_deliveries_failed')::int, 20);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'notification_deliveries_failed', 'label', 'Notification failures',
    'current', v_notif_failed, 'threshold', v_limit, 'breached', v_notif_failed > v_limit
  ));
  IF v_notif_failed > v_limit THEN v_breached := v_breached + 1; END IF;

  v_stale_minutes := COALESCE((v_thresholds->>'heartbeat_stale_minutes')::int, 15);
  v_current := CASE
    WHEN v_heartbeat IS NULL OR v_heartbeat < TIMESTAMPTZ 'epoch' + interval '1 day'
      THEN 999999
    ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - v_heartbeat)) / 60)::INT)
  END;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'heartbeat_stale_minutes', 'label', 'Heartbeat age (minutes)',
    'current', v_current, 'threshold', v_stale_minutes,
    'breached', v_current > v_stale_minutes, 'last_success_at', v_heartbeat
  ));
  IF v_current > v_stale_minutes THEN v_breached := v_breached + 1; END IF;

  RETURN jsonb_build_object(
    'breached_count', v_breached,
    'checks', v_checks,
    'evaluated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_preview_ops_slos() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_ops_slo_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings JSONB;
  v_preview JSONB;
  v_recent JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_settings := public.admin_get_ops_slo_settings();
  v_preview := public.admin_preview_ops_slos();

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'alert_type', q.alert_type,
        'severity', q.severity,
        'title', q.title,
        'detail', q.detail,
        'status', q.status,
        'created_at', q.created_at,
        'completed_at', q.completed_at,
        'error', q.error
      )
      ORDER BY q.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_recent
  FROM (
    SELECT *
    FROM platform_ops_alert_queue
    ORDER BY created_at DESC
    LIMIT 20
  ) q;

  RETURN jsonb_build_object(
    'settings', jsonb_build_object(
      'enabled', COALESCE((v_settings->>'enabled')::boolean, false),
      'webhook_configured', NULLIF(trim(COALESCE(v_settings->>'webhook_url', '')), '') IS NOT NULL,
      'notify_slack', COALESCE((v_settings->>'notify_slack')::boolean, true),
      'cooldown_minutes', COALESCE((v_settings->>'cooldown_minutes')::int, 60),
      'thresholds', COALESCE(v_settings->'thresholds', '{}'::jsonb)
    ),
    'preview', v_preview,
    'recent_alerts', v_recent,
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_ops_slo_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_claim_ops_alerts(p_limit INT DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  WITH claimed AS (
    SELECT id
    FROM platform_ops_alert_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE platform_ops_alert_queue q
    SET status = 'processing', claimed_at = now()
    FROM claimed
    WHERE q.id = claimed.id
    RETURNING q.id, q.alert_type, q.severity, q.title, q.detail, q.payload, q.created_at
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'alert_type', u.alert_type,
        'severity', u.severity,
        'title', u.title,
        'detail', u.detail,
        'payload', u.payload,
        'created_at', u.created_at
      )
      ORDER BY u.created_at
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM updated u;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_claim_ops_alerts(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_ops_alerts(INT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_complete_ops_alert(
  p_alert_id UUID,
  p_status TEXT,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('sent', 'failed', 'suppressed') THEN
    RAISE EXCEPTION 'Invalid completion status';
  END IF;

  UPDATE platform_ops_alert_queue
  SET
    status = p_status,
    error = p_error,
    completed_at = now()
  WHERE id = p_alert_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_complete_ops_alert(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_complete_ops_alert(UUID, TEXT, TEXT) TO service_role;

-- Fix Rules page (STABLE + INSERT) and Queue page (show/process unprocessed events).
-- Self-contained: includes user_can_manage_communications (from 00088) for DBs that skipped it.

-- ---------------------------------------------------------------------------
-- Communications permission helper (required by RPCs below)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_manage_communications(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF public.user_can_manage(p_org_id) THEN
    RETURN true;
  END IF;

  SELECT om.id INTO v_member_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
    AND om.organization_id = p_org_id
    AND om.is_active = true;

  IF v_member_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN 'communications' = ANY(public.resolve_member_manage_app_ids(v_member_id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_manage_communications(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Rules: STABLE functions cannot INSERT — make list_notification_rules VOLATILE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_notification_rules(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_notification_rules(p_org_id);

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'sort_order')::int, row->>'name')
    FROM (
      SELECT jsonb_build_object(
        'id', r.id, 'name', r.name, 'event_type', r.event_type,
        'conditions', r.conditions, 'channels', to_jsonb(r.channels),
        'recipient_spec', r.recipient_spec, 'template_codes', r.template_codes,
        'store_ids', r.store_ids, 'is_active', r.is_active, 'sort_order', r.sort_order,
        'updated_at', r.updated_at
      ) AS row
      FROM notification_rules r
      WHERE r.organization_id = p_org_id
    ) sub
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Process pending events for one org (manager-triggered from Queue UI)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_notification_events_for_org(
  p_org_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event RECORD;
  v_template notification_templates%ROWTYPE;
  v_payload JSONB;
  v_subject TEXT;
  v_body TEXT;
  v_email TEXT;
  v_created INT := 0;
  v_processed INT := 0;
  v_email_enabled BOOLEAN;
  v_rule_created INT;
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_notification_rules(p_org_id);
  PERFORM public.repair_notification_system_templates();

  FOR v_event IN
    SELECT * FROM notification_events
    WHERE organization_id = p_org_id
      AND processed_at IS NULL
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_payload := COALESCE(v_event.payload, '{}'::jsonb);

    IF v_event.event_type IN (
      'pos.sale_completed', 'inventory.low_stock', 'inventory.out_of_stock', 'reports.daily_sales'
    ) THEN
      IF v_event.event_type = 'pos.sale_completed' THEN
        v_payload := public._enrich_pos_sale_notification_payload(v_payload, v_event.organization_id);
        UPDATE notification_events SET payload = v_payload WHERE id = v_event.id;
        v_event.payload := v_payload;
      END IF;
      v_rule_created := public._notification_apply_rules_for_event(v_event.id);
      v_created := v_created + v_rule_created;

    ELSIF v_event.event_type IN ('team.invite_created', 'team.invite') THEN
      SELECT COALESCE((public.get_notification_email_config_internal(v_event.organization_id)->>'is_enabled')::boolean, false)
      INTO v_email_enabled;

      IF v_email_enabled THEN
        v_template := public._resolve_notification_template(v_event.organization_id, 'team.invite', 'email');
        v_email := NULLIF(trim(v_payload->>'email'), '');

        IF v_email IS NOT NULL AND v_template.id IS NOT NULL THEN
          v_subject := public._render_notification_template(v_template.subject_template, v_payload);
          v_body := public._render_notification_template(v_template.body_template, v_payload);

          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key
          ) VALUES (
            v_event.organization_id, v_event.id, 'email', 'email', v_email,
            v_template.id, v_subject, v_body, v_template.body_format,
            v_event.id::text || ':' || v_email || ':email'
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END IF;
      END IF;

    ELSIF v_event.event_type = 'accounting.invoice_reminder' THEN
      SELECT COALESCE((public.get_notification_email_config_internal(v_event.organization_id)->>'is_enabled')::boolean, false)
      INTO v_email_enabled;

      IF v_email_enabled THEN
        v_template := public._resolve_notification_template(
          v_event.organization_id, 'accounting.invoice_reminder', 'email'
        );
        v_email := NULLIF(trim(v_payload->>'customer_email'), '');

        IF v_email IS NOT NULL AND v_template.id IS NOT NULL THEN
          v_payload := v_payload || jsonb_build_object(
            'total', COALESCE(v_payload->>'total', '0'),
            'days_overdue', COALESCE(v_payload->>'days_overdue', '0')
          );
          v_subject := public._render_notification_template(v_template.subject_template, v_payload);
          v_body := public._render_notification_template(v_template.body_template, v_payload);

          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key, attachments
          ) VALUES (
            v_event.organization_id, v_event.id, 'email', 'email', v_email,
            v_template.id, v_subject, v_body, v_template.body_format,
            v_event.id::text || ':' || v_email || ':email',
            jsonb_build_array(jsonb_build_object(
              'meta', jsonb_build_object('invoice_id', v_payload->>'invoice_id')
            ))
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END IF;
      END IF;
    END IF;

    UPDATE notification_events SET processed_at = now() WHERE id = v_event.id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('events_processed', v_processed, 'deliveries_created', v_created);
END;
$$;

-- ---------------------------------------------------------------------------
-- Queue: include unprocessed events (dashboard "events pending" vs empty queue)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_notification_queue(
  p_org_id UUID,
  p_status TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY sort_at DESC)
    FROM (
      SELECT row, sort_at
      FROM (
        SELECT
          jsonb_build_object(
            'id', d.id,
            'row_kind', 'delivery',
            'channel', d.channel,
            'recipient_ref', d.recipient_ref,
            'subject', d.subject,
            'status', d.status,
            'attempts', d.attempts,
            'max_attempts', d.max_attempts,
            'last_error', d.last_error,
            'next_attempt_at', d.next_attempt_at,
            'created_at', d.created_at,
            'event_type', e.event_type,
            'event_id', e.id
          ) AS row,
          d.created_at AS sort_at
        FROM notification_deliveries d
        JOIN notification_events e ON e.id = d.event_id
        WHERE d.organization_id = p_org_id
          AND d.status IN ('pending', 'failed', 'processing', 'dead_letter')
          AND (p_status IS NULL OR d.status::text = p_status)

        UNION ALL

        SELECT
          jsonb_build_object(
            'id', e.id,
            'row_kind', 'event',
            'channel', '—',
            'recipient_ref', 'Awaiting processing',
            'subject', NULL,
            'status', 'event_pending',
            'attempts', 0,
            'max_attempts', 0,
            'last_error', NULL,
            'next_attempt_at', e.created_at,
            'created_at', e.created_at,
            'event_type', e.event_type,
            'event_id', e.id
          ) AS row,
          e.created_at AS sort_at
        FROM notification_events e
        WHERE e.organization_id = p_org_id
          AND e.processed_at IS NULL
          AND (p_status IS NULL OR p_status IN ('pending', 'event_pending'))
      ) combined
      ORDER BY sort_at DESC
      LIMIT v_limit
    ) sub
  ), '[]'::jsonb);
END;
$$;

-- Align dashboard permission check with other communications RPCs
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
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_notification_events_for_org(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_notification_rules(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_notification_queue(UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notification_center_dashboard(UUID) TO authenticated;

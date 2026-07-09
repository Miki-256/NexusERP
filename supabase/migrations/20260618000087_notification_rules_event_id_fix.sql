-- Fix rules engine: FOR loop RECORD cannot cast to notification_events composite type.
-- Symptom: process_notification_events fails with "cannot cast type record to notification_events"
-- and POS/Telegram deliveries are never created.

DROP FUNCTION IF EXISTS public._notification_apply_rules_for_event(notification_events);

CREATE OR REPLACE FUNCTION public._notification_apply_rules_for_event(p_event_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p_event notification_events%ROWTYPE;
  v_rule notification_rules%ROWTYPE;
  v_payload JSONB;
  v_channel notification_channel;
  v_template_code TEXT;
  v_template notification_templates%ROWTYPE;
  v_subject TEXT;
  v_body TEXT;
  v_created INT := 0;
  v_store_id UUID;
  v_role TEXT;
  v_user_id UUID;
  v_email TEXT;
  v_chat_id TEXT;
  v_group_id UUID;
  v_group notification_recipient_groups%ROWTYPE;
  v_email_enabled BOOLEAN;
  v_telegram_enabled BOOLEAN;
BEGIN
  SELECT * INTO p_event FROM notification_events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_payload := COALESCE(p_event.payload, '{}'::jsonb);
  v_store_id := NULLIF(p_event.payload->>'store_id', '')::uuid;

  FOR v_rule IN
    SELECT * FROM notification_rules
    WHERE organization_id = p_event.organization_id
      AND is_active = true
      AND (event_type = p_event.event_type OR event_type = '*')
    ORDER BY sort_order, created_at
  LOOP
    IF v_rule.store_ids IS NOT NULL AND array_length(v_rule.store_ids, 1) > 0 THEN
      IF v_store_id IS NULL OR NOT (v_store_id = ANY(v_rule.store_ids)) THEN
        CONTINUE;
      END IF;
    END IF;

    IF NOT public._notification_conditions_match(v_rule.conditions, v_payload) THEN
      CONTINUE;
    END IF;

    FOREACH v_channel IN ARRAY v_rule.channels LOOP
      IF v_channel = 'email' THEN
        SELECT COALESCE((public.get_notification_email_config_internal(p_event.organization_id)->>'is_enabled')::boolean, false)
        INTO v_email_enabled;
        IF NOT v_email_enabled THEN
          CONTINUE;
        END IF;
      ELSIF v_channel = 'telegram' THEN
        SELECT COALESCE((public.get_notification_telegram_config_internal(p_event.organization_id)->>'is_enabled')::boolean, false)
        INTO v_telegram_enabled;
        IF NOT v_telegram_enabled THEN
          CONTINUE;
        END IF;
      END IF;

      v_template_code := v_rule.template_codes->>v_channel::text;
      IF v_template_code IS NULL OR trim(v_template_code) = '' THEN
        CONTINUE;
      END IF;

      v_template := public._resolve_notification_template(p_event.organization_id, v_template_code, v_channel);
      IF v_template.id IS NULL THEN
        CONTINUE;
      END IF;

      v_subject := public._render_notification_template(COALESCE(v_template.subject_template, ''), v_payload);
      v_body := public._render_notification_template(v_template.body_template, v_payload);

      IF v_rule.recipient_spec ? 'roles' THEN
        FOR v_role IN
          SELECT jsonb_array_elements_text(v_rule.recipient_spec->'roles')
        LOOP
          FOR v_user_id IN
            SELECT om.user_id FROM organization_members om
            WHERE om.organization_id = p_event.organization_id AND om.role::text = v_role
          LOOP
            IF v_channel = 'in_app' THEN
              INSERT INTO notification_deliveries (
                organization_id, event_id, channel, recipient_type, recipient_ref,
                template_id, subject, body, body_format, idempotency_key
              ) VALUES (
                p_event.organization_id, p_event.id, v_channel, 'user', v_user_id::text,
                v_template.id, v_subject, v_body, v_template.body_format,
                p_event.id::text || ':rule:' || v_rule.id::text || ':' || v_user_id::text || ':' || v_channel::text
              ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
              v_created := v_created + 1;
            ELSIF v_channel = 'email' THEN
              SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_user_id;
              IF v_email IS NOT NULL AND trim(v_email) <> '' THEN
                INSERT INTO notification_deliveries (
                  organization_id, event_id, channel, recipient_type, recipient_ref,
                  template_id, subject, body, body_format, idempotency_key
                ) VALUES (
                  p_event.organization_id, p_event.id, 'email', 'email', trim(v_email),
                  v_template.id, v_subject, v_body, v_template.body_format,
                  p_event.id::text || ':rule:' || v_rule.id::text || ':' || trim(v_email) || ':email'
                ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
                v_created := v_created + 1;
              END IF;
            END IF;
          END LOOP;
        END LOOP;
      END IF;

      IF v_rule.recipient_spec ? 'user_ids' AND v_channel = 'in_app' THEN
        FOR v_user_id IN
          SELECT (jsonb_array_elements_text(v_rule.recipient_spec->'user_ids'))::uuid
        LOOP
          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key
          ) VALUES (
            p_event.organization_id, p_event.id, v_channel, 'user', v_user_id::text,
            v_template.id, v_subject, v_body, v_template.body_format,
            p_event.id::text || ':rule:' || v_rule.id::text || ':' || v_user_id::text || ':' || v_channel::text
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END LOOP;
      END IF;

      IF v_rule.recipient_spec ? 'group_ids' THEN
        FOR v_group_id IN
          SELECT (jsonb_array_elements_text(v_rule.recipient_spec->'group_ids'))::uuid
        LOOP
          SELECT * INTO v_group FROM notification_recipient_groups
          WHERE id = v_group_id AND organization_id = p_event.organization_id;
          IF NOT FOUND THEN CONTINUE; END IF;

          IF v_channel = 'in_app' THEN
            FOREACH v_user_id IN ARRAY v_group.member_user_ids LOOP
              INSERT INTO notification_deliveries (
                organization_id, event_id, channel, recipient_type, recipient_ref,
                template_id, subject, body, body_format, idempotency_key
              ) VALUES (
                p_event.organization_id, p_event.id, v_channel, 'user', v_user_id::text,
                v_template.id, v_subject, v_body, v_template.body_format,
                p_event.id::text || ':rule:' || v_rule.id::text || ':grp:' || v_user_id::text
              ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
              v_created := v_created + 1;
            END LOOP;
          ELSIF v_channel = 'email' THEN
            FOREACH v_email IN ARRAY v_group.member_emails LOOP
              IF v_email IS NULL OR trim(v_email) = '' THEN CONTINUE; END IF;
              INSERT INTO notification_deliveries (
                organization_id, event_id, channel, recipient_type, recipient_ref,
                template_id, subject, body, body_format, idempotency_key
              ) VALUES (
                p_event.organization_id, p_event.id, 'email', 'email', trim(v_email),
                v_template.id, v_subject, v_body, v_template.body_format,
                p_event.id::text || ':rule:' || v_rule.id::text || ':grp:' || trim(v_email)
              ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
              v_created := v_created + 1;
            END LOOP;
          ELSIF v_channel = 'telegram' THEN
            FOREACH v_chat_id IN ARRAY v_group.telegram_chat_ids LOOP
              IF v_chat_id IS NULL OR trim(v_chat_id) = '' THEN CONTINUE; END IF;
              INSERT INTO notification_deliveries (
                organization_id, event_id, channel, recipient_type, recipient_ref,
                template_id, subject, body, body_format, idempotency_key
              ) VALUES (
                p_event.organization_id, p_event.id, 'telegram', 'telegram_chat', trim(v_chat_id),
                v_template.id, v_subject, v_body, v_template.body_format,
                p_event.id::text || ':rule:' || v_rule.id::text || ':tg:' || trim(v_chat_id)
              ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
              v_created := v_created + 1;
            END LOOP;
          END IF;
        END LOOP;
      END IF;

      IF v_rule.recipient_spec ? 'emails' AND v_channel = 'email' THEN
        FOR v_email IN
          SELECT jsonb_array_elements_text(v_rule.recipient_spec->'emails')
        LOOP
          IF v_email IS NULL OR trim(v_email) = '' THEN CONTINUE; END IF;
          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key
          ) VALUES (
            p_event.organization_id, p_event.id, 'email', 'email', trim(v_email),
            v_template.id, v_subject, v_body, v_template.body_format,
            p_event.id::text || ':rule:' || v_rule.id::text || ':' || trim(v_email)
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END LOOP;
      END IF;

      IF v_rule.recipient_spec->>'use_default_chat' = 'true' AND v_channel = 'telegram' THEN
        SELECT NULLIF(trim(public.get_notification_telegram_config_internal(p_event.organization_id)->>'default_chat_id'), '')
        INTO v_chat_id;
        IF v_chat_id IS NOT NULL THEN
          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key
          ) VALUES (
            p_event.organization_id, p_event.id, 'telegram', 'telegram_chat', v_chat_id,
            v_template.id, v_subject, v_body, v_template.body_format,
            p_event.id::text || ':rule:' || v_rule.id::text || ':default_tg:' || v_chat_id
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END IF;
      END IF;

      IF v_rule.recipient_spec ? 'telegram_chat_ids' AND v_channel = 'telegram' THEN
        FOR v_chat_id IN
          SELECT jsonb_array_elements_text(v_rule.recipient_spec->'telegram_chat_ids')
        LOOP
          IF v_chat_id IS NULL OR trim(v_chat_id) = '' THEN CONTINUE; END IF;
          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key
          ) VALUES (
            p_event.organization_id, p_event.id, 'telegram', 'telegram_chat', trim(v_chat_id),
            v_template.id, v_subject, v_body, v_template.body_format,
            p_event.id::text || ':rule:' || v_rule.id::text || ':tg:' || trim(v_chat_id)
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_notification_events(p_limit INT DEFAULT 50)
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
  FOR v_event IN
    SELECT * FROM notification_events
    WHERE processed_at IS NULL
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_payload := COALESCE(v_event.payload, '{}'::jsonb);

    IF v_event.event_type IN (
      'pos.sale_completed', 'inventory.low_stock', 'inventory.out_of_stock', 'reports.daily_sales'
    ) THEN
      IF v_event.event_type = 'pos.sale_completed' THEN
        v_payload := v_payload || jsonb_build_object(
          'receipt_no', COALESCE(v_payload->>'receipt_no', ''),
          'total', COALESCE(v_payload->>'total', '0'),
          'customer_name', COALESCE(NULLIF(trim(v_payload->>'customer_name'), ''), 'Walk-in'),
          'store_name', COALESCE(NULLIF(trim(v_payload->>'store_name'), ''), 'Store')
        );
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

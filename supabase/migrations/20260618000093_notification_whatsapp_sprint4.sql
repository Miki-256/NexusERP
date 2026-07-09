-- Sprint 4: WhatsApp channel — Meta Cloud API config, templates, rules engine, delivery webhooks.

ALTER TABLE public.notification_templates
  ADD COLUMN IF NOT EXISTS provider_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- System templates (WhatsApp — Meta template names in subject_template / provider_meta)
-- ---------------------------------------------------------------------------
INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, provider_meta
)
SELECT NULL, 'pos.payment_confirmation', 'whatsapp', 'Payment confirmation (WhatsApp)',
  'nexus_payment_received',
  $body${{receipt_no}}|{{total}}|{{customer_name}}$body$,
  'plain',
  '{"whatsapp_template_name":"nexus_payment_received","whatsapp_language":"en","whatsapp_param_keys":["receipt_no","total","customer_name"]}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'pos.payment_confirmation' AND channel = 'whatsapp'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, provider_meta
)
SELECT NULL, 'accounting.invoice_reminder', 'whatsapp', 'Invoice reminder (WhatsApp)',
  'nexus_invoice_reminder',
  $body${{invoice_no}}|{{total}}|{{days_overdue}}$body$,
  'plain',
  '{"whatsapp_template_name":"nexus_invoice_reminder","whatsapp_language":"en","whatsapp_param_keys":["invoice_no","total","days_overdue"]}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'accounting.invoice_reminder' AND channel = 'whatsapp'
);

-- ---------------------------------------------------------------------------
-- WhatsApp channel settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_notification_whatsapp_settings(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg notification_channel_configs%ROWTYPE;
  v_token TEXT;
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_cfg
  FROM notification_channel_configs
  WHERE organization_id = p_org_id AND channel = 'whatsapp';

  v_token := NULLIF(trim(v_cfg.config->>'access_token'), '');

  RETURN jsonb_build_object(
    'is_enabled', COALESCE(v_cfg.is_enabled, false),
    'phone_number_id', COALESCE(v_cfg.config->>'phone_number_id', ''),
    'waba_id', COALESCE(v_cfg.config->>'waba_id', ''),
    'template_language', COALESCE(NULLIF(trim(v_cfg.config->>'template_language'), ''), 'en'),
    'has_custom_access_token', v_token IS NOT NULL,
    'access_token_hint', CASE
      WHEN v_token IS NULL THEN ''
      WHEN length(v_token) <= 8 THEN '••••'
      ELSE '••••' || right(v_token, 4)
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_notification_whatsapp_settings(
  p_org_id UUID,
  p_is_enabled BOOLEAN,
  p_phone_number_id TEXT,
  p_waba_id TEXT DEFAULT NULL,
  p_template_language TEXT DEFAULT 'en',
  p_access_token TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg notification_channel_configs%ROWTYPE;
  v_config JSONB;
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_cfg
  FROM notification_channel_configs
  WHERE organization_id = p_org_id AND channel = 'whatsapp';

  v_config := COALESCE(v_cfg.config, '{}'::jsonb);
  v_config := v_config || jsonb_build_object(
    'provider', 'meta_cloud_api',
    'phone_number_id', NULLIF(trim(p_phone_number_id), ''),
    'waba_id', NULLIF(trim(COALESCE(p_waba_id, '')), ''),
    'template_language', NULLIF(trim(COALESCE(p_template_language, 'en')), '')
  );

  IF p_access_token IS NOT NULL THEN
    IF trim(p_access_token) = '' THEN
      v_config := v_config - 'access_token';
    ELSE
      v_config := v_config || jsonb_build_object('access_token', trim(p_access_token));
    END IF;
  END IF;

  INSERT INTO notification_channel_configs (organization_id, channel, is_enabled, config)
  VALUES (p_org_id, 'whatsapp', p_is_enabled, v_config)
  ON CONFLICT (organization_id, channel) DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    config = EXCLUDED.config,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_notification_whatsapp_config_internal(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg notification_channel_configs%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM notification_channel_configs
  WHERE organization_id = p_org_id AND channel = 'whatsapp';

  RETURN jsonb_build_object(
    'is_enabled', COALESCE(v_cfg.is_enabled, false),
    'phone_number_id', NULLIF(trim(v_cfg.config->>'phone_number_id'), ''),
    'access_token', NULLIF(trim(v_cfg.config->>'access_token'), ''),
    'template_language', COALESCE(NULLIF(trim(v_cfg.config->>'template_language'), ''), 'en')
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Default rules — WhatsApp (inactive until manager enables)
-- ---------------------------------------------------------------------------
-- Rules engine — WhatsApp channel support
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
  v_whatsapp_enabled BOOLEAN;
  v_phone TEXT;
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
      ELSIF v_channel = 'whatsapp' THEN
        SELECT COALESCE((public.get_notification_whatsapp_config_internal(p_event.organization_id)->>'is_enabled')::boolean, false)
        INTO v_whatsapp_enabled;
        IF NOT v_whatsapp_enabled THEN
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
          ELSIF v_channel = 'whatsapp' THEN
            FOREACH v_phone IN ARRAY v_group.member_phones LOOP
              IF v_phone IS NULL OR trim(v_phone) = '' THEN CONTINUE; END IF;
              INSERT INTO notification_deliveries (
                organization_id, event_id, channel, recipient_type, recipient_ref,
                template_id, subject, body, body_format, idempotency_key
              ) VALUES (
                p_event.organization_id, p_event.id, 'whatsapp', 'whatsapp_phone', regexp_replace(trim(v_phone), '[^0-9]', '', 'g'),
                v_template.id, v_subject, v_body, v_template.body_format,
                p_event.id::text || ':rule:' || v_rule.id::text || ':wa:' || regexp_replace(trim(v_phone), '[^0-9]', '', 'g')
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
      IF v_rule.recipient_spec->>'use_customer_phone' = 'true' AND v_channel = 'whatsapp' THEN
        v_phone := NULLIF(regexp_replace(trim(COALESCE(v_payload->>'customer_phone', v_payload->>'phone', '')), '[^0-9]', '', 'g'), '');
        IF v_phone IS NOT NULL THEN
          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key
          ) VALUES (
            p_event.organization_id, p_event.id, 'whatsapp', 'whatsapp_phone', v_phone,
            v_template.id, v_subject, v_body, v_template.body_format,
            p_event.id::text || ':rule:' || v_rule.id::text || ':customer:' || v_phone
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END IF;
      END IF;

      IF v_rule.recipient_spec ? 'phones' AND v_channel = 'whatsapp' THEN
        FOR v_phone IN
          SELECT regexp_replace(trim(jsonb_array_elements_text(v_rule.recipient_spec->'phones')), '[^0-9]', '', 'g')
        LOOP
          IF v_phone IS NULL OR v_phone = '' THEN CONTINUE; END IF;
          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key
          ) VALUES (
            p_event.organization_id, p_event.id, 'whatsapp', 'whatsapp_phone', v_phone,
            v_template.id, v_subject, v_body, v_template.body_format,
            p_event.id::text || ':rule:' || v_rule.id::text || ':wa:' || v_phone
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END LOOP;
      END IF;

    END LOOP;
  END LOOP;

  RETURN v_created;
END;
$$;


-- WhatsApp default rules (append if missing)
DO $do$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    INSERT INTO notification_rules (
      organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
    )
    SELECT v_org, 'POS payment — customer WhatsApp', 'pos.sale_completed',
      '[{"field":"customer_phone","op":"neq","value":""}]'::jsonb,
      ARRAY['whatsapp']::notification_channel[],
      '{"use_customer_phone": true}'::jsonb,
      '{"whatsapp":"pos.payment_confirmation"}'::jsonb,
      70,
      false
    WHERE NOT EXISTS (
      SELECT 1 FROM notification_rules
      WHERE organization_id = v_org AND name = 'POS payment — customer WhatsApp'
    );

    INSERT INTO notification_rules (
      organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
    )
    SELECT v_org, 'Invoice reminder — customer WhatsApp', 'accounting.invoice_reminder',
      '[{"field":"customer_phone","op":"neq","value":""}]'::jsonb,
      ARRAY['whatsapp']::notification_channel[],
      '{"use_customer_phone": true}'::jsonb,
      '{"whatsapp":"accounting.invoice_reminder"}'::jsonb,
      80,
      false
    WHERE NOT EXISTS (
      SELECT 1 FROM notification_rules
      WHERE organization_id = v_org AND name = 'Invoice reminder — customer WhatsApp'
    );
  END LOOP;
END;
$do$;


CREATE OR REPLACE FUNCTION public.apply_whatsapp_delivery_status(
  p_provider_message_id TEXT,
  p_status TEXT,
  p_error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery_id UUID;
  v_mapped notification_delivery_status;
BEGIN
  IF p_provider_message_id IS NULL OR trim(p_provider_message_id) = '' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'missing_message_id');
  END IF;

  SELECT id INTO v_delivery_id
  FROM notification_deliveries
  WHERE provider_message_id = trim(p_provider_message_id)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_delivery_id IS NULL THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'delivery_not_found');
  END IF;

  v_mapped := CASE lower(trim(p_status))
    WHEN 'sent' THEN 'sent'::notification_delivery_status
    WHEN 'delivered' THEN 'delivered'::notification_delivery_status
    WHEN 'read' THEN 'read'::notification_delivery_status
    WHEN 'failed' THEN 'failed'::notification_delivery_status
    ELSE 'sent'::notification_delivery_status
  END;

  PERFORM public.complete_notification_delivery(
    v_delivery_id,
    v_mapped,
    trim(p_provider_message_id),
    jsonb_build_object('whatsapp_status', p_status),
    NULLIF(trim(p_error), '')
  );

  RETURN jsonb_build_object('updated', true, 'delivery_id', v_delivery_id, 'status', v_mapped::text);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_notification_whatsapp_settings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_notification_whatsapp_settings(UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_whatsapp_config_internal(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_delivery_status(TEXT, TEXT, TEXT) TO service_role;

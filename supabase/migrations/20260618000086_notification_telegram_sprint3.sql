-- Sprint 3: Telegram channel — config RPCs, templates, rules, daily sales report.

-- ---------------------------------------------------------------------------
-- System templates (Telegram)
-- ---------------------------------------------------------------------------
INSERT INTO notification_templates (organization_id, code, channel, name, subject_template, body_template, body_format)
SELECT NULL, 'pos.sale_completed.manager', 'telegram', 'POS sale completed (Telegram)',
  'Sale {{receipt_no}}',
  $body$Sale {{receipt_no}} completed for {{total}}.
Customer: {{customer_name}}
Store: {{store_name}}$body$,
  'plain'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'pos.sale_completed.manager' AND channel = 'telegram'
);

INSERT INTO notification_templates (organization_id, code, channel, name, subject_template, body_template, body_format)
SELECT NULL, 'inventory.low_stock.manager', 'telegram', 'Low stock alert (Telegram)',
  'Low stock: {{product_name}}',
  $body${{product_name}} ({{variant_name}}) at {{store_name}} is low: {{quantity}} left (reorder at {{reorder_point}}).$body$,
  'plain'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'inventory.low_stock.manager' AND channel = 'telegram'
);

INSERT INTO notification_templates (organization_id, code, channel, name, subject_template, body_template, body_format)
SELECT NULL, 'reports.daily_sales', 'telegram', 'Daily sales summary (Telegram)',
  'Daily sales — {{report_date}}',
  $body${{org_name}} — {{report_date}}

Transactions: {{transaction_count}}
Total sales: {{sales_total}}

Cash: {{cash_total}}
Mobile: {{mobile_total}}
Bank: {{bank_total}}$body$,
  'plain'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'reports.daily_sales' AND channel = 'telegram'
);

-- ---------------------------------------------------------------------------
-- Internal sales stats (no auth — cron / service role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._org_sales_stats_internal(p_organization_id UUID, p_store_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_bounds RECORD;
BEGIN
  SELECT * INTO v_bounds FROM public._org_local_day_bounds(p_organization_id);

  SELECT jsonb_build_object(
    'sales_total', COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed'), 0),
    'transaction_count', COUNT(*) FILTER (WHERE s.status = 'completed'),
    'cash_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'cash'
        AND s2.created_at >= v_bounds.day_start
        AND s2.created_at < v_bounds.day_end
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'mobile_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'mobile_money'
        AND s2.created_at >= v_bounds.day_start
        AND s2.created_at < v_bounds.day_end
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'bank_total', COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN sales s2 ON s2.id = p.sale_id
      WHERE s2.organization_id = p_organization_id
        AND s2.status = 'completed'
        AND p.method = 'bank_transfer'
        AND s2.created_at >= v_bounds.day_start
        AND s2.created_at < v_bounds.day_end
        AND (p_store_id IS NULL OR s2.store_id = p_store_id)
    ), 0),
    'report_date', to_char(v_bounds.local_day, 'YYYY-MM-DD'),
    'local_day', v_bounds.local_day
  ) INTO v_result
  FROM sales s
  WHERE s.organization_id = p_organization_id
    AND s.created_at >= v_bounds.day_start
    AND s.created_at < v_bounds.day_end
    AND (p_store_id IS NULL OR s.store_id = p_store_id);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Telegram channel settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_notification_telegram_settings(p_org_id UUID)
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
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_cfg
  FROM notification_channel_configs
  WHERE organization_id = p_org_id AND channel = 'telegram';

  v_token := NULLIF(trim(v_cfg.config->>'bot_token'), '');

  RETURN jsonb_build_object(
    'is_enabled', COALESCE(v_cfg.is_enabled, false),
    'default_chat_id', COALESCE(v_cfg.config->>'default_chat_id', ''),
    'has_custom_bot_token', v_token IS NOT NULL,
    'bot_token_hint', CASE
      WHEN v_token IS NULL THEN ''
      WHEN length(v_token) <= 8 THEN '••••'
      ELSE '••••' || right(v_token, 4)
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_notification_telegram_settings(
  p_org_id UUID,
  p_is_enabled BOOLEAN,
  p_default_chat_id TEXT,
  p_bot_token TEXT DEFAULT NULL
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
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_cfg
  FROM notification_channel_configs
  WHERE organization_id = p_org_id AND channel = 'telegram';

  v_config := COALESCE(v_cfg.config, '{}'::jsonb);
  v_config := v_config || jsonb_build_object(
    'provider', 'telegram',
    'default_chat_id', NULLIF(trim(p_default_chat_id), '')
  );

  IF p_bot_token IS NOT NULL THEN
    IF trim(p_bot_token) = '' THEN
      v_config := v_config - 'bot_token';
    ELSE
      v_config := v_config || jsonb_build_object('bot_token', trim(p_bot_token));
    END IF;
  END IF;

  INSERT INTO notification_channel_configs (organization_id, channel, is_enabled, config)
  VALUES (p_org_id, 'telegram', p_is_enabled, v_config)
  ON CONFLICT (organization_id, channel) DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    config = EXCLUDED.config,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_notification_telegram_config_internal(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg notification_channel_configs%ROWTYPE;
  v_org organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM notification_channel_configs
  WHERE organization_id = p_org_id AND channel = 'telegram';

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;

  RETURN jsonb_build_object(
    'is_enabled', COALESCE(v_cfg.is_enabled, false),
    'default_chat_id', NULLIF(trim(v_cfg.config->>'default_chat_id'), ''),
    'bot_token', NULLIF(trim(v_cfg.config->>'bot_token'), ''),
    'org_name', v_org.name
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Default rules — Telegram (inactive until manager enables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_notification_rules(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order
  )
  SELECT p_org_id, 'POS sale — manager in-app', 'pos.sale_completed', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"pos.sale_completed.manager"}'::jsonb,
    10
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND event_type = 'pos.sale_completed'
      AND name = 'POS sale — manager in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'High-value POS sale — owner email', 'pos.sale_completed',
    '[{"field":"payload.total","op":"gt","value":"10000"}]'::jsonb,
    ARRAY['email']::notification_channel[],
    '{"roles":["owner"]}'::jsonb,
    '{"email":"pos.sale_completed.high_value"}'::jsonb,
    20,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'High-value POS sale — owner email'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order
  )
  SELECT p_org_id, 'Low stock — manager in-app', 'inventory.low_stock', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"inventory.low_stock.manager"}'::jsonb,
    30
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND event_type = 'inventory.low_stock'
      AND name = 'Low stock — manager in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'POS sale — Telegram group', 'pos.sale_completed', '[]'::jsonb,
    ARRAY['telegram']::notification_channel[],
    '{"use_default_chat": true}'::jsonb,
    '{"telegram":"pos.sale_completed.manager"}'::jsonb,
    40,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'POS sale — Telegram group'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Low stock — Telegram group', 'inventory.low_stock', '[]'::jsonb,
    ARRAY['telegram']::notification_channel[],
    '{"use_default_chat": true}'::jsonb,
    '{"telegram":"inventory.low_stock.manager"}'::jsonb,
    50,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Low stock — Telegram group'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Daily sales report — Telegram', 'reports.daily_sales', '[]'::jsonb,
    ARRAY['telegram']::notification_channel[],
    '{"use_default_chat": true}'::jsonb,
    '{"telegram":"reports.daily_sales"}'::jsonb,
    60,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Daily sales report — Telegram'
  );
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_notification_rules(v_org);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Apply rules → deliveries (Telegram support)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notification_apply_rules_for_event(p_event notification_events)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
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

-- ---------------------------------------------------------------------------
-- Daily sales report → events (cron)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_daily_sales_telegram_reports(p_limit INT DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row RECORD;
  v_stats JSONB;
  v_enqueued INT := 0;
  v_key TEXT;
BEGIN
  FOR v_row IN
    SELECT
      ncc.organization_id,
      o.name AS org_name,
      NULLIF(trim(ncc.config->>'default_chat_id'), '') AS default_chat_id
    FROM notification_channel_configs ncc
    JOIN organizations o ON o.id = ncc.organization_id
    WHERE ncc.channel = 'telegram'
      AND ncc.is_enabled = true
      AND NULLIF(trim(ncc.config->>'default_chat_id'), '') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM notification_rules nr
        WHERE nr.organization_id = ncc.organization_id
          AND nr.event_type = 'reports.daily_sales'
          AND nr.is_active = true
          AND 'telegram' = ANY(nr.channels)
      )
    ORDER BY ncc.organization_id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  LOOP
    v_stats := public._org_sales_stats_internal(v_row.organization_id);
    v_key := 'daily_sales:' || v_row.organization_id::text || ':' || (v_stats->>'local_day');

    PERFORM public.enqueue_notification_event(
      v_row.organization_id,
      'reports.daily_sales',
      'organization',
      v_row.organization_id,
      jsonb_build_object(
        'org_name', v_row.org_name,
        'report_date', v_stats->>'report_date',
        'sales_total', v_stats->>'sales_total',
        'transaction_count', v_stats->>'transaction_count',
        'cash_total', v_stats->>'cash_total',
        'mobile_total', v_stats->>'mobile_total',
        'bank_total', v_stats->>'bank_total'
      ),
      v_key
    );
    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_enqueued);
END;
$$;

-- ---------------------------------------------------------------------------
-- process_notification_events — include reports.daily_sales
-- ---------------------------------------------------------------------------
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
      v_rule_created := public._notification_apply_rules_for_event(v_event);
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

GRANT EXECUTE ON FUNCTION public.get_notification_telegram_settings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_notification_telegram_settings(UUID, BOOLEAN, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_telegram_config_internal(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_daily_sales_telegram_reports(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public._org_sales_stats_internal(UUID, UUID) TO service_role;

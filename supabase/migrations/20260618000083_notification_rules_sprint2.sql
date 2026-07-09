-- Sprint 2: Rules engine, recipient groups, queue admin, low-stock scan.

-- ---------------------------------------------------------------------------
-- Recipient groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_recipient_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  member_user_ids UUID[] NOT NULL DEFAULT '{}',
  member_emails TEXT[] NOT NULL DEFAULT '{}',
  member_phones TEXT[] NOT NULL DEFAULT '{}',
  telegram_chat_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE notification_recipient_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_recipient_groups_rw ON notification_recipient_groups;
DROP POLICY IF EXISTS notification_recipient_groups_rw ON notification_recipient_groups;
CREATE POLICY notification_recipient_groups_rw ON notification_recipient_groups FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  channels notification_channel[] NOT NULL,
  recipient_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_codes JSONB NOT NULL DEFAULT '{}'::jsonb,
  store_ids UUID[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_rules_org_event
  ON notification_rules (organization_id, event_type)
  WHERE is_active = true;

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_rules_rw ON notification_rules;
CREATE POLICY notification_rules_rw ON notification_rules FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- System templates for rules
INSERT INTO notification_templates (organization_id, code, channel, name, subject_template, body_template, body_format)
SELECT NULL, 'pos.sale_completed.high_value', 'email', 'High-value POS sale alert',
  'Large sale: {{receipt_no}} — {{total}}',
  '<p>A sale of <strong>{{total}}</strong> was completed.</p><p>Receipt: {{receipt_no}}<br>Customer: {{customer_name}}<br>Store: {{store_id}}</p>',
  'html'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates WHERE organization_id IS NULL AND code = 'pos.sale_completed.high_value' AND channel = 'email'
);

INSERT INTO notification_templates (organization_id, code, channel, name, subject_template, body_template, body_format)
SELECT NULL, 'inventory.low_stock.manager', 'in_app', 'Low stock alert',
  'Low stock: {{product_name}}',
  '{{product_name}} ({{variant_name}}) at {{store_name}} is low: {{quantity}} left (reorder at {{reorder_point}}).',
  'plain'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates WHERE organization_id IS NULL AND code = 'inventory.low_stock.manager' AND channel = 'in_app'
);

-- ---------------------------------------------------------------------------
-- Condition evaluator
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notification_field_value(p_payload JSONB, p_field TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_path TEXT[];
  v_cur JSONB := p_payload;
  v_part TEXT;
BEGIN
  IF p_field IS NULL OR trim(p_field) = '' THEN
    RETURN NULL;
  END IF;
  v_path := string_to_array(p_field, '.');
  IF v_path[1] = 'payload' THEN
    v_path := v_path[2:array_length(v_path, 1)];
  END IF;
  FOREACH v_part IN ARRAY v_path LOOP
    IF v_cur IS NULL OR jsonb_typeof(v_cur) <> 'object' THEN
      RETURN NULL;
    END IF;
    v_cur := v_cur -> v_part;
  END LOOP;
  IF v_cur IS NULL OR v_cur = 'null'::jsonb THEN
    RETURN NULL;
  END IF;
  RETURN trim(both '"' from v_cur::text);
END;
$$;

CREATE OR REPLACE FUNCTION public._notification_conditions_match(
  p_conditions JSONB,
  p_payload JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_cond JSONB;
  v_field TEXT;
  v_op TEXT;
  v_expected TEXT;
  v_actual TEXT;
  v_actual_num NUMERIC;
  v_expected_num NUMERIC;
  v_arr JSONB;
  v_elem JSONB;
BEGIN
  IF p_conditions IS NULL OR jsonb_array_length(p_conditions) = 0 THEN
    RETURN true;
  END IF;

  FOR v_cond IN SELECT * FROM jsonb_array_elements(p_conditions) LOOP
    v_field := v_cond->>'field';
    v_op := lower(COALESCE(v_cond->>'op', 'eq'));
    v_actual := public._notification_field_value(p_payload, v_field);

  IF v_op = 'eq' THEN
      v_expected := v_cond->>'value';
      IF v_actual IS DISTINCT FROM v_expected THEN RETURN false; END IF;
    ELSIF v_op = 'ne' THEN
      v_expected := v_cond->>'value';
      IF v_actual IS NOT DISTINCT FROM v_expected THEN RETURN false; END IF;
    ELSIF v_op IN ('gt', 'gte', 'lt', 'lte') THEN
      v_actual_num := NULLIF(v_actual, '')::numeric;
      v_expected_num := (v_cond->>'value')::numeric;
      IF v_actual_num IS NULL OR v_expected_num IS NULL THEN RETURN false; END IF;
      IF v_op = 'gt' AND NOT (v_actual_num > v_expected_num) THEN RETURN false; END IF;
      IF v_op = 'gte' AND NOT (v_actual_num >= v_expected_num) THEN RETURN false; END IF;
      IF v_op = 'lt' AND NOT (v_actual_num < v_expected_num) THEN RETURN false; END IF;
      IF v_op = 'lte' AND NOT (v_actual_num <= v_expected_num) THEN RETURN false; END IF;
    ELSIF v_op = 'in' THEN
      v_arr := v_cond->'value';
      IF v_arr IS NULL OR jsonb_typeof(v_arr) <> 'array' THEN RETURN false; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_arr) e
        WHERE e #>> '{}' = v_actual
      ) THEN
        RETURN false;
      END IF;
    ELSE
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Default rules per org
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
END;
$$;

-- Seed defaults for existing orgs
DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_notification_rules(v_org);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Apply rules → deliveries for one event
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
  v_group_id UUID;
  v_group notification_recipient_groups%ROWTYPE;
  v_email_enabled BOOLEAN;
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

      -- Roles → users
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

      -- Explicit user IDs
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

      -- Recipient groups
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
          END IF;
        END LOOP;
      END IF;

      -- Direct emails
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
    END LOOP;
  END LOOP;

  RETURN v_created;
END;
$$;

-- ---------------------------------------------------------------------------
-- Low-stock scan → events (cron)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_low_stock_notification_events(p_limit INT DEFAULT 200)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row RECORD;
  v_enqueued INT := 0;
  v_key TEXT;
BEGIN
  FOR v_row IN
    SELECT
      il.organization_id,
      il.store_id,
      s.name AS store_name,
      il.variant_id,
      pv.name AS variant_name,
      p.name AS product_name,
      il.quantity,
      p.reorder_point
    FROM inventory_levels il
    JOIN stores s ON s.id = il.store_id
    JOIN product_variants pv ON pv.id = il.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE p.reorder_point > 0
      AND il.quantity <= p.reorder_point
    ORDER BY il.organization_id, il.store_id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
  LOOP
    v_key := 'low_stock:' || v_row.variant_id::text || ':' || v_row.store_id::text || ':' || current_date::text;

    PERFORM public.enqueue_notification_event(
      v_row.organization_id,
      'inventory.low_stock',
      'inventory_level',
      v_row.variant_id,
      jsonb_build_object(
        'store_id', v_row.store_id,
        'store_name', v_row.store_name,
        'variant_id', v_row.variant_id,
        'variant_name', v_row.variant_name,
        'product_name', v_row.product_name,
        'quantity', v_row.quantity,
        'reorder_point', v_row.reorder_point
      ),
      v_key
    );
    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_enqueued);
END;
$$;

-- ---------------------------------------------------------------------------
-- process_notification_events — rules for POS + inventory; legacy for invite/invoice
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

    IF v_event.event_type IN ('pos.sale_completed', 'inventory.low_stock', 'inventory.out_of_stock') THEN
      IF v_event.event_type = 'pos.sale_completed' THEN
        v_payload := v_payload || jsonb_build_object(
          'receipt_no', COALESCE(v_payload->>'receipt_no', ''),
          'total', COALESCE(v_payload->>'total', '0'),
          'customer_name', COALESCE(NULLIF(trim(v_payload->>'customer_name'), ''), 'Walk-in')
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

-- ---------------------------------------------------------------------------
-- Admin RPCs: rules, groups, queue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_notification_rules(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  PERFORM public.ensure_default_notification_rules(p_org_id);

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'sort_order')::int, row->>'name')
    FROM (
      SELECT jsonb_build_object(
        'id', r.id, 'name', r.name, 'event_type', r.event_type,
        'conditions', r.conditions, 'channels', r.channels,
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

CREATE OR REPLACE FUNCTION public.upsert_notification_rule(
  p_org_id UUID,
  p_rule_id UUID,
  p_name TEXT,
  p_event_type TEXT,
  p_conditions JSONB,
  p_channels notification_channel[],
  p_recipient_spec JSONB,
  p_template_codes JSONB,
  p_is_active BOOLEAN DEFAULT true,
  p_sort_order INT DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF p_rule_id IS NULL THEN
    INSERT INTO notification_rules (
      organization_id, name, event_type, conditions, channels,
      recipient_spec, template_codes, is_active, sort_order
    ) VALUES (
      p_org_id, trim(p_name), trim(p_event_type), COALESCE(p_conditions, '[]'::jsonb),
      p_channels, COALESCE(p_recipient_spec, '{}'::jsonb), COALESCE(p_template_codes, '{}'::jsonb),
      COALESCE(p_is_active, true), COALESCE(p_sort_order, 0)
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE notification_rules SET
      name = trim(p_name), event_type = trim(p_event_type),
      conditions = COALESCE(p_conditions, '[]'::jsonb),
      channels = p_channels,
      recipient_spec = COALESCE(p_recipient_spec, '{}'::jsonb),
      template_codes = COALESCE(p_template_codes, '{}'::jsonb),
      is_active = COALESCE(p_is_active, true),
      sort_order = COALESCE(p_sort_order, 0),
      updated_at = now()
    WHERE id = p_rule_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO notification_audit_log (organization_id, user_id, action, entity_type, entity_id, details)
  VALUES (p_org_id, auth.uid(), 'rule_upserted', 'notification_rules', v_id,
    jsonb_build_object('name', p_name, 'event_type', p_event_type));

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_notification_rule(p_org_id UUID, p_rule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  DELETE FROM notification_rules WHERE id = p_rule_id AND organization_id = p_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_notification_recipient_groups(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY row->>'name')
    FROM (
      SELECT jsonb_build_object(
        'id', g.id, 'name', g.name,
        'member_user_ids', g.member_user_ids,
        'member_emails', g.member_emails,
        'member_phones', g.member_phones,
        'telegram_chat_ids', g.telegram_chat_ids,
        'updated_at', g.updated_at
      ) AS row
      FROM notification_recipient_groups g
      WHERE g.organization_id = p_org_id
    ) sub
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_notification_recipient_group(
  p_org_id UUID,
  p_group_id UUID,
  p_name TEXT,
  p_member_user_ids UUID[] DEFAULT '{}',
  p_member_emails TEXT[] DEFAULT '{}',
  p_member_phones TEXT[] DEFAULT '{}',
  p_telegram_chat_ids TEXT[] DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF p_group_id IS NOT NULL THEN
    UPDATE notification_recipient_groups SET
      name = trim(p_name),
      member_user_ids = COALESCE(p_member_user_ids, '{}'),
      member_emails = COALESCE(p_member_emails, '{}'),
      member_phones = COALESCE(p_member_phones, '{}'),
      telegram_chat_ids = COALESCE(p_telegram_chat_ids, '{}'),
      updated_at = now()
    WHERE id = p_group_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO notification_recipient_groups (
    organization_id, name, member_user_ids, member_emails, member_phones, telegram_chat_ids
  ) VALUES (
    p_org_id, trim(p_name),
    COALESCE(p_member_user_ids, '{}'),
    COALESCE(p_member_emails, '{}'),
    COALESCE(p_member_phones, '{}'),
    COALESCE(p_telegram_chat_ids, '{}')
  )
  ON CONFLICT (organization_id, name) DO UPDATE SET
    member_user_ids = EXCLUDED.member_user_ids,
    member_emails = EXCLUDED.member_emails,
    member_phones = EXCLUDED.member_phones,
    telegram_chat_ids = EXCLUDED.telegram_chat_ids,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_notification_recipient_group(p_org_id UUID, p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  DELETE FROM notification_recipient_groups WHERE id = p_group_id AND organization_id = p_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_notification_queue(p_org_id UUID, p_status TEXT DEFAULT NULL, p_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY sort_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', d.id, 'channel', d.channel, 'recipient_ref', d.recipient_ref,
        'subject', d.subject, 'status', d.status, 'attempts', d.attempts,
        'max_attempts', d.max_attempts, 'last_error', d.last_error,
        'next_attempt_at', d.next_attempt_at, 'created_at', d.created_at,
        'event_type', e.event_type, 'event_id', e.id
      ) AS row,
      d.created_at AS sort_at
      FROM notification_deliveries d
      JOIN notification_events e ON e.id = d.event_id
      WHERE d.organization_id = p_org_id
        AND d.status IN ('pending', 'failed', 'processing', 'dead_letter')
        AND (p_status IS NULL OR d.status::text = p_status)
      ORDER BY d.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
    ) sub
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_notification_delivery(p_org_id UUID, p_delivery_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  UPDATE notification_deliveries
  SET status = 'pending', next_attempt_at = now(), last_error = NULL
  WHERE id = p_delivery_id
    AND organization_id = p_org_id
    AND status IN ('failed', 'dead_letter');

  INSERT INTO notification_audit_log (organization_id, user_id, action, entity_type, entity_id)
  VALUES (p_org_id, auth.uid(), 'delivery_retried', 'notification_deliveries', p_delivery_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_default_notification_rules(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.scan_low_stock_notification_events(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_notification_rules(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_notification_rule(UUID, UUID, TEXT, TEXT, JSONB, notification_channel[], JSONB, JSONB, BOOLEAN, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_notification_rule(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_notification_recipient_groups(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_notification_recipient_group(UUID, UUID, TEXT, UUID[], TEXT[], TEXT[], TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_notification_recipient_group(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_notification_queue(UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_notification_delivery(UUID, UUID) TO authenticated;

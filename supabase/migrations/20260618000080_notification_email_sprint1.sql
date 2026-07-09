-- Sprint 1: Email channel configs, templates API, invite + invoice reminder events.

-- ---------------------------------------------------------------------------
-- Channel configuration (per org)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_channel_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, channel)
);

ALTER TABLE notification_channel_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_channel_configs_select ON notification_channel_configs;
DROP POLICY IF EXISTS notification_channel_configs_select ON notification_channel_configs;
CREATE POLICY notification_channel_configs_select ON notification_channel_configs FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS notification_channel_configs_write ON notification_channel_configs;
DROP POLICY IF EXISTS notification_channel_configs_write ON notification_channel_configs;
CREATE POLICY notification_channel_configs_write ON notification_channel_configs FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Email templates (system defaults)
-- ---------------------------------------------------------------------------
INSERT INTO notification_templates (organization_id, code, channel, name, subject_template, body_template, body_format)
SELECT NULL, 'team.invite', 'email', 'Team invite email',
  'You''re invited to {{org_name}} on NexusERP',
  '<p>Hello,</p><p>{{inviter_name}} invited you to join <strong>{{org_name}}</strong> as <strong>{{role}}</strong>.</p><p><a href="{{invite_url}}">Accept invitation</a></p><p>If the button does not work, copy this link:<br>{{invite_url}}</p>',
  'html'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates WHERE organization_id IS NULL AND code = 'team.invite' AND channel = 'email'
);

INSERT INTO notification_templates (organization_id, code, channel, name, subject_template, body_template, body_format)
SELECT NULL, 'accounting.invoice_reminder', 'email', 'Invoice payment reminder',
  'Payment reminder: Invoice {{invoice_no}}',
  '<p>Hello {{customer_name}},</p><p>This is a friendly reminder that invoice <strong>{{invoice_no}}</strong> for <strong>{{total}}</strong> was due on {{due_date}} ({{days_overdue}} days overdue).</p><p>Please contact us to arrange payment.</p><p>Thank you,<br>{{org_name}}</p>',
  'html'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates WHERE organization_id IS NULL AND code = 'accounting.invoice_reminder' AND channel = 'email'
);

-- ---------------------------------------------------------------------------
-- Template resolver (org override → system default)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._resolve_notification_template(
  p_org_id UUID,
  p_code TEXT,
  p_channel notification_channel
)
RETURNS notification_templates
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row notification_templates%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM notification_templates
  WHERE organization_id = p_org_id
    AND code = p_code
    AND channel = p_channel
    AND is_active = true
  LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  SELECT * INTO v_row
  FROM notification_templates
  WHERE organization_id IS NULL
    AND code = p_code
    AND channel = p_channel
    AND is_active = true
  LIMIT 1;
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- Channel config RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_notification_email_settings(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg notification_channel_configs%ROWTYPE;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_cfg
  FROM notification_channel_configs
  WHERE organization_id = p_org_id AND channel = 'email';

  RETURN jsonb_build_object(
    'is_enabled', COALESCE(v_cfg.is_enabled, false),
    'from_name', COALESCE(v_cfg.config->>'from_name', ''),
    'from_email', COALESCE(v_cfg.config->>'from_email', ''),
    'reply_to', COALESCE(v_cfg.config->>'reply_to', ''),
    'provider', COALESCE(v_cfg.config->>'provider', 'resend')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_notification_email_settings(
  p_org_id UUID,
  p_is_enabled BOOLEAN,
  p_from_name TEXT,
  p_from_email TEXT,
  p_reply_to TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO notification_channel_configs (organization_id, channel, is_enabled, config, created_by)
  VALUES (
    p_org_id, 'email', COALESCE(p_is_enabled, false),
    jsonb_build_object(
      'provider', 'resend',
      'from_name', NULLIF(trim(p_from_name), ''),
      'from_email', NULLIF(trim(p_from_email), ''),
      'reply_to', NULLIF(trim(p_reply_to), '')
    ),
    auth.uid()
  )
  ON CONFLICT (organization_id, channel) DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    config = EXCLUDED.config,
    updated_at = now();

  INSERT INTO notification_audit_log (organization_id, user_id, action, entity_type, details)
  VALUES (p_org_id, auth.uid(), 'email_settings_updated', 'notification_channel_configs',
    jsonb_build_object('is_enabled', p_is_enabled));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_notification_email_config_internal(p_org_id UUID)
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
  WHERE organization_id = p_org_id AND channel = 'email';

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;

  RETURN jsonb_build_object(
    'is_enabled', COALESCE(v_cfg.is_enabled, false),
    'from_name', COALESCE(NULLIF(trim(v_cfg.config->>'from_name'), ''), v_org.name, 'NexusERP'),
    'from_email', COALESCE(NULLIF(trim(v_cfg.config->>'from_email'), ''), ''),
    'reply_to', NULLIF(trim(v_cfg.config->>'reply_to'), ''),
    'org_name', v_org.name
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Template list / upsert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_notification_templates(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY row->>'code', row->>'channel')
    FROM (
      SELECT jsonb_build_object(
        'id', t.id,
        'organization_id', t.organization_id,
        'code', t.code,
        'channel', t.channel,
        'name', t.name,
        'subject_template', t.subject_template,
        'body_template', t.body_template,
        'body_format', t.body_format,
        'is_active', t.is_active,
        'is_system', t.organization_id IS NULL,
        'updated_at', t.updated_at
      ) AS row
      FROM notification_templates t
      WHERE t.organization_id IS NULL OR t.organization_id = p_org_id
    ) sub
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_notification_template(
  p_org_id UUID,
  p_code TEXT,
  p_channel notification_channel,
  p_name TEXT,
  p_subject_template TEXT,
  p_body_template TEXT,
  p_body_format notification_content_format DEFAULT 'html',
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO notification_templates (
    organization_id, code, channel, name, subject_template, body_template, body_format, is_active
  ) VALUES (
    p_org_id, p_code, p_channel, p_name, p_subject_template, p_body_template,
    COALESCE(p_body_format, 'html'), COALESCE(p_is_active, true)
  )
  ON CONFLICT (organization_id, code, channel) DO UPDATE SET
    name = EXCLUDED.name,
    subject_template = EXCLUDED.subject_template,
    body_template = EXCLUDED.body_template,
    body_format = EXCLUDED.body_format,
    is_active = EXCLUDED.is_active,
    updated_at = now(),
    version = notification_templates.version + 1
  RETURNING id INTO v_id;

  INSERT INTO notification_audit_log (organization_id, user_id, action, entity_type, entity_id, details)
  VALUES (p_org_id, auth.uid(), 'template_upserted', 'notification_templates', v_id,
    jsonb_build_object('code', p_code, 'channel', p_channel));

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Invoice reminder: include customer email + enqueue helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_invoices_needing_reminder(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', ci.id,
        'invoice_no', ci.invoice_no,
        'customer_name', c.name,
        'customer_email', c.email,
        'due_date', ci.due_date,
        'total', ci.total,
        'days_overdue', current_date - ci.due_date,
        'last_reminded_at', (
          SELECT MAX(reminded_at) FROM invoice_reminder_logs irl WHERE irl.invoice_id = ci.id
        )
      ) ORDER BY ci.due_date
    )
    FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = p_org_id
      AND ci.status = 'posted'
      AND ci.due_date IS NOT NULL
      AND ci.due_date < current_date
      AND NOT EXISTS (
        SELECT 1 FROM invoice_reminder_logs irl
        WHERE irl.invoice_id = ci.id
          AND irl.reminded_at > now() - INTERVAL '7 days'
      )
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_invoice_reminder_notification(p_invoice_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_cust customers%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_event_id UUID;
  v_key TEXT;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT * INTO v_cust FROM customers WHERE id = v_inv.customer_id;
  SELECT * INTO v_org FROM organizations WHERE id = v_inv.organization_id;

  IF v_cust.email IS NULL OR trim(v_cust.email) = '' THEN
    RAISE EXCEPTION 'Customer has no email address';
  END IF;

  v_key := p_invoice_id::text || ':reminder:' || to_char(current_date, 'YYYY-MM-DD');

  v_event_id := public.enqueue_notification_event(
    v_inv.organization_id,
    'accounting.invoice_reminder',
    'customer_invoice',
    p_invoice_id,
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'invoice_no', v_inv.invoice_no,
      'customer_name', COALESCE(v_cust.name, 'Customer'),
      'customer_email', trim(v_cust.email),
      'due_date', v_inv.due_date,
      'total', v_inv.total,
      'days_overdue', current_date - v_inv.due_date,
      'org_name', v_org.name
    ),
    v_key
  );

  RETURN v_event_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Expand events → deliveries (POS in-app + email invite + email invoice)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_notification_events(p_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_template notification_templates%ROWTYPE;
  v_payload JSONB;
  v_subject TEXT;
  v_body TEXT;
  v_member RECORD;
  v_email TEXT;
  v_created INT := 0;
  v_processed INT := 0;
  v_email_enabled BOOLEAN;
BEGIN
  FOR v_event IN
    SELECT *
    FROM notification_events
    WHERE processed_at IS NULL
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_payload := v_event.payload;

    IF v_event.event_type = 'pos.sale_completed' THEN
      v_template := public._resolve_notification_template(
        v_event.organization_id, 'pos.sale_completed.manager', 'in_app'
      );

      v_payload := v_payload || jsonb_build_object(
        'receipt_no', COALESCE(v_payload->>'receipt_no', ''),
        'total', COALESCE(v_payload->>'total', '0'),
        'customer_name', COALESCE(NULLIF(trim(v_payload->>'customer_name'), ''), 'Walk-in')
      );

      IF v_template.id IS NULL THEN
        v_subject := 'Sale ' || COALESCE(v_payload->>'receipt_no', '');
        v_body := 'Sale completed for ' || COALESCE(v_payload->>'total', '0');
      ELSE
        v_subject := public._render_notification_template(v_template.subject_template, v_payload);
        v_body := public._render_notification_template(v_template.body_template, v_payload);
      END IF;

      FOR v_member IN
        SELECT om.user_id FROM organization_members om
        WHERE om.organization_id = v_event.organization_id AND om.role IN ('owner', 'manager')
      LOOP
        INSERT INTO notification_deliveries (
          organization_id, event_id, channel, recipient_type, recipient_ref,
          template_id, subject, body, body_format, idempotency_key
        ) VALUES (
          v_event.organization_id, v_event.id, 'in_app', 'user', v_member.user_id::text,
          v_template.id, v_subject, v_body, COALESCE(v_template.body_format, 'plain'),
          v_event.id::text || ':' || v_member.user_id::text || ':in_app'
        ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
        v_created := v_created + 1;
      END LOOP;

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
            template_id, subject, body, body_format, idempotency_key,
            attachments
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
  IF NOT public.user_can_manage(p_org_id) THEN
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

GRANT EXECUTE ON FUNCTION public.get_notification_email_settings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_notification_email_settings(UUID, BOOLEAN, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_notification_templates(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_notification_template(UUID, TEXT, notification_channel, TEXT, TEXT, TEXT, notification_content_format, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_invoice_reminder_notification(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_notification_delivery_history(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_email_config_internal(UUID) TO service_role;

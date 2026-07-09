-- Fix Telegram system templates corrupted during manual SQL apply ({{var}} → NULL).
-- NOTE: Superseded by 20260618000090_notification_hardening.sql (auto-repair + safer SQL).
-- Uses dollar-quoting so editors do not strip Mustache placeholders.

UPDATE notification_templates SET
  subject_template = 'Sale {{receipt_no}}',
  body_template = $body$Sale {{receipt_no}} completed for {{total}}.
Customer: {{customer_name}}
Store: {{store_name}}$body$,
  updated_at = now()
WHERE organization_id IS NULL
  AND code = 'pos.sale_completed.manager'
  AND channel = 'telegram';

UPDATE notification_templates SET
  subject_template = 'Low stock: {{product_name}}',
  body_template = $body${{product_name}} ({{variant_name}}) at {{store_name}} is low: {{quantity}} left (reorder at {{reorder_point}}).$body$,
  updated_at = now()
WHERE organization_id IS NULL
  AND code = 'inventory.low_stock.manager'
  AND channel = 'telegram';

UPDATE notification_templates SET
  subject_template = 'Daily sales — {{report_date}}',
  body_template = $body${{org_name}} — {{report_date}}

Transactions: {{transaction_count}}
Total sales: {{sales_total}}

Cash: {{cash_total}}
Mobile: {{mobile_total}}
Bank: {{bank_total}}$body$,
  updated_at = now()
WHERE organization_id IS NULL
  AND code = 'reports.daily_sales'
  AND channel = 'telegram';

-- Enrich POS sale payloads with formatted total + real store name before rules run.
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
  v_store_name TEXT;
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
        SELECT s.name INTO v_store_name
        FROM stores s
        WHERE s.id = NULLIF(v_payload->>'store_id', '')::uuid;

        v_payload := v_payload || jsonb_build_object(
          'receipt_no', COALESCE(NULLIF(trim(v_payload->>'receipt_no'), ''), '—'),
          'total', COALESCE(
            to_char(NULLIF(trim(v_payload->>'total'), '')::numeric, 'FM999999990.00'),
            '0.00'
          ),
          'customer_name', COALESCE(NULLIF(trim(v_payload->>'customer_name'), ''), 'Walk-in'),
          'store_name', COALESCE(NULLIF(trim(v_store_name), ''), NULLIF(trim(v_payload->>'store_name'), ''), 'Store')
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

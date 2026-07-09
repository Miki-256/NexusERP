-- Notification hardening: editor-safe template repair, richer renderer, POS payload enrichment.
-- Safe to paste in Supabase SQL editor (no bare {{placeholders}} in string literals).

-- ---------------------------------------------------------------------------
-- Repair corrupted system templates ({{var}} stripped to literal NULL by some SQL editors)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repair_notification_system_templates()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fixed INT := 0;
  v_n INT;
BEGIN
  UPDATE notification_templates SET
    subject_template = 'Sale ' || '{{' || 'receipt_no' || '}}',
    body_template =
      'Sale ' || '{{' || 'receipt_no' || '}}' || ' completed for ' || '{{' || 'total' || '}}.' || E'\n'
      || 'Customer: ' || '{{' || 'customer_name' || '}}' || E'\n'
      || 'Store: ' || '{{' || 'store_name' || '}}',
    updated_at = now()
  WHERE organization_id IS NULL
    AND code = 'pos.sale_completed.manager'
    AND channel = 'telegram'
    AND (subject_template LIKE '%NULL%' OR body_template NOT LIKE '%{{%');

  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_fixed := v_fixed + v_n;

  UPDATE notification_templates SET
    subject_template = 'Low stock: ' || '{{' || 'product_name' || '}}',
    body_template =
      '{{' || 'product_name' || '}}' || ' (' || '{{' || 'variant_name' || '}}' || ') at '
      || '{{' || 'store_name' || '}}' || ' is low: ' || '{{' || 'quantity' || '}}'
      || ' left (reorder at ' || '{{' || 'reorder_point' || '}}' || ').',
    updated_at = now()
  WHERE organization_id IS NULL
    AND code = 'inventory.low_stock.manager'
    AND channel = 'telegram'
    AND (subject_template LIKE '%NULL%' OR body_template NOT LIKE '%{{%');

  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_fixed := v_fixed + v_n;

  UPDATE notification_templates SET
    subject_template = 'Daily sales — ' || '{{' || 'report_date' || '}}',
    body_template =
      '{{' || 'org_name' || '}}' || ' — ' || '{{' || 'report_date' || '}}' || E'\n\n'
      || 'Transactions: ' || '{{' || 'transaction_count' || '}}' || E'\n'
      || 'Total sales: ' || '{{' || 'sales_total' || '}}' || E'\n\n'
      || 'Cash: ' || '{{' || 'cash_total' || '}}' || E'\n'
      || 'Mobile: ' || '{{' || 'mobile_total' || '}}' || E'\n'
      || 'Bank: ' || '{{' || 'bank_total' || '}}',
    updated_at = now()
  WHERE organization_id IS NULL
    AND code = 'reports.daily_sales'
    AND channel = 'telegram'
    AND (subject_template LIKE '%NULL%' OR body_template NOT LIKE '%{{%');

  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_fixed := v_fixed + v_n;

  RETURN jsonb_build_object('templates_repaired', v_fixed);
END;
$$;

SELECT public.repair_notification_system_templates();

-- ---------------------------------------------------------------------------
-- Template renderer — supports payload.* paths, strips unreplaced placeholders
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._render_notification_template(p_template TEXT, p_payload JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result TEXT := COALESCE(p_template, '');
  v_key TEXT;
  v_val TEXT;
  v_match TEXT[];
BEGIN
  FOR v_key, v_val IN SELECT * FROM jsonb_each_text(COALESCE(p_payload, '{}'::jsonb))
  LOOP
    v_result := replace(v_result, '{{' || v_key || '}}', COALESCE(v_val, ''));
    v_result := replace(v_result, '{{payload.' || v_key || '}}', COALESCE(v_val, ''));
  END LOOP;

  -- Remove any remaining {{placeholders}} (missing payload keys)
  LOOP
    v_match := regexp_match(v_result, '\{\{([^}]+)\}\}');
    EXIT WHEN v_match IS NULL;
    v_result := replace(v_result, '{{' || v_match[1] || '}}', '');
  END LOOP;

  RETURN trim(both E'\n' from v_result);
END;
$$;

-- ---------------------------------------------------------------------------
-- POS sale payload enrichment (formatted total + store name)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enrich_pos_sale_notification_payload(p_payload JSONB, p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload JSONB := COALESCE(p_payload, '{}'::jsonb);
  v_store_name TEXT;
BEGIN
  SELECT s.name INTO v_store_name
  FROM stores s
  WHERE s.id = NULLIF(v_payload->>'store_id', '')::uuid;

  RETURN v_payload || jsonb_build_object(
    'receipt_no', COALESCE(NULLIF(trim(v_payload->>'receipt_no'), ''), '—'),
    'total', COALESCE(
      to_char(NULLIF(trim(v_payload->>'total'), '')::numeric, 'FM999,999,990.00'),
      '0.00'
    ),
    'customer_name', COALESCE(NULLIF(trim(v_payload->>'customer_name'), ''), 'Walk-in'),
    'store_name', COALESCE(
      NULLIF(trim(v_store_name), ''),
      NULLIF(trim(v_payload->>'store_name'), ''),
      'Store'
    )
  );
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
  PERFORM public.repair_notification_system_templates();

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

GRANT EXECUTE ON FUNCTION public.repair_notification_system_templates() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public._enrich_pos_sale_notification_payload(JSONB, UUID) TO service_role;

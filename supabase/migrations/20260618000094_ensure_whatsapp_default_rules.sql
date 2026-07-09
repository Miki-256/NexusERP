-- Extend ensure_default_notification_rules with WhatsApp rules (Sprint 4).
-- Safe if 00093 already ran — uses WHERE NOT EXISTS guards.

CREATE OR REPLACE FUNCTION public.ensure_default_notification_rules(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.user_can_manage_communications(p_org_id) THEN
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

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'POS payment — customer WhatsApp', 'pos.sale_completed',
    '[{"field":"customer_phone","op":"neq","value":""}]'::jsonb,
    ARRAY['whatsapp']::notification_channel[],
    '{"use_customer_phone": true}'::jsonb,
    '{"whatsapp":"pos.payment_confirmation"}'::jsonb,
    70,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'POS payment — customer WhatsApp'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Invoice reminder — customer WhatsApp', 'accounting.invoice_reminder',
    '[{"field":"customer_phone","op":"neq","value":""}]'::jsonb,
    ARRAY['whatsapp']::notification_channel[],
    '{"use_customer_phone": true}'::jsonb,
    '{"whatsapp":"accounting.invoice_reminder"}'::jsonb,
    80,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Invoice reminder — customer WhatsApp'
  );
END;
$$;

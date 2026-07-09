-- Communications admin RPCs: allow owners/managers OR members with communications manage permission.

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

CREATE OR REPLACE FUNCTION public.list_notification_rules(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

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

GRANT EXECUTE ON FUNCTION public.user_can_manage_communications(UUID) TO authenticated;

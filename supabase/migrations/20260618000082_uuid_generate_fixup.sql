-- Fix: uuid_generate_v4() lives in extensions schema on Supabase; SECURITY DEFINER
-- functions with search_path = public cannot see it. Use built-in gen_random_uuid().

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.enqueue_notification_event(
  p_org_id UUID,
  p_event_type TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_idempotency_key TEXT DEFAULT NULL,
  p_priority notification_priority DEFAULT 'normal'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
  v_key TEXT := COALESCE(NULLIF(trim(p_idempotency_key), ''), gen_random_uuid()::text);
BEGIN
  INSERT INTO notification_events (
    organization_id, event_type, entity_type, entity_id, payload, priority, idempotency_key
  ) VALUES (
    p_org_id, p_event_type, p_entity_type, p_entity_id,
    COALESCE(p_payload, '{}'::jsonb), COALESCE(p_priority, 'normal'), v_key
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM notification_events
    WHERE organization_id = p_org_id AND idempotency_key = v_key;
  END IF;

  RETURN v_id;
END;
$$;

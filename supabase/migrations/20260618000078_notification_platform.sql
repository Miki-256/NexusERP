-- Sprint 0: Notification platform foundation (events, deliveries, in-app inbox).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE notification_channel AS ENUM (
    'email', 'whatsapp', 'telegram', 'in_app', 'webhook', 'sms', 'push', 'teams', 'slack'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_delivery_status AS ENUM (
    'pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'dead_letter', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_priority AS ENUM ('low', 'normal', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_content_format AS ENUM ('plain', 'html', 'markdown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority notification_priority NOT NULL DEFAULT 'normal',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_events_unprocessed
  ON notification_events (organization_id, created_at)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.notification_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  channel notification_channel NOT NULL,
  name TEXT NOT NULL,
  subject_template TEXT,
  body_template TEXT NOT NULL,
  body_format notification_content_format NOT NULL DEFAULT 'plain',
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code, channel)
);

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  recipient_type TEXT NOT NULL,
  recipient_ref TEXT NOT NULL,
  template_id UUID REFERENCES notification_templates(id) ON DELETE SET NULL,
  subject TEXT,
  body TEXT NOT NULL,
  body_format notification_content_format NOT NULL DEFAULT 'plain',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status notification_delivery_status NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_message_id TEXT,
  provider_response JSONB,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_worker
  ON notification_deliveries (next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delivery_id UUID REFERENCES notification_deliveries(id) ON DELETE SET NULL,
  event_type TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user
  ON in_app_notifications (user_id, organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_unread
  ON in_app_notifications (user_id, organization_id)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.notification_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE in_app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_events_select ON notification_events;
CREATE POLICY notification_events_select ON notification_events FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS notification_templates_select ON notification_templates;
CREATE POLICY notification_templates_select ON notification_templates FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id IN (SELECT public.user_organization_ids())
  );

DROP POLICY IF EXISTS notification_templates_write ON notification_templates;
CREATE POLICY notification_templates_write ON notification_templates FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS notification_deliveries_select ON notification_deliveries;
DROP POLICY IF EXISTS notification_deliveries_select ON notification_deliveries;
CREATE POLICY notification_deliveries_select ON notification_deliveries FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

DROP POLICY IF EXISTS in_app_notifications_select ON in_app_notifications;
CREATE POLICY in_app_notifications_select ON in_app_notifications FOR SELECT
  USING (user_id = auth.uid() AND organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS in_app_notifications_update ON in_app_notifications;
CREATE POLICY in_app_notifications_update ON in_app_notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_audit_select ON notification_audit_log;
CREATE POLICY notification_audit_select ON notification_audit_log FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Default system templates
-- ---------------------------------------------------------------------------
INSERT INTO notification_templates (organization_id, code, channel, name, subject_template, body_template, body_format)
SELECT NULL, 'pos.sale_completed.manager', 'in_app', 'POS sale completed (in-app)',
   'Sale {{receipt_no}}',
   'Sale {{receipt_no}} completed for {{total}}. Customer: {{customer_name}}.',
   'plain'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'pos.sale_completed.manager' AND channel = 'in_app'
);

-- ---------------------------------------------------------------------------
-- Template renderer (simple placeholder substitution)
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
BEGIN
  FOR v_key, v_val IN SELECT * FROM jsonb_each_text(COALESCE(p_payload, '{}'::jsonb))
  LOOP
    v_result := replace(v_result, '{{' || v_key || '}}', COALESCE(v_val, ''));
  END LOOP;
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Enqueue event (idempotent)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Expand events → delivery rows (Sprint 0: in-app for managers on POS sales)
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
  v_created INT := 0;
  v_processed INT := 0;
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
      SELECT * INTO v_template
      FROM notification_templates
      WHERE organization_id IS NULL
        AND code = 'pos.sale_completed.manager'
        AND channel = 'in_app'
        AND is_active = true
      LIMIT 1;

      v_payload := v_payload || jsonb_build_object(
        'receipt_no', COALESCE(v_payload->>'receipt_no', ''),
        'total', COALESCE(v_payload->>'total', '0'),
        'customer_name', COALESCE(NULLIF(trim(v_payload->>'customer_name'), ''), 'Walk-in')
      );

      IF NOT FOUND THEN
        v_subject := 'Sale ' || COALESCE(v_payload->>'receipt_no', '');
        v_body := 'Sale completed for ' || COALESCE(v_payload->>'total', '0');
      ELSE
        v_subject := public._render_notification_template(v_template.subject_template, v_payload);
        v_body := public._render_notification_template(v_template.body_template, v_payload);
      END IF;

      FOR v_member IN
        SELECT om.user_id
        FROM organization_members om
        WHERE om.organization_id = v_event.organization_id
          AND om.role IN ('owner', 'manager')
      LOOP
        INSERT INTO notification_deliveries (
          organization_id, event_id, channel, recipient_type, recipient_ref,
          template_id, subject, body, body_format, idempotency_key
        ) VALUES (
          v_event.organization_id, v_event.id, 'in_app', 'user', v_member.user_id::text,
          v_template.id, v_subject, v_body, v_template.body_format,
          v_event.id::text || ':' || v_member.user_id::text || ':in_app'
        )
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

        v_created := v_created + 1;
      END LOOP;
    END IF;

    UPDATE notification_events
    SET processed_at = now()
    WHERE id = v_event.id;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('events_processed', v_processed, 'deliveries_created', v_created);
END;
$$;

-- ---------------------------------------------------------------------------
-- Worker: claim deliveries
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_notification_deliveries(p_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  WITH picked AS (
    SELECT id
    FROM notification_deliveries
    WHERE status IN ('pending', 'failed')
      AND next_attempt_at <= now()
      AND attempts < max_attempts
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE notification_deliveries d
    SET status = 'processing', attempts = d.attempts + 1
    FROM picked
    WHERE d.id = picked.id
    RETURNING d.*
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'organization_id', u.organization_id,
      'event_id', u.event_id,
      'channel', u.channel,
      'recipient_type', u.recipient_type,
      'recipient_ref', u.recipient_ref,
      'subject', u.subject,
      'body', u.body,
      'body_format', u.body_format,
      'attachments', u.attachments,
      'attempts', u.attempts,
      'max_attempts', u.max_attempts
    )
  ), '[]'::jsonb)
  INTO v_rows
  FROM updated u;

  RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- Worker: complete delivery
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_notification_delivery(
  p_delivery_id UUID,
  p_status notification_delivery_status,
  p_provider_message_id TEXT DEFAULT NULL,
  p_provider_response JSONB DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_backoff INTERVAL;
  v_attempts INT;
  v_max INT;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max
  FROM notification_deliveries WHERE id = p_delivery_id;

  IF p_status IN ('sent', 'delivered', 'read') THEN
    UPDATE notification_deliveries
    SET
      status = p_status,
      provider_message_id = NULLIF(trim(p_provider_message_id), ''),
      provider_response = p_provider_response,
      last_error = NULL,
      sent_at = COALESCE(sent_at, now()),
      delivered_at = CASE WHEN p_status IN ('delivered', 'read') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
      next_attempt_at = now()
    WHERE id = p_delivery_id;
    RETURN;
  END IF;

  v_backoff := (LEAST(v_attempts, 6) * interval '1 minute');

  UPDATE notification_deliveries
  SET
    status = CASE WHEN v_attempts >= v_max THEN 'dead_letter'::notification_delivery_status ELSE 'failed'::notification_delivery_status END,
    last_error = NULLIF(trim(p_error), ''),
    provider_response = p_provider_response,
    next_attempt_at = now() + v_backoff
  WHERE id = p_delivery_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- In-app inbox
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_in_app_notifications(
  p_org_id UUID,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY row->>'created_at' DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', n.id,
        'title', n.title,
        'body', n.body,
        'link', n.link,
        'event_type', n.event_type,
        'read_at', n.read_at,
        'created_at', n.created_at
      ) AS row,
      n.created_at
      FROM in_app_notifications n
      WHERE n.organization_id = p_org_id AND n.user_id = auth.uid()
      ORDER BY n.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
      OFFSET GREATEST(0, COALESCE(p_offset, 0))
    ) sub
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.count_unread_in_app_notifications(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_org_access(p_org_id) THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::INT INTO v_count
  FROM in_app_notifications
  WHERE organization_id = p_org_id AND user_id = auth.uid() AND read_at IS NULL;

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_in_app_notification_read(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE in_app_notifications
  SET read_at = now()
  WHERE id = p_notification_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_in_app_notifications_read(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE in_app_notifications
  SET read_at = now()
  WHERE organization_id = p_org_id AND user_id = auth.uid() AND read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Communications dashboard stats
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_center_dashboard(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_today_start TIMESTAMPTZ;
  v_today_end TIMESTAMPTZ;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT day_start, day_end INTO v_today_start, v_today_end
  FROM public._org_local_day_bounds(p_org_id);

  RETURN jsonb_build_object(
    'sent_today', (
      SELECT COUNT(*) FROM notification_deliveries
      WHERE organization_id = p_org_id
        AND status IN ('sent', 'delivered', 'read')
        AND sent_at >= v_today_start AND sent_at < v_today_end
    ),
    'queued', (
      SELECT COUNT(*) FROM notification_deliveries
      WHERE organization_id = p_org_id AND status IN ('pending', 'processing', 'failed')
    ),
    'failed', (
      SELECT COUNT(*) FROM notification_deliveries
      WHERE organization_id = p_org_id AND status IN ('failed', 'dead_letter')
    ),
    'events_pending', (
      SELECT COUNT(*) FROM notification_events
      WHERE organization_id = p_org_id AND processed_at IS NULL
    ),
    'delivery_rate_pct', (
      SELECT CASE WHEN COUNT(*) = 0 THEN 100
        ELSE round(100.0 * COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')) / COUNT(*), 1)
      END
      FROM notification_deliveries
      WHERE organization_id = p_org_id
        AND created_at >= v_today_start AND created_at < v_today_end
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Register communications app + seed manager access
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.all_erp_app_ids()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'dashboard', 'pos', 'sales', 'invoicing', 'crm', 'customers', 'refunds', 'credits', 'receivables',
    'products', 'inventory', 'purchasing', 'manufacturing',
    'accounting', 'expenses', 'reports', 'documents',
    'hr', 'recruitment', 'timeoff', 'projects', 'helpdesk',
    'promotions', 'communications',
    'stores', 'team', 'settings'
  ]::TEXT[];
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_notification_event(UUID, TEXT, TEXT, UUID, JSONB, TEXT, notification_priority) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_notification_events(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_deliveries(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_delivery(UUID, notification_delivery_status, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_in_app_notifications(UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_unread_in_app_notifications(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_in_app_notification_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_in_app_notifications_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notification_center_dashboard(UUID) TO authenticated;

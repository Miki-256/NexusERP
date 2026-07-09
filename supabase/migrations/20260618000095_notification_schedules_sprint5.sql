-- Sprint 5: Scheduled reports — schedules table, runner RPCs, storage bucket.

-- ---------------------------------------------------------------------------
-- Storage bucket for generated report files
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'notification-reports',
  'notification-reports',
  false,
  10485760,
  ARRAY['text/csv', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Schedules table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  preset TEXT NOT NULL DEFAULT 'daily' CHECK (preset IN ('daily', 'weekly', 'monthly')),
  run_at_hour INT NOT NULL DEFAULT 7 CHECK (run_at_hour >= 0 AND run_at_hour <= 23),
  run_at_minute INT NOT NULL DEFAULT 0 CHECK (run_at_minute >= 0 AND run_at_minute <= 59),
  timezone TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
  channels notification_channel[] NOT NULL DEFAULT ARRAY['email']::notification_channel[],
  recipient_spec JSONB NOT NULL DEFAULT '{"roles":["owner","manager"]}'::jsonb,
  export_format TEXT NOT NULL DEFAULT 'csv' CHECK (export_format IN ('csv', 'pdf', 'xlsx')),
  is_active BOOLEAN NOT NULL DEFAULT false,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_notification_schedules_due
  ON notification_schedules (next_run_at)
  WHERE is_active = true;

ALTER TABLE notification_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_schedules_select ON notification_schedules;
CREATE POLICY notification_schedules_select ON notification_schedules FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS notification_schedules_write ON notification_schedules;
CREATE POLICY notification_schedules_write ON notification_schedules FOR ALL
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_communications(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_communications(organization_id)
  );

-- ---------------------------------------------------------------------------
-- Compute next run (preset + org-local wall clock)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notification_schedule_next_run(
  p_preset TEXT,
  p_hour INT,
  p_minute INT,
  p_timezone TEXT,
  p_from TIMESTAMPTZ DEFAULT now()
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_tz TEXT := COALESCE(NULLIF(trim(p_timezone), ''), 'Africa/Addis_Ababa');
  v_local TIMESTAMP;
  v_candidate TIMESTAMP;
  v_dow INT;
BEGIN
  v_local := (p_from AT TIME ZONE v_tz);

  IF p_preset = 'weekly' THEN
    v_dow := EXTRACT(ISODOW FROM v_local)::INT;
  END IF;

  v_candidate := date_trunc('day', v_local)
    + make_interval(hours => p_hour, mins => p_minute);

  IF p_preset = 'daily' THEN
    IF v_candidate <= v_local THEN
      v_candidate := v_candidate + interval '1 day';
    END IF;
  ELSIF p_preset = 'weekly' THEN
    v_candidate := date_trunc('day', v_local)
      + make_interval(days => ((8 - v_dow) % 7))
      + make_interval(hours => p_hour, mins => p_minute);
    IF v_candidate <= v_local THEN
      v_candidate := v_candidate + interval '7 days';
    END IF;
  ELSIF p_preset = 'monthly' THEN
    v_candidate := date_trunc('month', v_local)
      + make_interval(hours => p_hour, mins => p_minute);
    IF v_candidate <= v_local THEN
      v_candidate := (date_trunc('month', v_local) + interval '1 month')
        + make_interval(hours => p_hour, mins => p_minute);
    END IF;
  ELSE
    IF v_candidate <= v_local THEN
      v_candidate := v_candidate + interval '1 day';
    END IF;
  END IF;

  RETURN v_candidate AT TIME ZONE v_tz;
END;
$$;

-- ---------------------------------------------------------------------------
-- Report data (service role — no auth)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_scheduled_report_data_internal(
  p_org_id UUID,
  p_report_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_name TEXT;
  v_bounds RECORD;
  v_mtd_from DATE;
  v_mtd_to DATE;
  v_stats JSONB;
  v_pnl JSONB;
  v_rows JSONB;
BEGIN
  SELECT name INTO v_org_name FROM organizations WHERE id = p_org_id;
  SELECT * INTO v_bounds FROM public._org_local_day_bounds(p_org_id);
  v_mtd_from := date_trunc('month', v_bounds.local_day)::date;
  v_mtd_to := v_bounds.local_day;

  IF p_report_type = 'sales.daily' THEN
    v_stats := public._org_sales_stats_internal(p_org_id);
    RETURN jsonb_build_object(
      'org_name', v_org_name,
      'report_type', p_report_type,
      'report_date', v_stats->>'report_date',
      'summary', v_stats,
      'rows', '[]'::jsonb
    );
  ELSIF p_report_type = 'sales.weekly' THEN
    SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'date')), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'date', d::text,
        'sales_total', COALESCE((
          SELECT SUM(s.total) FROM sales s
          WHERE s.organization_id = p_org_id AND s.status = 'completed'
            AND s.created_at >= (d::timestamp AT TIME ZONE COALESCE(o.timezone, 'Africa/Addis_Ababa'))
            AND s.created_at < ((d + 1)::timestamp AT TIME ZONE COALESCE(o.timezone, 'Africa/Addis_Ababa'))
        ), 0),
        'transaction_count', COALESCE((
          SELECT COUNT(*) FROM sales s
          WHERE s.organization_id = p_org_id AND s.status = 'completed'
            AND s.created_at >= (d::timestamp AT TIME ZONE COALESCE(o.timezone, 'Africa/Addis_Ababa'))
            AND s.created_at < ((d + 1)::timestamp AT TIME ZONE COALESCE(o.timezone, 'Africa/Addis_Ababa'))
        ), 0)
      ) AS row
      FROM organizations o
      CROSS JOIN generate_series(v_bounds.local_day - 6, v_bounds.local_day, interval '1 day') AS d
      WHERE o.id = p_org_id
    ) sub;

    RETURN jsonb_build_object(
      'org_name', v_org_name,
      'report_type', p_report_type,
      'period_from', (v_bounds.local_day - 6)::text,
      'period_to', v_bounds.local_day::text,
      'rows', v_rows
    );
  ELSIF p_report_type = 'financial.pnl' THEN
    SELECT jsonb_build_object(
      'revenue', COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed'), 0),
      'transaction_count', COUNT(*) FILTER (WHERE s.status = 'completed'),
      'gross_sales', COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed'), 0)
    ) INTO v_pnl
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.created_at >= (v_mtd_from::timestamp AT TIME ZONE COALESCE(
        (SELECT timezone FROM organizations WHERE id = p_org_id), 'Africa/Addis_Ababa'))
      AND s.created_at < ((v_mtd_to + 1)::timestamp AT TIME ZONE COALESCE(
        (SELECT timezone FROM organizations WHERE id = p_org_id), 'Africa/Addis_Ababa'));

    RETURN jsonb_build_object(
      'org_name', v_org_name,
      'report_type', p_report_type,
      'period_from', v_mtd_from::text,
      'period_to', v_mtd_to::text,
      'summary', v_pnl,
      'rows', '[]'::jsonb
    );
  ELSIF p_report_type = 'inventory.stock' THEN
    SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'product_name'), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'store_name', s.name,
        'variant_name', pv.name,
        'product_name', p.name,
        'quantity', il.quantity,
        'reorder_point', p.reorder_point
      ) AS row_data
      FROM inventory_levels il
      JOIN stores s ON s.id = il.store_id
      JOIN product_variants pv ON pv.id = il.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE il.organization_id = p_org_id
        AND p.reorder_point > 0
        AND il.quantity <= p.reorder_point
      LIMIT 200
    ) sub;

    RETURN jsonb_build_object(
      'org_name', v_org_name,
      'report_type', p_report_type,
      'report_date', v_bounds.local_day::text,
      'rows', COALESCE(v_rows, '[]'::jsonb)
    );
  END IF;

  RETURN jsonb_build_object('org_name', v_org_name, 'report_type', p_report_type, 'rows', '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Claim due schedules (cron / worker)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_due_notification_schedules(p_limit INT DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row notification_schedules%ROWTYPE;
  v_claimed JSONB := '[]'::jsonb;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM notification_schedules
    WHERE is_active = true
      AND next_run_at <= now()
    ORDER BY next_run_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE notification_schedules SET
      last_run_at = now(),
      next_run_at = public._notification_schedule_next_run(
        v_row.preset, v_row.run_at_hour, v_row.run_at_minute, v_row.timezone, now()
      ),
      updated_at = now()
    WHERE id = v_row.id;

    v_claimed := v_claimed || jsonb_build_array(to_jsonb(v_row));
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('claimed', v_count, 'schedules', v_claimed);
END;
$$;

-- ---------------------------------------------------------------------------
-- Create deliveries for a completed scheduled report run
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_scheduled_report_deliveries(
  p_schedule_id UUID,
  p_subject TEXT,
  p_body TEXT,
  p_attachments JSONB DEFAULT '[]'::jsonb
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_schedule notification_schedules%ROWTYPE;
  v_event_id UUID;
  v_channel notification_channel;
  v_role TEXT;
  v_user_id UUID;
  v_email TEXT;
  v_chat_id TEXT;
  v_phone TEXT;
  v_created INT := 0;
  v_key TEXT;
BEGIN
  SELECT * INTO v_schedule FROM notification_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_key := 'scheduled:' || p_schedule_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI');

  INSERT INTO notification_events (
    organization_id, event_type, entity_type, entity_id, payload, idempotency_key
  ) VALUES (
    v_schedule.organization_id,
    'reports.scheduled',
    'notification_schedule',
    p_schedule_id,
    jsonb_build_object('schedule_id', p_schedule_id, 'report_type', v_schedule.report_type),
    v_key
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id FROM notification_events
    WHERE organization_id = v_schedule.organization_id AND idempotency_key = v_key;
  END IF;

  FOREACH v_channel IN ARRAY v_schedule.channels LOOP
    IF v_schedule.recipient_spec ? 'roles' THEN
      FOR v_role IN
        SELECT jsonb_array_elements_text(v_schedule.recipient_spec->'roles')
      LOOP
        FOR v_user_id IN
          SELECT om.user_id FROM organization_members om
          WHERE om.organization_id = v_schedule.organization_id AND om.role::text = v_role
        LOOP
          IF v_channel = 'in_app' THEN
            INSERT INTO notification_deliveries (
              organization_id, event_id, channel, recipient_type, recipient_ref,
              subject, body, body_format, attachments, idempotency_key
            ) VALUES (
              v_schedule.organization_id, v_event_id, 'in_app', 'user', v_user_id::text,
              p_subject, p_body, 'plain', p_attachments,
              v_key || ':' || v_user_id::text || ':in_app'
            ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
            v_created := v_created + 1;
          ELSIF v_channel = 'email' THEN
            SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_user_id;
            IF v_email IS NOT NULL AND trim(v_email) <> '' THEN
              INSERT INTO notification_deliveries (
                organization_id, event_id, channel, recipient_type, recipient_ref,
                subject, body, body_format, attachments, idempotency_key
              ) VALUES (
                v_schedule.organization_id, v_event_id, 'email', 'email', trim(v_email),
                p_subject, p_body, 'plain', p_attachments,
                v_key || ':' || trim(v_email) || ':email'
              ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
              v_created := v_created + 1;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
    END IF;

    IF v_schedule.recipient_spec->>'use_default_chat' = 'true' AND v_channel = 'telegram' THEN
      SELECT NULLIF(trim(public.get_notification_telegram_config_internal(v_schedule.organization_id)->>'default_chat_id'), '')
      INTO v_chat_id;
      IF v_chat_id IS NOT NULL THEN
        INSERT INTO notification_deliveries (
          organization_id, event_id, channel, recipient_type, recipient_ref,
          subject, body, body_format, attachments, idempotency_key
        ) VALUES (
          v_schedule.organization_id, v_event_id, 'telegram', 'telegram_chat', v_chat_id,
          p_subject, p_body, 'plain', p_attachments,
          v_key || ':default_tg:' || v_chat_id
        ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
        v_created := v_created + 1;
      END IF;
    END IF;

    IF v_schedule.recipient_spec ? 'telegram_chat_ids' AND v_channel = 'telegram' THEN
      FOR v_chat_id IN
        SELECT jsonb_array_elements_text(v_schedule.recipient_spec->'telegram_chat_ids')
      LOOP
        IF v_chat_id IS NULL OR trim(v_chat_id) = '' THEN CONTINUE; END IF;
        INSERT INTO notification_deliveries (
          organization_id, event_id, channel, recipient_type, recipient_ref,
          subject, body, body_format, attachments, idempotency_key
        ) VALUES (
          v_schedule.organization_id, v_event_id, 'telegram', 'telegram_chat', trim(v_chat_id),
          p_subject, p_body, 'plain', p_attachments,
          v_key || ':tg:' || trim(v_chat_id)
        ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
        v_created := v_created + 1;
      END LOOP;
    END IF;

    IF v_schedule.recipient_spec ? 'emails' AND v_channel = 'email' THEN
      FOR v_email IN
        SELECT jsonb_array_elements_text(v_schedule.recipient_spec->'emails')
      LOOP
        IF v_email IS NULL OR trim(v_email) = '' THEN CONTINUE; END IF;
        INSERT INTO notification_deliveries (
          organization_id, event_id, channel, recipient_type, recipient_ref,
          subject, body, body_format, attachments, idempotency_key
        ) VALUES (
          v_schedule.organization_id, v_event_id, 'email', 'email', trim(v_email),
          p_subject, p_body, 'plain', p_attachments,
          v_key || ':' || trim(v_email)
        ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
        v_created := v_created + 1;
      END LOOP;
    END IF;
  END LOOP;

  UPDATE notification_events SET processed_at = now() WHERE id = v_event_id;

  RETURN v_created;
END;
$$;

-- ---------------------------------------------------------------------------
-- Admin CRUD
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_notification_schedules(p_org_id UUID)
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
    SELECT jsonb_agg(row ORDER BY (row->>'name'))
    FROM (
      SELECT jsonb_build_object(
        'id', s.id, 'name', s.name, 'report_type', s.report_type,
        'preset', s.preset, 'run_at_hour', s.run_at_hour, 'run_at_minute', s.run_at_minute,
        'timezone', s.timezone, 'channels', to_jsonb(s.channels),
        'recipient_spec', s.recipient_spec, 'export_format', s.export_format,
        'is_active', s.is_active, 'last_run_at', s.last_run_at,
        'next_run_at', s.next_run_at, 'updated_at', s.updated_at
      ) AS row
      FROM notification_schedules s
      WHERE s.organization_id = p_org_id
    ) sub
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_notification_schedule(
  p_org_id UUID,
  p_schedule_id UUID,
  p_name TEXT,
  p_report_type TEXT,
  p_preset TEXT,
  p_run_at_hour INT,
  p_run_at_minute INT,
  p_timezone TEXT,
  p_channels notification_channel[],
  p_recipient_spec JSONB,
  p_export_format TEXT,
  p_is_active BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_tz TEXT;
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'Africa/Addis_Ababa');

  IF p_schedule_id IS NOT NULL THEN
    UPDATE notification_schedules SET
      name = p_name,
      report_type = p_report_type,
      preset = p_preset,
      run_at_hour = p_run_at_hour,
      run_at_minute = p_run_at_minute,
      timezone = v_tz,
      channels = p_channels,
      recipient_spec = COALESCE(p_recipient_spec, '{}'::jsonb),
      export_format = p_export_format,
      is_active = p_is_active,
      next_run_at = CASE
        WHEN p_is_active THEN public._notification_schedule_next_run(p_preset, p_run_at_hour, p_run_at_minute, v_tz, now())
        ELSE next_run_at
      END,
      updated_at = now()
    WHERE id = p_schedule_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO notification_schedules (
    organization_id, name, report_type, preset, run_at_hour, run_at_minute,
    timezone, channels, recipient_spec, export_format, is_active, next_run_at
  ) VALUES (
    p_org_id, p_name, p_report_type, p_preset, p_run_at_hour, p_run_at_minute,
    v_tz, p_channels, COALESCE(p_recipient_spec, '{}'::jsonb), p_export_format,
    p_is_active,
    public._notification_schedule_next_run(p_preset, p_run_at_hour, p_run_at_minute, v_tz, now())
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_notification_schedule(p_org_id UUID, p_schedule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  DELETE FROM notification_schedules WHERE id = p_schedule_id AND organization_id = p_org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Seed inactive presets per org
-- ---------------------------------------------------------------------------
DO $do$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    INSERT INTO notification_schedules (
      organization_id, name, report_type, preset, run_at_hour, channels,
      recipient_spec, export_format, is_active, next_run_at
    )
    SELECT v_org, 'Daily sales summary', 'sales.daily', 'daily', 7,
      ARRAY['telegram']::notification_channel[],
      '{"use_default_chat": true}'::jsonb, 'csv', false,
      public._notification_schedule_next_run('daily', 7, 0, 'Africa/Addis_Ababa', now())
    WHERE NOT EXISTS (
      SELECT 1 FROM notification_schedules WHERE organization_id = v_org AND name = 'Daily sales summary'
    );

    INSERT INTO notification_schedules (
      organization_id, name, report_type, preset, run_at_hour, channels,
      recipient_spec, export_format, is_active, next_run_at
    )
    SELECT v_org, 'Weekly sales report', 'sales.weekly', 'weekly', 8,
      ARRAY['email']::notification_channel[],
      '{"roles":["owner","manager"]}'::jsonb, 'pdf', false,
      public._notification_schedule_next_run('weekly', 8, 0, 'Africa/Addis_Ababa', now())
    WHERE NOT EXISTS (
      SELECT 1 FROM notification_schedules WHERE organization_id = v_org AND name = 'Weekly sales report'
    );

    INSERT INTO notification_schedules (
      organization_id, name, report_type, preset, run_at_hour, channels,
      recipient_spec, export_format, is_active, next_run_at
    )
    SELECT v_org, 'Monthly P&L', 'financial.pnl', 'monthly', 9,
      ARRAY['email']::notification_channel[],
      '{"roles":["owner"]}'::jsonb, 'pdf', false,
      public._notification_schedule_next_run('monthly', 9, 0, 'Africa/Addis_Ababa', now())
    WHERE NOT EXISTS (
      SELECT 1 FROM notification_schedules WHERE organization_id = v_org AND name = 'Monthly P&L'
    );

    INSERT INTO notification_schedules (
      organization_id, name, report_type, preset, run_at_hour, channels,
      recipient_spec, export_format, is_active, next_run_at
    )
    SELECT v_org, 'Low stock alert', 'inventory.stock', 'daily', 10,
      ARRAY['email']::notification_channel[],
      '{"roles":["owner","manager"]}'::jsonb, 'xlsx', false,
      public._notification_schedule_next_run('daily', 10, 0, 'Africa/Addis_Ababa', now())
    WHERE NOT EXISTS (
      SELECT 1 FROM notification_schedules WHERE organization_id = v_org AND name = 'Low stock alert'
    );
  END LOOP;
END;
$do$;

GRANT EXECUTE ON FUNCTION public.get_scheduled_report_data_internal(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_notification_schedules(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_scheduled_report_deliveries(UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_notification_schedules(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_notification_schedule(UUID, UUID, TEXT, TEXT, TEXT, INT, INT, TEXT, notification_channel[], JSONB, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_notification_schedule(UUID, UUID) TO authenticated;

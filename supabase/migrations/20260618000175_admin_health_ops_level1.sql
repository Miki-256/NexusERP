-- Super-admin Health Level 1: richer ops signals, heartbeat, retry failed ledger posts.

CREATE TABLE IF NOT EXISTS public.platform_ops_heartbeat (
  key TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_ops_heartbeat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_ops_heartbeat_select ON public.platform_ops_heartbeat;
CREATE POLICY platform_ops_heartbeat_select ON public.platform_ops_heartbeat
  FOR SELECT USING (public.platform_admin_can_read());

CREATE OR REPLACE FUNCTION public.record_platform_ops_heartbeat(
  p_key TEXT,
  p_result JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NULLIF(trim(COALESCE(p_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Heartbeat key required';
  END IF;

  INSERT INTO platform_ops_heartbeat (key, last_success_at, last_result, updated_at)
  VALUES (
    p_key,
    CASE WHEN COALESCE((p_result->>'ok')::boolean, false) THEN now() ELSE TIMESTAMPTZ 'epoch' END,
    COALESCE(p_result, '{}'::jsonb),
    now()
  )
  ON CONFLICT (key) DO UPDATE
  SET
    last_success_at = CASE
      WHEN COALESCE((EXCLUDED.last_result->>'ok')::boolean, false) THEN now()
      ELSE platform_ops_heartbeat.last_success_at
    END,
    last_result = EXCLUDED.last_result,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_platform_ops_heartbeat(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_platform_ops_heartbeat(TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_retry_sale_ledger_post(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry UUID;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sale_ledger_post_queue WHERE sale_id = p_sale_id) THEN
    RAISE EXCEPTION 'Sale is not in the ledger post queue';
  END IF;

  UPDATE sale_ledger_post_queue
  SET attempts = 0, last_error = NULL
  WHERE sale_id = p_sale_id;

  BEGIN
    v_entry := public.post_sale_to_ledger_internal(p_sale_id);
    DELETE FROM sale_ledger_post_queue WHERE sale_id = p_sale_id;
    RETURN jsonb_build_object(
      'ok', true,
      'sale_id', p_sale_id,
      'journal_entry_id', v_entry
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE sale_ledger_post_queue
    SET attempts = attempts + 1, last_error = SQLERRM
    WHERE sale_id = p_sale_id;
    RETURN jsonb_build_object(
      'ok', false,
      'sale_id', p_sale_id,
      'error', SQLERRM
    );
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_retry_sale_ledger_post(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_platform_health()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts JSONB;
  v_ledger_pending INT := 0;
  v_ledger_failed INT := 0;
  v_ledger_oldest TIMESTAMPTZ := NULL;
  v_webhook_pending INT := 0;
  v_webhook_oldest TIMESTAMPTZ := NULL;
  v_refund_pending INT := 0;
  v_refund_failed INT := 0;
  v_notif_pending INT := 0;
  v_notif_failed INT := 0;
  v_notif_events INT := 0;
  v_hr_pending INT := 0;
  v_hr_failed INT := 0;
  v_stale_rollups INT := 0;
  v_unposted_sales INT := 0;
  v_ledger_errors JSONB := '[]'::jsonb;
  v_org_backlog JSONB := '[]'::jsonb;
  v_org_unposted JSONB := '[]'::jsonb;
  v_heartbeat JSONB := NULL;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF to_regclass('public.sale_ledger_post_queue') IS NOT NULL THEN
    SELECT COUNT(*)::INT,
           COUNT(*) FILTER (WHERE attempts > 0)::INT,
           MIN(enqueued_at)
    INTO v_ledger_pending, v_ledger_failed, v_ledger_oldest
    FROM sale_ledger_post_queue;

    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'enqueued_at' DESC), '[]'::jsonb)
    INTO v_ledger_errors
    FROM (
      SELECT jsonb_build_object(
        'sale_id', q.sale_id,
        'organization_id', q.organization_id,
        'organization_name', o.name,
        'attempts', q.attempts,
        'last_error', q.last_error,
        'enqueued_at', q.enqueued_at
      ) AS row
      FROM sale_ledger_post_queue q
      LEFT JOIN organizations o ON o.id = q.organization_id
      WHERE q.last_error IS NOT NULL OR q.attempts > 0
      ORDER BY q.enqueued_at DESC
      LIMIT 15
    ) sub;

    SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'pending')::INT DESC), '[]'::jsonb)
    INTO v_org_backlog
    FROM (
      SELECT jsonb_build_object(
        'organization_id', q.organization_id,
        'organization_name', o.name,
        'pending', COUNT(*)::INT,
        'failed', COUNT(*) FILTER (WHERE q.attempts > 0)::INT,
        'oldest_enqueued_at', MIN(q.enqueued_at)
      ) AS row
      FROM sale_ledger_post_queue q
      LEFT JOIN organizations o ON o.id = q.organization_id
      GROUP BY q.organization_id, o.name
      ORDER BY COUNT(*) DESC
      LIMIT 10
    ) sub;
  END IF;

  IF to_regclass('public.payment_webhook_queue') IS NOT NULL THEN
    SELECT COUNT(*)::INT, MIN(created_at)
    INTO v_webhook_pending, v_webhook_oldest
    FROM payment_webhook_queue
    WHERE processed_at IS NULL;
  END IF;

  IF to_regclass('public.refund_void_ledger_queue') IS NOT NULL THEN
    SELECT COUNT(*)::INT,
           COUNT(*) FILTER (WHERE attempts > 0)::INT
    INTO v_refund_pending, v_refund_failed
    FROM refund_void_ledger_queue;
  END IF;

  IF to_regclass('public.notification_deliveries') IS NOT NULL THEN
    SELECT
      COUNT(*) FILTER (WHERE status IN ('pending', 'failed'))::INT,
      COUNT(*) FILTER (WHERE status = 'failed')::INT
    INTO v_notif_pending, v_notif_failed
    FROM notification_deliveries
    WHERE status IN ('pending', 'failed');
  END IF;

  IF to_regclass('public.notification_events') IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_notif_events
    FROM notification_events
    WHERE processed_at IS NULL;
  END IF;

  IF to_regclass('public.hr_webhook_queue') IS NOT NULL THEN
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::INT,
      COUNT(*) FILTER (WHERE status = 'failed')::INT
    INTO v_hr_pending, v_hr_failed
    FROM hr_webhook_queue
    WHERE status IN ('pending', 'failed');
  END IF;

  BEGIN
    SELECT COUNT(*)::INT INTO v_stale_rollups
    FROM public.rollup_freshness_stale_orgs(2);
  EXCEPTION WHEN OTHERS THEN
    v_stale_rollups := 0;
  END;

  SELECT COUNT(*)::INT INTO v_unposted_sales
  FROM sales s
  WHERE s.status = 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM payments p
      WHERE p.sale_id = s.id AND p.status = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.organization_id = s.organization_id
        AND je.source_type = 'sale'
        AND je.source_id = s.id
    );

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'unposted')::INT DESC), '[]'::jsonb)
  INTO v_org_unposted
  FROM (
    SELECT jsonb_build_object(
      'organization_id', o.id,
      'organization_name', o.name,
      'unposted', COUNT(*)::INT,
      'auto_post_enabled', COALESCE(o.pos_auto_post_sales, false)
    ) AS row
    FROM sales s
    JOIN organizations o ON o.id = s.organization_id
    WHERE s.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.sale_id = s.id AND p.status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.organization_id = s.organization_id
          AND je.source_type = 'sale'
          AND je.source_id = s.id
      )
    GROUP BY o.id, o.name, o.pos_auto_post_sales
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) sub;

  IF to_regclass('public.platform_ops_heartbeat') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'key', h.key,
      'last_success_at', h.last_success_at,
      'updated_at', h.updated_at,
      'last_ok', COALESCE((h.last_result->>'ok')::boolean, false),
      'last_result', h.last_result
    )
    INTO v_heartbeat
    FROM platform_ops_heartbeat h
    WHERE h.key = 'process_queue';
  END IF;

  SELECT jsonb_build_object(
    'organizations', (SELECT COUNT(*) FROM organizations),
    'organization_members', (SELECT COUNT(*) FROM organization_members WHERE is_active),
    'stores', (SELECT COUNT(*) FROM stores),
    'products', (SELECT COUNT(*) FROM products),
    'customers', (SELECT COUNT(*) FROM customers),
    'sales', (SELECT COUNT(*) FROM sales),
    'sales_completed', (SELECT COUNT(*) FROM sales WHERE status = 'completed'),
    'audit_logs', (SELECT COUNT(*) FROM audit_logs),
    'platform_audit_logs', (SELECT COUNT(*) FROM platform_audit_logs),
    'security_events', (SELECT COUNT(*) FROM platform_security_events)
  ) INTO v_counts;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'table_counts', v_counts,
    'estimated_rows', (SELECT SUM((value)::bigint) FROM jsonb_each_text(v_counts)),
    'orgs_by_status', jsonb_build_object(
      'active', (SELECT COUNT(*) FROM organizations WHERE status = 'active'),
      'pending', (SELECT COUNT(*) FROM organizations WHERE status = 'pending'),
      'suspended', (SELECT COUNT(*) FROM organizations WHERE status = 'suspended')
    ),
    'orgs_by_plan', COALESCE(
      (
        SELECT jsonb_object_agg(plan, cnt)
        FROM (
          SELECT plan, COUNT(*) AS cnt
          FROM organizations
          GROUP BY plan
        ) x
      ),
      '{}'::jsonb
    ),
    'recent_org_activity', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'organization_id', o.id,
            'organization_name', o.name,
            'plan', o.plan,
            'status', o.status,
            'last_sale_at', (
              SELECT MAX(s.created_at)
              FROM sales s
              WHERE s.organization_id = o.id AND s.status = 'completed'
            ),
            'sales_count', (SELECT COUNT(*) FROM sales s WHERE s.organization_id = o.id AND s.status = 'completed')
          )
          ORDER BY (
            SELECT MAX(s.created_at)
            FROM sales s
            WHERE s.organization_id = o.id AND s.status = 'completed'
          ) DESC NULLS LAST
        )
        FROM organizations o
        LIMIT 25
      ),
      '[]'::jsonb
    ),
    'inactive_orgs_30d', (
      SELECT COUNT(*)
      FROM organizations o
      WHERE NOT EXISTS (
        SELECT 1 FROM sales s
        WHERE s.organization_id = o.id
          AND s.status = 'completed'
          AND s.created_at >= now() - interval '30 days'
      )
      AND o.status = 'active'
    ),
    'ops', jsonb_build_object(
      'ledger_queue_pending', v_ledger_pending,
      'ledger_queue_failed', v_ledger_failed,
      'ledger_queue_oldest_at', v_ledger_oldest,
      'payment_webhook_queue_pending', v_webhook_pending,
      'payment_webhook_oldest_at', v_webhook_oldest,
      'refund_ledger_pending', v_refund_pending,
      'refund_ledger_failed', v_refund_failed,
      'notification_deliveries_pending', v_notif_pending,
      'notification_deliveries_failed', v_notif_failed,
      'notification_events_unprocessed', v_notif_events,
      'hr_webhook_pending', v_hr_pending,
      'hr_webhook_failed', v_hr_failed,
      'stale_rollup_orgs', v_stale_rollups,
      'unposted_completed_sales', v_unposted_sales,
      'ledger_queue_errors', v_ledger_errors,
      'org_ledger_backlog', v_org_backlog,
      'org_unposted_sales', v_org_unposted,
      'process_queue_heartbeat', v_heartbeat
    )
  );
END;
$$;

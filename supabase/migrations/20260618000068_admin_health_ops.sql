-- Extend platform admin health with background queue operational signals.

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
  v_webhook_pending INT := 0;
  v_ledger_errors JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF to_regclass('public.sale_ledger_post_queue') IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_ledger_pending FROM sale_ledger_post_queue;
    SELECT COUNT(*)::INT INTO v_ledger_failed
    FROM sale_ledger_post_queue WHERE attempts > 0;

    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'enqueued_at' DESC), '[]'::jsonb)
    INTO v_ledger_errors
    FROM (
      SELECT jsonb_build_object(
        'sale_id', q.sale_id,
        'organization_id', q.organization_id,
        'attempts', q.attempts,
        'last_error', q.last_error,
        'enqueued_at', q.enqueued_at
      ) AS row
      FROM sale_ledger_post_queue q
      WHERE q.last_error IS NOT NULL
      ORDER BY q.enqueued_at DESC
      LIMIT 10
    ) sub;
  END IF;

  IF to_regclass('public.payment_webhook_queue') IS NOT NULL THEN
    SELECT COUNT(*)::INT INTO v_webhook_pending
    FROM payment_webhook_queue
    WHERE processed_at IS NULL;
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
      'payment_webhook_queue_pending', v_webhook_pending,
      'ledger_queue_errors', v_ledger_errors
    )
  );
END;
$$;

-- EFM Wave 15 — Financial performance RPCs (requires 00160 schema)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._financial_cache_key(
  p_org_id UUID,
  p_report_type TEXT,
  p_from DATE,
  p_to DATE,
  p_as_of DATE,
  p_mode TEXT,
  p_params JSONB DEFAULT '{}'::jsonb
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(
    COALESCE(p_org_id::text, '') || '|' ||
    COALESCE(p_report_type, '') || '|' ||
    COALESCE(p_from::text, '') || '|' ||
    COALESCE(p_to::text, '') || '|' ||
    COALESCE(p_as_of::text, '') || '|' ||
    COALESCE(p_mode, '') || '|' ||
    COALESCE(p_params::text, '{}')
  );
$$;

CREATE OR REPLACE FUNCTION public._compute_financial_report(
  p_org_id UUID,
  p_report_type TEXT,
  p_from DATE,
  p_to DATE,
  p_as_of DATE,
  p_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT := lower(trim(p_report_type));
BEGIN
  IF v_type = 'profit_and_loss' THEN
    RETURN public.profit_and_loss(p_org_id, p_from, p_to, COALESCE(NULLIF(p_mode, ''), 'operational'));
  ELSIF v_type = 'balance_sheet' THEN
    RETURN public.balance_sheet(p_org_id, COALESCE(p_as_of, p_to));
  ELSIF v_type = 'trial_balance' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.trial_balance(p_org_id, COALESCE(p_as_of, p_to)) t
    );
  ELSIF v_type = 'cash_flow' THEN
    RETURN public.cash_flow(p_org_id, p_from, p_to);
  ELSIF v_type = 'executive_dashboard' THEN
    RETURN public.get_executive_financial_dashboard(p_org_id, p_from, p_to);
  ELSE
    RAISE EXCEPTION 'Unsupported report type: %', p_report_type;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Performance settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_financial_performance_settings(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;

  RETURN jsonb_build_object(
    'financial_cache_enabled', COALESCE(v_org.financial_cache_enabled, true),
    'financial_cache_ttl_minutes', COALESCE(v_org.financial_cache_ttl_minutes, 60),
    'financial_prefer_read_replica', COALESCE(v_org.financial_prefer_read_replica, true),
    'read_replica_note', 'Set SUPABASE_READ_URL in the app environment; reporting routes use createReportingClient().'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_financial_performance_settings(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_financial_performance_settings(
  p_org_id UUID,
  p_financial_cache_enabled BOOLEAN DEFAULT NULL,
  p_financial_cache_ttl_minutes INT DEFAULT NULL,
  p_financial_prefer_read_replica BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE organizations SET
    financial_cache_enabled = COALESCE(p_financial_cache_enabled, financial_cache_enabled),
    financial_cache_ttl_minutes = COALESCE(
      NULLIF(GREATEST(5, LEAST(COALESCE(p_financial_cache_ttl_minutes, financial_cache_ttl_minutes), 1440)), 0),
      financial_cache_ttl_minutes
    ),
    financial_prefer_read_replica = COALESCE(p_financial_prefer_read_replica, financial_prefer_read_replica)
  WHERE id = p_org_id;

  RETURN public.get_financial_performance_settings(p_org_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_financial_performance_settings(UUID, BOOLEAN, INT, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- Partition policies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_financial_partition_policies(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO financial_partition_policies (organization_id, table_name, strategy, retention_months, notes)
  SELECT p_org_id, 'journal_entries', 'brin_index', 84, 'BRIN index on entry_date for range scans'
  WHERE NOT EXISTS (
    SELECT 1 FROM financial_partition_policies
    WHERE organization_id = p_org_id AND table_name = 'journal_entries'
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO financial_partition_policies (organization_id, table_name, strategy, retention_months, notes)
  SELECT p_org_id, 'journal_entry_lines', 'archive', 60, 'Archive posted lines older than retention'
  WHERE NOT EXISTS (
    SELECT 1 FROM financial_partition_policies
    WHERE organization_id = p_org_id AND table_name = 'journal_entry_lines'
  );

  INSERT INTO financial_partition_policies (organization_id, table_name, strategy, retention_months, notes)
  SELECT p_org_id, 'sales', 'archive', 24, 'Uses sales_archive pipeline from Phase 3'
  WHERE NOT EXISTS (
    SELECT 1 FROM financial_partition_policies
    WHERE organization_id = p_org_id AND table_name = 'sales'
  );

  RETURN (
    SELECT COUNT(*)::INT FROM financial_partition_policies WHERE organization_id = p_org_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_financial_partition_policies(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_financial_partition_policies(p_org_id UUID)
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

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'table_name', p.table_name,
          'strategy', p.strategy,
          'retention_months', p.retention_months,
          'is_active', p.is_active,
          'last_maintenance_at', p.last_maintenance_at,
          'notes', p.notes
        )
        ORDER BY p.table_name
      )
      FROM financial_partition_policies p
      WHERE p.organization_id = p_org_id
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_financial_partition_policies(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_financial_partition_policy(
  p_org_id UUID,
  p_policy_id UUID,
  p_is_active BOOLEAN DEFAULT NULL,
  p_retention_months INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row financial_partition_policies%ROWTYPE;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE financial_partition_policies SET
    is_active = COALESCE(p_is_active, is_active),
    retention_months = COALESCE(
      NULLIF(GREATEST(12, p_retention_months), 0),
      retention_months
    )
  WHERE id = p_policy_id AND organization_id = p_org_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partition policy not found';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'table_name', v_row.table_name,
    'strategy', v_row.strategy,
    'retention_months', v_row.retention_months,
    'is_active', v_row.is_active,
    'last_maintenance_at', v_row.last_maintenance_at,
    'notes', v_row.notes
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_financial_partition_policy(UUID, UUID, BOOLEAN, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Report cache
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_financial_report(
  p_org_id UUID,
  p_report_type TEXT,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_as_of DATE DEFAULT NULL,
  p_mode TEXT DEFAULT 'operational',
  p_force_refresh BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_key TEXT;
  v_cached financial_report_cache%ROWTYPE;
  v_result JSONB;
  v_ttl INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  v_key := public._financial_cache_key(p_org_id, p_report_type, p_from, p_to, p_as_of, p_mode, '{}'::jsonb);
  v_ttl := COALESCE(v_org.financial_cache_ttl_minutes, 60);

  IF COALESCE(v_org.financial_cache_enabled, true) AND NOT COALESCE(p_force_refresh, false) THEN
    SELECT * INTO v_cached
    FROM financial_report_cache
    WHERE organization_id = p_org_id
      AND cache_key = v_key
      AND expires_at > v_now
    LIMIT 1;

    IF FOUND THEN
      UPDATE financial_report_cache
      SET hit_count = hit_count + 1
      WHERE id = v_cached.id;

      RETURN jsonb_build_object(
        'source', 'cache',
        'report_type', p_report_type,
        'cache_key', v_key,
        'computed_at', v_cached.computed_at,
        'expires_at', v_cached.expires_at,
        'hit_count', v_cached.hit_count + 1,
        'data', v_cached.result
      );
    END IF;
  END IF;

  v_result := public._compute_financial_report(p_org_id, p_report_type, p_from, p_to, p_as_of, p_mode);

  IF COALESCE(v_org.financial_cache_enabled, true) THEN
    INSERT INTO financial_report_cache (
      organization_id, cache_key, report_type,
      period_from, period_to, as_of, params, result, computed_at, expires_at
    )
    VALUES (
      p_org_id, v_key, lower(trim(p_report_type)),
      p_from, p_to, p_as_of, jsonb_build_object('mode', p_mode),
      v_result, v_now, v_now + (v_ttl || ' minutes')::interval
    )
    ON CONFLICT (organization_id, cache_key) DO UPDATE SET
      result = EXCLUDED.result,
      computed_at = EXCLUDED.computed_at,
      expires_at = EXCLUDED.expires_at,
      hit_count = 0;
  END IF;

  RETURN jsonb_build_object(
    'source', 'live',
    'report_type', p_report_type,
    'cache_key', v_key,
    'computed_at', v_now,
    'expires_at', CASE WHEN COALESCE(v_org.financial_cache_enabled, true)
      THEN v_now + (v_ttl || ' minutes')::interval ELSE NULL END,
    'data', v_result
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fetch_financial_report(UUID, TEXT, DATE, DATE, DATE, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.invalidate_financial_report_cache(
  p_org_id UUID,
  p_report_type TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM financial_report_cache
  WHERE organization_id = p_org_id
    AND (p_report_type IS NULL OR report_type = lower(trim(p_report_type)));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
GRANT EXECUTE ON FUNCTION public.invalidate_financial_report_cache(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.warm_financial_report_cache(
  p_org_id UUID,
  p_as_of DATE DEFAULT current_date
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from DATE := date_trunc('month', p_as_of)::date;
  v_to DATE := p_as_of;
  v_warmed INT := 0;
  v_item JSONB;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.fetch_financial_report(p_org_id, 'profit_and_loss', v_from, v_to, NULL, 'gl', true);
  v_warmed := v_warmed + 1;
  PERFORM public.fetch_financial_report(p_org_id, 'balance_sheet', NULL, v_to, v_to, 'operational', true);
  v_warmed := v_warmed + 1;
  PERFORM public.fetch_financial_report(p_org_id, 'trial_balance', NULL, v_to, v_to, 'operational', true);
  v_warmed := v_warmed + 1;
  PERFORM public.fetch_financial_report(p_org_id, 'cash_flow', v_from, v_to, NULL, 'operational', true);
  v_warmed := v_warmed + 1;
  v_item := public.fetch_financial_report(p_org_id, 'executive_dashboard', v_from, v_to, NULL, 'operational', true);
  v_warmed := v_warmed + 1;

  RETURN jsonb_build_object(
    'warmed', v_warmed,
    'period_from', v_from,
    'period_to', v_to,
    'as_of', v_to,
    'ran_at', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.warm_financial_report_cache(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Archive & maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_old_journal_entries(
  p_org_id UUID,
  p_before_date DATE,
  p_batch_size INT DEFAULT 100,
  p_dry_run BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry journal_entries%ROWTYPE;
  v_moved INT := 0;
  v_eligible INT := 0;
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_batch_size, 100), 500));
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_eligible
  FROM journal_entries je
  WHERE je.organization_id = p_org_id
    AND je.entry_date < p_before_date
    AND public._je_is_posted(je.entry_status)
    AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.journal_entry_id = je.id)
    AND NOT EXISTS (SELECT 1 FROM journal_entries_archive ja WHERE ja.id = je.id);

  IF COALESCE(p_dry_run, true) THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'eligible', v_eligible,
      'before_date', p_before_date,
      'batch_size', v_limit
    );
  END IF;

  FOR v_entry IN
    SELECT je.*
    FROM journal_entries je
    WHERE je.organization_id = p_org_id
      AND je.entry_date < p_before_date
      AND public._je_is_posted(je.entry_status)
      AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.journal_entry_id = je.id)
      AND NOT EXISTS (SELECT 1 FROM journal_entries_archive ja WHERE ja.id = je.id)
    ORDER BY je.entry_date
    LIMIT v_limit
  LOOP
    INSERT INTO journal_entry_lines_archive
    SELECT jel.*, now()
    FROM journal_entry_lines jel
    WHERE jel.entry_id = v_entry.id;

    INSERT INTO journal_entries_archive
    SELECT je.*, now(), date_trunc('month', je.entry_date)::date
    FROM journal_entries je
    WHERE je.id = v_entry.id;

    DELETE FROM journal_entry_lines WHERE entry_id = v_entry.id;
    DELETE FROM journal_entries WHERE id = v_entry.id;

    v_moved := v_moved + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', false,
    'eligible', v_eligible,
    'archived', v_moved,
    'before_date', p_before_date
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.archive_old_journal_entries(UUID, DATE, INT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_financial_partition_maintenance(
  p_org_id UUID,
  p_dry_run BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy financial_partition_policies%ROWTYPE;
  v_cutoff DATE;
  v_archive JSONB;
  v_sales INT := 0;
  v_results JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_financial_partition_policies(p_org_id);

  FOR v_policy IN
    SELECT * FROM financial_partition_policies
    WHERE organization_id = p_org_id AND is_active = true
  LOOP
    v_cutoff := (date_trunc('month', current_date) - (v_policy.retention_months || ' months')::interval)::date;

    IF v_policy.table_name = 'journal_entry_lines' AND v_policy.strategy = 'archive' THEN
      v_archive := public.archive_old_journal_entries(p_org_id, v_cutoff, 100, COALESCE(p_dry_run, true));
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'table_name', v_policy.table_name,
        'strategy', v_policy.strategy,
        'cutoff', v_cutoff,
        'result', v_archive
      ));
      IF NOT COALESCE(p_dry_run, true) THEN
        UPDATE financial_partition_policies
        SET last_maintenance_at = now()
        WHERE id = v_policy.id;
      END IF;
    ELSIF v_policy.table_name = 'sales' AND v_policy.strategy = 'archive' AND NOT COALESCE(p_dry_run, true) THEN
      v_sales := public.archive_cold_sales(v_policy.retention_months, 200);
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'table_name', 'sales',
        'strategy', 'archive',
        'archived', v_sales
      ));
      UPDATE financial_partition_policies
      SET last_maintenance_at = now()
      WHERE id = v_policy.id;
    ELSE
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'table_name', v_policy.table_name,
        'strategy', v_policy.strategy,
        'cutoff', v_cutoff,
        'note', CASE WHEN COALESCE(p_dry_run, true) THEN 'dry_run — no changes applied' ELSE 'index policy — no action required' END
      ));
      IF NOT COALESCE(p_dry_run, true) THEN
        UPDATE financial_partition_policies
        SET last_maintenance_at = now()
        WHERE id = v_policy.id;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', COALESCE(p_dry_run, true),
    'policies_processed', jsonb_array_length(v_results),
    'results', v_results,
    'ran_at', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_financial_partition_maintenance(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- Performance dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_financial_performance_dashboard(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings JSONB;
  v_cache JSONB;
  v_policies JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_settings := public.get_financial_performance_settings(p_org_id);
  v_policies := public.list_financial_partition_policies(p_org_id);

  SELECT jsonb_build_object(
    'entries', COUNT(*),
    'total_hits', COALESCE(SUM(hit_count), 0),
    'active_entries', COUNT(*) FILTER (WHERE expires_at > now()),
    'expired_entries', COUNT(*) FILTER (WHERE expires_at <= now()),
    'oldest_computed_at', MIN(computed_at),
    'newest_computed_at', MAX(computed_at)
  ) INTO v_cache
  FROM financial_report_cache
  WHERE organization_id = p_org_id;

  RETURN jsonb_build_object(
    'settings', v_settings,
    'table_counts', jsonb_build_object(
      'journal_entries', (SELECT COUNT(*) FROM journal_entries WHERE organization_id = p_org_id),
      'journal_entry_lines', (SELECT COUNT(*) FROM journal_entry_lines WHERE organization_id = p_org_id),
      'journal_entries_archived', (SELECT COUNT(*) FROM journal_entries_archive WHERE organization_id = p_org_id),
      'sales', (SELECT COUNT(*) FROM sales WHERE organization_id = p_org_id),
      'sales_archived', (SELECT COUNT(*) FROM sales_archive WHERE organization_id = p_org_id)
    ),
    'cache', COALESCE(v_cache, '{}'::jsonb),
    'partition_policies', v_policies,
    'indexes', jsonb_build_array(
      jsonb_build_object('name', 'idx_je_entry_date_brin', 'table', 'journal_entries', 'type', 'BRIN'),
      jsonb_build_object('name', 'idx_je_org_date', 'table', 'journal_entries', 'type', 'B-tree'),
      jsonb_build_object('name', 'idx_sales_created_brin', 'table', 'sales', 'type', 'BRIN')
    ),
    'generated_at', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_financial_performance_dashboard(UUID) TO authenticated;

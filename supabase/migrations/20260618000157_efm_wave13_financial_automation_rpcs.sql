-- EFM Wave 13 — Financial automation RPCs (requires 00156 schema)

-- ---------------------------------------------------------------------------
-- Notification template for financial automation alerts
-- ---------------------------------------------------------------------------
INSERT INTO notification_templates (organization_id, code, channel, name, subject_template, body_template, is_active)
SELECT NULL, 'accounting.automation_alert.manager', 'in_app', 'Financial automation alert (in-app)',
  '{{rule_name}}',
  '{{message}}',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'accounting.automation_alert.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (organization_id, code, channel, name, subject_template, body_template, is_active)
SELECT NULL, 'accounting.automation_alert.manager', 'email', 'Financial automation alert (email)',
  'Financial alert: {{rule_name}}',
  '{{message}}',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'accounting.automation_alert.manager' AND channel = 'email'
);

-- ---------------------------------------------------------------------------
-- Compare helper for threshold rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._financial_automation_compare(
  p_value NUMERIC,
  p_operator TEXT,
  p_threshold NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_operator
    WHEN 'lt' THEN RETURN p_value < p_threshold;
    WHEN 'lte' THEN RETURN p_value <= p_threshold;
    WHEN 'gt' THEN RETURN p_value > p_threshold;
    WHEN 'gte' THEN RETURN p_value >= p_threshold;
    WHEN 'eq' THEN RETURN p_value = p_threshold;
    ELSE RETURN false;
  END CASE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Default financial automation rules + notification rule
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_financial_automation_rules(p_org_id UUID)
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

  INSERT INTO financial_automation_rules (organization_id, name, rule_type, config, is_active)
  SELECT p_org_id, 'Negative net profit alert', 'kpi_threshold',
    '{"kpi_key":"net_profit","operator":"lt","threshold":0}'::jsonb, false
  WHERE NOT EXISTS (
    SELECT 1 FROM financial_automation_rules
    WHERE organization_id = p_org_id AND name = 'Negative net profit alert'
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO financial_automation_rules (organization_id, name, rule_type, config, is_active)
  SELECT p_org_id, 'Period close reminder (3 days)', 'period_close_reminder',
    '{"days_before_end":3}'::jsonb, false
  WHERE NOT EXISTS (
    SELECT 1 FROM financial_automation_rules
    WHERE organization_id = p_org_id AND name = 'Period close reminder (3 days)'
  );

  INSERT INTO financial_automation_rules (organization_id, name, rule_type, config, is_active)
  SELECT p_org_id, 'AR overdue 30+ days', 'ar_overdue',
    '{"min_days":30,"min_total":1000}'::jsonb, false
  WHERE NOT EXISTS (
    SELECT 1 FROM financial_automation_rules
    WHERE organization_id = p_org_id AND name = 'AR overdue 30+ days'
  );

  INSERT INTO financial_automation_rules (organization_id, name, rule_type, config, is_active)
  SELECT p_org_id, 'Low cash balance', 'cash_minimum',
    '{"kpi_key":"liquid","operator":"lt","threshold":10000}'::jsonb, false
  WHERE NOT EXISTS (
    SELECT 1 FROM financial_automation_rules
    WHERE organization_id = p_org_id AND name = 'Low cash balance'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, channels, recipient_spec, template_codes, is_active, sort_order
  )
  SELECT p_org_id, 'Financial automation alerts — managers', 'accounting.automation_alert',
    ARRAY['in_app', 'email']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"accounting.automation_alert.manager","email":"accounting.automation_alert.manager"}'::jsonb,
    true, 90
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND event_type = 'accounting.automation_alert'
  );

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_financial_automation_rules(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- CRUD — financial automation rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_financial_automation_rules(p_org_id UUID)
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

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'rule_type', r.rule_type,
        'config', r.config,
        'is_active', r.is_active,
        'cooldown_hours', r.cooldown_hours,
        'last_evaluated_at', r.last_evaluated_at,
        'last_triggered_at', r.last_triggered_at,
        'created_at', r.created_at
      ) ORDER BY r.name
    )
    FROM financial_automation_rules r
    WHERE r.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_financial_automation_rules(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_financial_automation_rule(
  p_org_id UUID,
  p_rule_id UUID,
  p_name TEXT,
  p_rule_type TEXT,
  p_config JSONB,
  p_is_active BOOLEAN DEFAULT true,
  p_cooldown_hours INT DEFAULT 24
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_rule_type NOT IN ('kpi_threshold', 'period_close_reminder', 'ar_overdue', 'cash_minimum') THEN
    RAISE EXCEPTION 'Invalid rule type';
  END IF;

  IF p_rule_id IS NOT NULL THEN
    UPDATE financial_automation_rules SET
      name = trim(p_name),
      rule_type = p_rule_type,
      config = COALESCE(p_config, '{}'::jsonb),
      is_active = COALESCE(p_is_active, true),
      cooldown_hours = GREATEST(1, LEAST(COALESCE(p_cooldown_hours, 24), 168)),
      updated_at = now()
    WHERE id = p_rule_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO financial_automation_rules (
      organization_id, name, rule_type, config, is_active, cooldown_hours, created_by
    ) VALUES (
      p_org_id, trim(p_name), p_rule_type, COALESCE(p_config, '{}'::jsonb),
      COALESCE(p_is_active, true),
      GREATEST(1, LEAST(COALESCE(p_cooldown_hours, 24), 168)),
      auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Rule not found';
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_financial_automation_rule(UUID, UUID, TEXT, TEXT, JSONB, BOOLEAN, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_financial_automation_rule(p_org_id UUID, p_rule_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM financial_automation_rules
  WHERE id = p_rule_id AND organization_id = p_org_id;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_financial_automation_rule(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Evaluate rules and enqueue notifications
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_financial_automation_rules(
  p_org_id UUID,
  p_as_of DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule financial_automation_rules%ROWTYPE;
  v_triggered INT := 0;
  v_evaluated INT := 0;
  v_month_from DATE;
  v_month_to DATE;
  v_dashboard JSONB;
  v_kpi JSONB;
  v_value NUMERIC;
  v_message TEXT;
  v_event_id UUID;
  v_period RECORD;
  v_ar JSONB;
  v_ar_total NUMERIC;
  v_key TEXT;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_financial_automation_rules(p_org_id);

  v_month_from := date_trunc('month', p_as_of)::date;
  v_month_to := (date_trunc('month', p_as_of) + interval '1 month - 1 day')::date;

  FOR v_rule IN
    SELECT * FROM financial_automation_rules
    WHERE organization_id = p_org_id AND is_active = true
    ORDER BY name
  LOOP
    v_evaluated := v_evaluated + 1;
    UPDATE financial_automation_rules SET last_evaluated_at = now() WHERE id = v_rule.id;

    IF v_rule.last_triggered_at IS NOT NULL
      AND v_rule.last_triggered_at + (v_rule.cooldown_hours || ' hours')::interval > now()
    THEN
      CONTINUE;
    END IF;

    v_message := NULL;

    IF v_rule.rule_type IN ('kpi_threshold', 'cash_minimum') THEN
      v_dashboard := public.get_executive_financial_dashboard(p_org_id, v_month_from, v_month_to);
      SELECT elem INTO v_kpi
      FROM jsonb_array_elements(v_dashboard->'kpis') elem
      WHERE elem->>'key' = COALESCE(v_rule.config->>'kpi_key', 'net_profit')
      LIMIT 1;

      v_value := COALESCE((v_kpi->>'value')::NUMERIC, 0);

      IF public._financial_automation_compare(
        v_value,
        COALESCE(v_rule.config->>'operator', 'lt'),
        COALESCE((v_rule.config->>'threshold')::NUMERIC, 0)
      ) THEN
        v_message := format(
          '%s is %s (threshold %s %s).',
          COALESCE(v_kpi->>'label', v_rule.config->>'kpi_key'),
          v_value,
          COALESCE(v_rule.config->>'operator', 'lt'),
          COALESCE(v_rule.config->>'threshold', '0')
        );
      END IF;

    ELSIF v_rule.rule_type = 'ar_overdue' THEN
      v_ar := public.accounts_receivable_aging(p_org_id, p_as_of);
      v_ar_total := COALESCE((
        SELECT SUM((r->>'amount')::NUMERIC)
        FROM jsonb_array_elements(COALESCE(v_ar->'rows', '[]'::jsonb)) r
        WHERE r->>'bucket' IN ('days_61_90', 'over_90')
      ), 0);

      IF v_ar_total >= COALESCE((v_rule.config->>'min_total')::NUMERIC, 0) THEN
        v_message := format(
          'Receivables overdue 60+ days total %s (minimum alert %s).',
          round(v_ar_total, 2),
          COALESCE(v_rule.config->>'min_total', '0')
        );
      END IF;

    ELSIF v_rule.rule_type = 'period_close_reminder' THEN
      SELECT fp.id, fp.name, fp.end_date, fp.status
      INTO v_period
      FROM fiscal_periods fp
      JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
      WHERE fp.organization_id = p_org_id
        AND fp.status = 'open'
        AND fp.end_date >= p_as_of
      ORDER BY fp.end_date
      LIMIT 1;

      IF FOUND
        AND v_period.end_date <= p_as_of + COALESCE((v_rule.config->>'days_before_end')::INT, 3)
      THEN
        v_message := format(
          'Fiscal period %s closes on %s — start close checklist.',
          v_period.name,
          v_period.end_date
        );
      END IF;
    END IF;

    IF v_message IS NOT NULL THEN
      v_key := 'automation:' || v_rule.id::text || ':' || to_char(now(), 'YYYYMMDD');
      v_event_id := public.enqueue_notification_event(
        p_org_id,
        'accounting.automation_alert',
        'financial_automation_rule',
        v_rule.id,
        jsonb_build_object(
          'rule_id', v_rule.id,
          'rule_name', v_rule.name,
          'rule_type', v_rule.rule_type,
          'message', v_message,
          'as_of', p_as_of::text
        ),
        v_key
      );

      IF v_event_id IS NOT NULL THEN
        UPDATE financial_automation_rules SET last_triggered_at = now() WHERE id = v_rule.id;
        v_triggered := v_triggered + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'evaluated', v_evaluated,
    'triggered', v_triggered,
    'as_of', p_as_of
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.evaluate_financial_automation_rules(UUID, DATE) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Financial scheduled reports (wraps notification_schedules)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_financial_scheduled_reports(p_org_id UUID)
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
        AND s.report_type LIKE 'financial.%'
    ) sub
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_financial_scheduled_reports(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_financial_scheduled_report(
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
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_report_type IS NULL OR p_report_type NOT LIKE 'financial.%' THEN
    RAISE EXCEPTION 'Report type must start with financial.';
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
      recipient_spec = COALESCE(p_recipient_spec, '{"roles":["owner","manager"]}'::jsonb),
      export_format = p_export_format,
      is_active = p_is_active,
      next_run_at = CASE
        WHEN p_is_active THEN public._notification_schedule_next_run(p_preset, p_run_at_hour, p_run_at_minute, v_tz, now())
        ELSE next_run_at
      END,
      updated_at = now()
    WHERE id = p_schedule_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO notification_schedules (
      organization_id, name, report_type, preset, run_at_hour, run_at_minute,
      timezone, channels, recipient_spec, export_format, is_active, next_run_at
    ) VALUES (
      p_org_id, p_name, p_report_type, p_preset, p_run_at_hour, p_run_at_minute,
      v_tz, p_channels,
      COALESCE(p_recipient_spec, '{"roles":["owner","manager"]}'::jsonb),
      p_export_format, p_is_active,
      public._notification_schedule_next_run(p_preset, p_run_at_hour, p_run_at_minute, v_tz, now())
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_financial_scheduled_report(UUID, UUID, TEXT, TEXT, TEXT, INT, INT, TEXT, notification_channel[], JSONB, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_default_financial_scheduled_reports(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_count INT := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(timezone, 'Africa/Addis_Ababa') INTO v_tz FROM organizations WHERE id = p_org_id;

  INSERT INTO notification_schedules (
    organization_id, name, report_type, preset, run_at_hour, channels,
    recipient_spec, export_format, is_active, next_run_at
  )
  SELECT p_org_id, 'Monthly GL P&L', 'financial.pnl', 'monthly', 9,
    ARRAY['email']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb, 'pdf', false,
    public._notification_schedule_next_run('monthly', 9, 0, v_tz, now())
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_schedules
    WHERE organization_id = p_org_id AND report_type = 'financial.pnl' AND name = 'Monthly GL P&L'
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO notification_schedules (
    organization_id, name, report_type, preset, run_at_hour, channels,
    recipient_spec, export_format, is_active, next_run_at
  )
  SELECT p_org_id, 'Monthly balance sheet', 'financial.balance_sheet', 'monthly', 9,
    ARRAY['email']::notification_channel[],
    '{"roles":["owner"]}'::jsonb, 'pdf', false,
    public._notification_schedule_next_run('monthly', 9, 0, v_tz, now())
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_schedules
    WHERE organization_id = p_org_id AND report_type = 'financial.balance_sheet'
  );

  INSERT INTO notification_schedules (
    organization_id, name, report_type, preset, run_at_hour, channels,
    recipient_spec, export_format, is_active, next_run_at
  )
  SELECT p_org_id, 'Weekly executive summary', 'financial.executive', 'weekly', 8,
    ARRAY['email', 'in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb, 'pdf', false,
    public._notification_schedule_next_run('weekly', 8, 0, v_tz, now())
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_schedules
    WHERE organization_id = p_org_id AND report_type = 'financial.executive'
  );

  INSERT INTO notification_schedules (
    organization_id, name, report_type, preset, run_at_hour, channels,
    recipient_spec, export_format, is_active, next_run_at
  )
  SELECT p_org_id, 'Weekly AR aging', 'financial.ar_aging', 'weekly', 8,
    ARRAY['email']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb, 'csv', false,
    public._notification_schedule_next_run('weekly', 8, 0, v_tz, now())
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_schedules
    WHERE organization_id = p_org_id AND report_type = 'financial.ar_aging'
  );

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_financial_scheduled_reports(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Extended scheduled report data — GL financial reports
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
  v_bs JSONB;
  v_ar JSONB;
  v_exec JSONB;
  v_rows JSONB;
  v_kpi JSONB;
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
    v_pnl := public.profit_and_loss(p_org_id, v_mtd_from, v_mtd_to, 'gl');
    RETURN jsonb_build_object(
      'org_name', v_org_name,
      'report_type', p_report_type,
      'period_from', v_mtd_from::text,
      'period_to', v_mtd_to::text,
      'summary', jsonb_build_object(
        'revenue', COALESCE((v_pnl->>'revenue')::NUMERIC, 0),
        'cogs', COALESCE((v_pnl->>'cogs')::NUMERIC, 0),
        'gross_profit', COALESCE((v_pnl->>'gross_profit')::NUMERIC, 0),
        'operating_expenses', COALESCE((v_pnl->>'operating_expenses')::NUMERIC, 0),
        'net_profit', COALESCE((v_pnl->>'net_profit')::NUMERIC, 0),
        'gross_margin_pct', COALESCE((v_pnl->>'gross_margin_pct')::NUMERIC, 0),
        'net_margin_pct', COALESCE((v_pnl->>'net_margin_pct')::NUMERIC, 0)
      ),
      'rows', '[]'::jsonb
    );
  ELSIF p_report_type = 'financial.balance_sheet' THEN
    v_bs := public.balance_sheet(p_org_id, v_mtd_to);
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object('section', 'Assets', 'account', l->>'name', 'amount', (l->>'amount')::NUMERIC)
    ), '[]'::jsonb) INTO v_rows
    FROM jsonb_array_elements(COALESCE(v_bs->'assets', '[]'::jsonb)) l;

    v_rows := v_rows || COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('section', 'Liabilities', 'account', l->>'name', 'amount', (l->>'amount')::NUMERIC)
      )
      FROM jsonb_array_elements(COALESCE(v_bs->'liabilities', '[]'::jsonb)) l
    ), '[]'::jsonb);

    v_rows := v_rows || COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('section', 'Equity', 'account', l->>'name', 'amount', (l->>'amount')::NUMERIC)
      )
      FROM jsonb_array_elements(COALESCE(v_bs->'equity', '[]'::jsonb)) l
    ), '[]'::jsonb);

    RETURN jsonb_build_object(
      'org_name', v_org_name,
      'report_type', p_report_type,
      'report_date', v_mtd_to::text,
      'summary', jsonb_build_object(
        'total_assets', COALESCE((v_bs->>'total_assets')::NUMERIC, 0),
        'total_liabilities', COALESCE((v_bs->>'total_liabilities')::NUMERIC, 0),
        'total_equity', COALESCE((v_bs->>'total_equity')::NUMERIC, 0),
        'balanced', COALESCE((v_bs->>'balanced')::BOOLEAN, false)
      ),
      'rows', COALESCE(v_rows, '[]'::jsonb)
    );
  ELSIF p_report_type = 'financial.ar_aging' THEN
    v_ar := public.accounts_receivable_aging(p_org_id, v_mtd_to);
    RETURN jsonb_build_object(
      'org_name', v_org_name,
      'report_type', p_report_type,
      'report_date', v_mtd_to::text,
      'summary', COALESCE(v_ar->'buckets', '{}'::jsonb) || jsonb_build_object('total', COALESCE((v_ar->>'total')::NUMERIC, 0)),
      'rows', COALESCE(v_ar->'rows', '[]'::jsonb)
    );
  ELSIF p_report_type = 'financial.executive' THEN
    v_exec := public.get_executive_financial_dashboard(p_org_id, v_mtd_from, v_mtd_to);
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'kpi', k->>'label',
        'value', (k->>'value')::NUMERIC,
        'prior_value', NULLIF(k->>'prior_value', '')::NUMERIC,
        'variance_pct', NULLIF(k->>'variance_pct', '')::NUMERIC,
        'target_value', NULLIF(k->>'target_value', '')::NUMERIC
      ) ORDER BY k->>'label'
    ), '[]'::jsonb)
    INTO v_rows
    FROM jsonb_array_elements(COALESCE(v_exec->'kpis', '[]'::jsonb)) k;

    RETURN jsonb_build_object(
      'org_name', v_org_name,
      'report_type', p_report_type,
      'period_from', v_mtd_from::text,
      'period_to', v_mtd_to::text,
      'summary', jsonb_build_object(
        'kpi_count', jsonb_array_length(COALESCE(v_exec->'kpis', '[]'::jsonb))
      ),
      'rows', COALESCE(v_rows, '[]'::jsonb)
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

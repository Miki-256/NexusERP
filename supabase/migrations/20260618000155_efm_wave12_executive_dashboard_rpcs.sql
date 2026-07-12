-- EFM Wave 12 — Executive dashboard RPCs (requires 00154 schema)

-- ---------------------------------------------------------------------------
-- Default executive layout
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_executive_layout(p_org_id UUID)
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

  INSERT INTO executive_dashboard_layouts (organization_id, name, is_default, widgets)
  SELECT
    p_org_id,
    'Default',
    true,
    '[
      {"key": "revenue", "visible": true},
      {"key": "net_profit", "visible": true},
      {"key": "cash", "visible": true},
      {"key": "liquid", "visible": true},
      {"key": "ar", "visible": true},
      {"key": "ap", "visible": true},
      {"key": "tax_payable", "visible": true},
      {"key": "gross_profit", "visible": true}
    ]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM executive_dashboard_layouts
    WHERE organization_id = p_org_id AND is_default
  )
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM executive_dashboard_layouts
    WHERE organization_id = p_org_id AND is_default
    LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_executive_layout(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_executive_dashboard_layout(p_org_id UUID)
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
    SELECT jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'widgets', l.widgets,
      'is_default', l.is_default
    )
    FROM executive_dashboard_layouts l
    WHERE l.organization_id = p_org_id AND l.is_default
    LIMIT 1
  ), jsonb_build_object(
    'name', 'Default',
    'widgets', '[]'::jsonb,
    'is_default', true
  ));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_executive_dashboard_layout(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- KPI targets
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_executive_kpi_target(
  p_org_id UUID,
  p_kpi_key TEXT,
  p_period_from DATE,
  p_period_to DATE,
  p_target_value NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_kpi_key NOT IN ('revenue', 'net_profit', 'cash', 'ar', 'ap', 'liquid', 'tax_payable', 'gross_profit') THEN
    RAISE EXCEPTION 'Invalid KPI key';
  END IF;

  INSERT INTO executive_kpi_targets (
    organization_id, kpi_key, period_from, period_to, target_value, notes, created_by
  ) VALUES (
    p_org_id, p_kpi_key, p_period_from, p_period_to, p_target_value,
    NULLIF(trim(p_notes), ''), auth.uid()
  )
  ON CONFLICT (organization_id, kpi_key, period_from, period_to)
  DO UPDATE SET
    target_value = EXCLUDED.target_value,
    notes = EXCLUDED.notes
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_executive_kpi_target(UUID, TEXT, DATE, DATE, NUMERIC, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_executive_kpi_targets(
  p_org_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'kpi_key', t.kpi_key,
        'period_from', t.period_from,
        'period_to', t.period_to,
        'target_value', t.target_value,
        'notes', t.notes
      ) ORDER BY t.kpi_key
    )
    FROM executive_kpi_targets t
    WHERE t.organization_id = p_org_id
      AND t.period_from <= p_to
      AND t.period_to >= p_from
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_executive_kpi_targets(UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Executive financial dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._executive_prior_period(p_from DATE, p_to DATE)
RETURNS TABLE(prior_from DATE, prior_to DATE)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_days INT := (p_to - p_from) + 1;
BEGIN
  prior_to := p_from - 1;
  prior_from := prior_to - (v_days - 1);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_executive_financial_dashboard(
  p_org_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pnl JSONB;
  v_prior_pnl JSONB;
  v_prior_from DATE;
  v_prior_to DATE;
  v_ar NUMERIC;
  v_ap NUMERIC;
  v_liquid NUMERIC;
  v_tax NUMERIC;
  v_cf JSONB;
  v_targets JSONB;
  v_trends JSONB;
  v_kpis JSONB := '[]'::jsonb;
  v_row JSONB;
  v_target NUMERIC;
  v_val NUMERIC;
  v_prior NUMERIC;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT prior_from, prior_to INTO v_prior_from, v_prior_to
  FROM public._executive_prior_period(p_from, p_to);

  v_pnl := public.profit_and_loss(p_org_id, p_from, p_to, 'gl');
  v_prior_pnl := public.profit_and_loss(p_org_id, v_prior_from, v_prior_to, 'gl');
  v_cf := public.cash_flow(p_org_id, p_from, p_to);

  v_ar := COALESCE((public.accounts_receivable_aging(p_org_id, p_to)->>'total')::NUMERIC, 0);
  v_ap := COALESCE((public.accounts_payable_aging(p_org_id, p_to)->>'total')::NUMERIC, 0);
  v_liquid := COALESCE((public.get_treasury_cash_position(p_org_id, p_to)->>'total_liquid')::NUMERIC, 0);
  v_tax := COALESCE((public.get_vat_liability_report(p_org_id, p_from, p_to)->>'net_payable')::NUMERIC, 0);

  v_targets := public.list_executive_kpi_targets(p_org_id, p_from, p_to);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'month', to_char(m.month_start, 'YYYY-MM'),
      'label', to_char(m.month_start, 'Mon YY'),
      'revenue', COALESCE((public.profit_and_loss(p_org_id, m.month_start, m.month_end, 'gl')->>'revenue')::NUMERIC, 0),
      'net_profit', COALESCE((public.profit_and_loss(p_org_id, m.month_start, m.month_end, 'gl')->>'net_profit')::NUMERIC, 0)
    ) ORDER BY m.month_start
  ), '[]'::jsonb)
  INTO v_trends
  FROM (
    SELECT
      gs::date AS month_start,
      (date_trunc('month', gs) + interval '1 month - 1 day')::date AS month_end
    FROM generate_series(
      date_trunc('month', p_to) - interval '5 months',
      date_trunc('month', p_to),
      interval '1 month'
    ) gs
  ) m;

  FOR v_row IN
    SELECT * FROM jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('key', 'revenue', 'label', 'Revenue', 'value', COALESCE((v_pnl->>'revenue')::NUMERIC, 0), 'prior', COALESCE((v_prior_pnl->>'revenue')::NUMERIC, 0)),
      jsonb_build_object('key', 'gross_profit', 'label', 'Gross profit', 'value', COALESCE((v_pnl->>'gross_profit')::NUMERIC, 0), 'prior', COALESCE((v_prior_pnl->>'gross_profit')::NUMERIC, 0)),
      jsonb_build_object('key', 'net_profit', 'label', 'Net profit', 'value', COALESCE((v_pnl->>'net_profit')::NUMERIC, 0), 'prior', COALESCE((v_prior_pnl->>'net_profit')::NUMERIC, 0)),
      jsonb_build_object('key', 'cash', 'label', 'Closing cash', 'value', COALESCE((v_cf->>'closing_cash')::NUMERIC, 0), 'prior', NULL),
      jsonb_build_object('key', 'liquid', 'label', 'Liquid assets', 'value', v_liquid, 'prior', NULL),
      jsonb_build_object('key', 'ar', 'label', 'Receivables', 'value', v_ar, 'prior', NULL),
      jsonb_build_object('key', 'ap', 'label', 'Payables', 'value', v_ap, 'prior', NULL),
      jsonb_build_object('key', 'tax_payable', 'label', 'Tax net payable', 'value', v_tax, 'prior', NULL)
    ))
  LOOP
    v_val := (v_row->>'value')::NUMERIC;
    v_prior := NULLIF(v_row->>'prior', '')::NUMERIC;
    SELECT (t->>'target_value')::NUMERIC INTO v_target
    FROM jsonb_array_elements(v_targets) t
    WHERE t->>'kpi_key' = v_row->>'key'
    LIMIT 1;

    v_kpis := v_kpis || jsonb_build_array(
      jsonb_build_object(
        'key', v_row->>'key',
        'label', v_row->>'label',
        'value', round(v_val, 2),
        'prior_value', v_prior,
        'variance_pct', CASE
          WHEN v_prior IS NOT NULL AND v_prior <> 0
          THEN round((v_val - v_prior) / abs(v_prior) * 100, 1)
          ELSE NULL
        END,
        'target_value', v_target,
        'target_variance', CASE
          WHEN v_target IS NOT NULL THEN round(v_val - v_target, 2)
          ELSE NULL
        END,
        'drill_key', v_row->>'key'
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'prior_from', v_prior_from,
    'prior_to', v_prior_to,
    'kpis', v_kpis,
    'monthly_trends', v_trends,
    'pnl', v_pnl,
    'cash_flow', v_cf,
    'layout', public.get_executive_dashboard_layout(p_org_id),
    'targets', v_targets
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_executive_financial_dashboard(UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- KPI drill-down
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_executive_kpi_drilldown(
  p_org_id UUID,
  p_kpi_key TEXT,
  p_from DATE,
  p_to DATE,
  p_limit INT DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(LEAST(COALESCE(p_limit, 25), 100), 1);
  v_rows JSONB := '[]'::jsonb;
  v_title TEXT;
  v_financials_tab TEXT;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  CASE p_kpi_key
    WHEN 'revenue' THEN
      v_title := 'Revenue drill-down';
      v_financials_tab := 'pnl';
      SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'amount')::NUMERIC DESC), '[]'::jsonb)
      INTO v_rows
      FROM (
        SELECT jsonb_build_object(
          'type', 'invoice',
          'reference', ci.invoice_no,
          'date', ci.invoice_date,
          'party', COALESCE(c.name, 'Customer'),
          'amount', ci.total,
          'status', ci.status,
          'link', '/invoicing?invoice=' || ci.id::text
        ) AS row_data
        FROM customer_invoices ci
        LEFT JOIN customers c ON c.id = ci.customer_id
        WHERE ci.organization_id = p_org_id
          AND ci.status IN ('posted', 'paid')
          AND ci.invoice_date BETWEEN p_from AND p_to
        ORDER BY ci.total DESC
        LIMIT v_limit
      ) t;

    WHEN 'net_profit', 'gross_profit' THEN
      v_title := 'P&L account drill-down';
      v_financials_tab := 'trial';
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'type', 'account',
          'reference', sub.code,
          'date', p_to,
          'party', sub.name,
          'amount', sub.balance,
          'status', sub.account_type,
          'link', '/financials?tab=ledger'
        ) ORDER BY abs(sub.balance) DESC
      ), '[]'::jsonb)
      INTO v_rows
      FROM (
        SELECT
          a.code,
          a.name,
          a.type AS account_type,
          SUM(
            CASE WHEN a.type = 'income' THEN jel.credit - jel.debit ELSE jel.debit - jel.credit END
          ) AS balance
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        JOIN accounts a ON a.id = jel.account_id
        WHERE jel.organization_id = p_org_id
          AND je.entry_date BETWEEN p_from AND p_to
          AND public._je_is_posted(je.entry_status)
          AND a.type IN ('income', 'expense')
        GROUP BY a.id, a.code, a.name, a.type
        HAVING abs(SUM(
          CASE WHEN a.type = 'income' THEN jel.credit - jel.debit ELSE jel.debit - jel.credit END
        )) > 0
        ORDER BY abs(SUM(
          CASE WHEN a.type = 'income' THEN jel.credit - jel.debit ELSE jel.debit - jel.credit END
        )) DESC
        LIMIT v_limit
      ) sub;

    WHEN 'ar' THEN
      v_title := 'Receivables drill-down';
      v_financials_tab := 'aging';
      SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'amount')::NUMERIC DESC), '[]'::jsonb)
      INTO v_rows
      FROM (
        SELECT jsonb_build_object(
          'type', 'invoice',
          'reference', r->>'reference',
          'date', r->>'due_date',
          'party', r->>'customer_name',
          'amount', (r->>'amount')::NUMERIC,
          'status', r->>'bucket',
          'link', '/receivables'
        ) AS row_data
        FROM jsonb_array_elements(
          COALESCE(public.accounts_receivable_aging(p_org_id, p_to)->'rows', '[]'::jsonb)
        ) r
        LIMIT v_limit
      ) t;

    WHEN 'ap' THEN
      v_title := 'Payables drill-down';
      v_financials_tab := 'aging';
      SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'amount')::NUMERIC DESC), '[]'::jsonb)
      INTO v_rows
      FROM (
        SELECT jsonb_build_object(
          'type', 'bill',
          'reference', r->>'reference',
          'date', r->>'due_date',
          'party', r->>'vendor_name',
          'amount', (r->>'amount')::NUMERIC,
          'status', r->>'bucket',
          'link', '/purchasing'
        ) AS row_data
        FROM jsonb_array_elements(
          COALESCE(public.accounts_payable_aging(p_org_id, p_to)->'rows', '[]'::jsonb)
        ) r
        LIMIT v_limit
      ) t;

    WHEN 'cash', 'liquid' THEN
      v_title := 'Cash & liquid drill-down';
      v_financials_tab := 'treasury';
      v_rows := COALESCE((
        SELECT jsonb_agg(row_data ORDER BY (row_data->>'amount')::NUMERIC DESC)
        FROM (
          SELECT jsonb_build_object(
            'type', 'bank',
            'reference', ba->>'name',
            'date', p_to,
            'party', COALESCE(ba->>'account_type', 'bank'),
            'amount', (ba->>'gl_balance')::NUMERIC,
            'status', 'active',
            'link', '/financials?tab=treasury'
          ) AS row_data
          FROM jsonb_array_elements(
            COALESCE(public.get_treasury_cash_position(p_org_id, p_to)->'bank_accounts', '[]'::jsonb)
          ) ba
          UNION ALL
          SELECT jsonb_build_object(
            'type', 'cash',
            'reference', 'Cash on hand',
            'date', p_to,
            'party', 'GL 1000',
            'amount', (public.get_treasury_cash_position(p_org_id, p_to)->>'cash_on_hand')::NUMERIC,
            'status', 'active',
            'link', '/financials?tab=treasury'
          )
          UNION ALL
          SELECT jsonb_build_object(
            'type', 'mobile',
            'reference', 'Mobile money',
            'date', p_to,
            'party', 'GL 1020',
            'amount', (public.get_treasury_cash_position(p_org_id, p_to)->>'mobile_money')::NUMERIC,
            'status', 'active',
            'link', '/financials?tab=treasury'
          )
        ) combined
      ), '[]'::jsonb);

    WHEN 'tax_payable' THEN
      v_title := 'Tax liability drill-down';
      v_financials_tab := 'tax';
      SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'amount')::NUMERIC DESC), '[]'::jsonb)
      INTO v_rows
      FROM (
        SELECT jsonb_build_object(
          'type', 'tax',
          'reference', l->>'code',
          'date', p_to,
          'party', l->>'name',
          'amount', (l->>'tax_amount')::NUMERIC,
          'status', 'output',
          'link', '/financials?tab=tax'
        ) AS row_data
        FROM jsonb_array_elements(
          COALESCE(public.get_vat_liability_report(p_org_id, p_from, p_to)->'output_lines', '[]'::jsonb)
        ) l
        UNION ALL
        SELECT jsonb_build_object(
          'type', 'tax',
          'reference', l->>'code',
          'date', p_to,
          'party', l->>'name',
          'amount', -(l->>'tax_amount')::NUMERIC,
          'status', 'input',
          'link', '/financials?tab=tax'
        )
        FROM jsonb_array_elements(
          COALESCE(public.get_vat_liability_report(p_org_id, p_from, p_to)->'input_lines', '[]'::jsonb)
        ) l
      ) t;

    ELSE
      RAISE EXCEPTION 'Unknown KPI key: %', p_kpi_key;
  END CASE;

  RETURN jsonb_build_object(
    'kpi_key', p_kpi_key,
    'title', v_title,
    'from', p_from,
    'to', p_to,
    'financials_tab', v_financials_tab,
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_executive_kpi_drilldown(UUID, TEXT, DATE, DATE, INT) TO authenticated;

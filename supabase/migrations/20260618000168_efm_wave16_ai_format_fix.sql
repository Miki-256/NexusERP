-- Fix: PostgreSQL format() does not support printf specifiers (%.1f, %.0f) in AI assistant RPCs

CREATE OR REPLACE FUNCTION public._financial_ai_format_pct(
  p_value NUMERIC,
  p_decimals INT DEFAULT 1
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_decimals, 1) <= 0 THEN to_char(round(COALESCE(p_value, 0), 0), 'FM990')
    WHEN COALESCE(p_decimals, 1) = 1 THEN to_char(round(COALESCE(p_value, 0), 1), 'FM990.0')
    ELSE to_char(round(COALESCE(p_value, 0), p_decimals), 'FM990.999')
  END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_financial_ai_question(
  p_org_id UUID,
  p_question TEXT,
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
  v_ctx JSONB;
  v_q TEXT := lower(trim(COALESCE(p_question, '')));
  v_pnl JSONB;
  v_bs JSONB;
  v_cf JSONB;
  v_ar JSONB;
  v_ap JSONB;
  v_cash JSONB;
  v_currency TEXT;
  v_answer TEXT;
  v_source TEXT := 'internal';
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_ctx := public.build_financial_ai_context(p_org_id, p_from, p_to);
  v_pnl := v_ctx->'pnl';
  v_bs := v_ctx->'balance_sheet';
  v_cf := v_ctx->'cash_flow';
  v_ar := v_ctx->'ar_aging';
  v_ap := v_ctx->'ap_aging';
  v_cash := v_ctx->'treasury';
  v_currency := COALESCE(v_ctx->>'currency', 'ETB');

  IF v_q = '' THEN
    v_answer := 'Ask a question about revenue, profit, cash, receivables, payables, or overall financial health.';
  ELSIF v_q ~ '(revenue|sales|turnover)' THEN
    v_answer := format(
      'Revenue for %s to %s is %s %s. Gross profit is %s %s (%s%% margin). Net profit is %s %s (%s%% margin).',
      p_from, p_to, v_currency,
      to_char(COALESCE((v_pnl->>'revenue')::numeric, 0), 'FM999,999,990.00'),
      v_currency,
      to_char(COALESCE((v_pnl->>'gross_profit')::numeric, 0), 'FM999,999,990.00'),
      public._financial_ai_format_pct(COALESCE((v_pnl->>'gross_margin_pct')::numeric, 0), 1),
      v_currency,
      to_char(COALESCE((v_pnl->>'net_profit')::numeric, 0), 'FM999,999,990.00'),
      public._financial_ai_format_pct(COALESCE((v_pnl->>'net_margin_pct')::numeric, 0), 1)
    );
  ELSIF v_q ~ '(profit|margin|bottom line|net income)' THEN
    v_answer := format(
      'Net profit is %s %s with a %s%% net margin. Operating expenses were %s %s and COGS %s %s.',
      v_currency,
      to_char(COALESCE((v_pnl->>'net_profit')::numeric, 0), 'FM999,999,990.00'),
      public._financial_ai_format_pct(COALESCE((v_pnl->>'net_margin_pct')::numeric, 0), 1),
      v_currency,
      to_char(COALESCE((v_pnl->>'operating_expenses')::numeric, 0), 'FM999,999,990.00'),
      v_currency,
      to_char(COALESCE((v_pnl->>'cogs')::numeric, 0), 'FM999,999,990.00')
    );
  ELSIF v_q ~ '(cash|liquidity|treasury)' THEN
    v_answer := format(
      'Closing cash is %s %s (net change %s %s). Treasury liquid position: %s %s.',
      v_currency,
      to_char(COALESCE((v_cf->>'closing_cash')::numeric, 0), 'FM999,999,990.00'),
      v_currency,
      to_char(COALESCE((v_cf->>'net_change')::numeric, 0), 'FM999,999,990.00'),
      v_currency,
      to_char(COALESCE((v_cash->>'total_liquid')::numeric, (v_cash->>'total_cash')::numeric, 0), 'FM999,999,990.00')
    );
  ELSIF v_q ~ '(receivable|ar|collections|customer.*due)' THEN
    v_answer := format(
      'Total AR is %s %s. Overdue (30+ days): %s %s. Current bucket: %s %s.',
      v_currency,
      to_char(COALESCE((v_ar->>'total')::numeric, 0), 'FM999,999,990.00'),
      v_currency,
      to_char(
        COALESCE((v_ar->'buckets'->>'days_31_60')::numeric, 0) +
        COALESCE((v_ar->'buckets'->>'days_61_90')::numeric, 0) +
        COALESCE((v_ar->'buckets'->>'over_90')::numeric, 0),
        'FM999,999,990.00'
      ),
      v_currency,
      to_char(COALESCE((v_ar->'buckets'->>'current')::numeric, 0), 'FM999,999,990.00')
    );
  ELSIF v_q ~ '(payable|ap|vendor|supplier)' THEN
    v_answer := format(
      'Total AP is %s %s. Overdue (30+ days): %s %s.',
      v_currency,
      to_char(COALESCE((v_ap->>'total')::numeric, 0), 'FM999,999,990.00'),
      v_currency,
      to_char(
        COALESCE((v_ap->'buckets'->>'days_31_60')::numeric, 0) +
        COALESCE((v_ap->'buckets'->>'days_61_90')::numeric, 0) +
        COALESCE((v_ap->'buckets'->>'over_90')::numeric, 0),
        'FM999,999,990.00'
      )
    );
  ELSIF v_q ~ '(balance sheet|assets|liabilit|equity)' THEN
    v_answer := format(
      'As of %s: total assets %s %s, liabilities %s %s, equity %s %s. Balance sheet is %s.',
      p_to,
      v_currency,
      to_char(COALESCE((v_bs->>'total_assets')::numeric, 0), 'FM999,999,990.00'),
      v_currency,
      to_char(COALESCE((v_bs->>'total_liabilities')::numeric, 0), 'FM999,999,990.00'),
      v_currency,
      to_char(COALESCE((v_bs->>'total_equity')::numeric, 0), 'FM999,999,990.00'),
      CASE WHEN COALESCE((v_bs->>'balanced')::boolean, false) THEN 'balanced' ELSE 'out of balance — review' END
    );
  ELSIF v_q ~ '(health|summary|overview|how are we)' THEN
    v_answer := format(
      'Period %s–%s: revenue %s %s, net profit %s %s (%s%%), cash %s %s, AR %s %s, AP %s %s.',
      p_from, p_to,
      v_currency, to_char(COALESCE((v_pnl->>'revenue')::numeric, 0), 'FM999,999,990.00'),
      v_currency, to_char(COALESCE((v_pnl->>'net_profit')::numeric, 0), 'FM999,999,990.00'),
      public._financial_ai_format_pct(COALESCE((v_pnl->>'net_margin_pct')::numeric, 0), 1),
      v_currency, to_char(COALESCE((v_cf->>'closing_cash')::numeric, 0), 'FM999,999,990.00'),
      v_currency, to_char(COALESCE((v_ar->>'total')::numeric, 0), 'FM999,999,990.00'),
      v_currency, to_char(COALESCE((v_ap->>'total')::numeric, 0), 'FM999,999,990.00')
    );
  ELSE
    v_answer := format(
      'I can answer questions about revenue, profit, cash, receivables, payables, and balance sheet for %s–%s. Try one of the suggested prompts, or configure an LLM API key for broader analysis.',
      p_from, p_to
    );
  END IF;

  RETURN jsonb_build_object(
    'answer', v_answer,
    'source', v_source,
    'context', v_ctx
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_financial_ai_insights(
  p_org_id UUID,
  p_from DATE,
  p_to DATE,
  p_replace_existing BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx JSONB;
  v_pnl JSONB;
  v_ar JSONB;
  v_ap JSONB;
  v_cf JSONB;
  v_insights JSONB := '[]'::jsonb;
  v_net_margin NUMERIC;
  v_ar_total NUMERIC;
  v_ar_overdue NUMERIC;
  v_closing_cash NUMERIC;
  v_revenue NUMERIC;
  v_opex NUMERIC;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF COALESCE(p_replace_existing, true) THEN
    DELETE FROM financial_ai_insights
    WHERE organization_id = p_org_id
      AND period_from = p_from
      AND period_to = p_to;
  END IF;

  v_ctx := public.build_financial_ai_context(p_org_id, p_from, p_to);
  v_pnl := v_ctx->'pnl';
  v_ar := v_ctx->'ar_aging';
  v_ap := v_ctx->'ap_aging';
  v_cf := v_ctx->'cash_flow';

  v_net_margin := COALESCE((v_pnl->>'net_margin_pct')::numeric, 0);
  v_revenue := COALESCE((v_pnl->>'revenue')::numeric, 0);
  v_opex := COALESCE((v_pnl->>'operating_expenses')::numeric, 0);
  v_ar_total := COALESCE((v_ar->>'total')::numeric, 0);
  v_ar_overdue :=
    COALESCE((v_ar->'buckets'->>'days_31_60')::numeric, 0) +
    COALESCE((v_ar->'buckets'->>'days_61_90')::numeric, 0) +
    COALESCE((v_ar->'buckets'->>'over_90')::numeric, 0);
  v_closing_cash := COALESCE((v_cf->>'closing_cash')::numeric, 0);

  IF v_net_margin < 5 AND v_revenue > 0 THEN
    INSERT INTO financial_ai_insights (organization_id, insight_type, severity, title, summary, data, period_from, period_to)
    VALUES (
      p_org_id, 'low_margin', 'warning',
      'Low net margin',
      format(
        'Net margin is %s%% — review pricing, COGS, and operating expenses.',
        public._financial_ai_format_pct(v_net_margin, 1)
      ),
      jsonb_build_object('net_margin_pct', v_net_margin),
      p_from, p_to
    );
    v_insights := v_insights || jsonb_build_array('low_margin');
  END IF;

  IF v_ar_total > 0 AND v_ar_overdue / NULLIF(v_ar_total, 0) > 0.3 THEN
    INSERT INTO financial_ai_insights (organization_id, insight_type, severity, title, summary, data, period_from, period_to)
    VALUES (
      p_org_id, 'ar_overdue', 'warning',
      'High overdue receivables',
      format(
        '%s%% of AR is 30+ days overdue — prioritize collections.',
        public._financial_ai_format_pct((v_ar_overdue / v_ar_total) * 100, 0)
      ),
      jsonb_build_object('ar_total', v_ar_total, 'ar_overdue', v_ar_overdue),
      p_from, p_to
    );
    v_insights := v_insights || jsonb_build_array('ar_overdue');
  END IF;

  IF v_closing_cash < 0 THEN
    INSERT INTO financial_ai_insights (organization_id, insight_type, severity, title, summary, data, period_from, period_to)
    VALUES (
      p_org_id, 'negative_cash', 'critical',
      'Negative cash balance',
      'Closing cash is negative — review treasury and short-term obligations.',
      jsonb_build_object('closing_cash', v_closing_cash),
      p_from, p_to
    );
    v_insights := v_insights || jsonb_build_array('negative_cash');
  END IF;

  IF v_revenue > 0 AND v_opex / v_revenue > 0.5 THEN
    INSERT INTO financial_ai_insights (organization_id, insight_type, severity, title, summary, data, period_from, period_to)
    VALUES (
      p_org_id, 'high_opex_ratio', 'info',
      'Operating expenses above 50% of revenue',
      'Operating expense ratio is elevated — consider cost review.',
      jsonb_build_object('opex_ratio_pct', (v_opex / v_revenue) * 100),
      p_from, p_to
    );
    v_insights := v_insights || jsonb_build_array('high_opex_ratio');
  END IF;

  RETURN jsonb_build_object(
    'generated', jsonb_array_length(v_insights),
    'types', v_insights,
    'period_from', p_from,
    'period_to', p_to
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_financial_ai_insights(
  p_org_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY row_data->>'created_at' DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', i.id,
          'insight_type', i.insight_type,
          'severity', i.severity,
          'title', i.title,
          'summary', i.summary,
          'data', i.data,
          'period_from', i.period_from,
          'period_to', i.period_to,
          'created_at', i.created_at
        ) AS row_data
        FROM financial_ai_insights i
        WHERE i.organization_id = p_org_id
          AND (p_from IS NULL OR i.period_from = p_from)
          AND (p_to IS NULL OR i.period_to = p_to)
        ORDER BY i.created_at DESC
        LIMIT v_limit
      ) rows
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_financial_ai_conversations(
  p_org_id UUID,
  p_limit INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY row_data->>'updated_at' DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', c.id,
          'title', c.title,
          'period_from', c.period_from,
          'period_to', c.period_to,
          'updated_at', c.updated_at,
          'message_count', (
            SELECT COUNT(*) FROM financial_ai_messages m WHERE m.conversation_id = c.id
          )
        ) AS row_data
        FROM financial_ai_conversations c
        WHERE c.organization_id = p_org_id
          AND c.user_id = auth.uid()
        ORDER BY c.updated_at DESC
        LIMIT v_limit
      ) rows
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._financial_ai_format_pct(NUMERIC, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_financial_ai_question(UUID, TEXT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_financial_ai_insights(UUID, DATE, DATE, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_financial_ai_insights(UUID, DATE, DATE, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_financial_ai_conversations(UUID, INT) TO authenticated;

-- Fix: build_financial_ai_context referenced non-existent organizations.default_currency

CREATE OR REPLACE FUNCTION public.build_financial_ai_context(
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
  v_bs JSONB;
  v_cf JSONB;
  v_exec JSONB;
  v_ar JSONB;
  v_ap JSONB;
  v_cash JSONB;
  v_currency TEXT;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_currency := public._org_functional_currency(p_org_id);

  v_pnl := public.profit_and_loss(p_org_id, p_from, p_to, 'gl');
  v_bs := public.balance_sheet(p_org_id, p_to);
  v_cf := public.cash_flow(p_org_id, p_from, p_to);
  v_exec := public.get_executive_financial_dashboard(p_org_id, p_from, p_to);
  v_ar := public.accounts_receivable_aging(p_org_id, p_to);
  v_ap := public.accounts_payable_aging(p_org_id, p_to);
  v_cash := public.get_treasury_cash_position(p_org_id, p_to);

  RETURN jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'currency', COALESCE(v_currency, 'ETB'),
    'pnl', v_pnl,
    'balance_sheet', v_bs,
    'cash_flow', v_cf,
    'executive', v_exec,
    'ar_aging', v_ar,
    'ap_aging', v_ap,
    'treasury', v_cash,
    'generated_at', now()
  );
END;
$$;

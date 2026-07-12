-- EFM Wave 17 — Fiori-grade financial shell RPCs (requires 00164 schema)

CREATE OR REPLACE FUNCTION public.get_financial_shell_preferences(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row user_financial_shell_preferences%ROWTYPE;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_row
  FROM user_financial_shell_preferences
  WHERE organization_id = p_org_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'default_area', 'home',
      'density', 'cozy',
      'pinned_tabs', '[]'::jsonb,
      'show_launchpad', true
    );
  END IF;

  RETURN jsonb_build_object(
    'default_area', v_row.default_area,
    'density', v_row.density,
    'pinned_tabs', v_row.pinned_tabs,
    'show_launchpad', v_row.show_launchpad,
    'updated_at', v_row.updated_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_financial_shell_preferences(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_financial_shell_preferences(
  p_org_id UUID,
  p_default_area TEXT DEFAULT NULL,
  p_density TEXT DEFAULT NULL,
  p_pinned_tabs JSONB DEFAULT NULL,
  p_show_launchpad BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO user_financial_shell_preferences (
    organization_id, user_id, default_area, density, pinned_tabs, show_launchpad, updated_at
  )
  VALUES (
    p_org_id,
    auth.uid(),
    COALESCE(NULLIF(trim(p_default_area), ''), 'home'),
    COALESCE(NULLIF(trim(p_density), ''), 'cozy'),
    COALESCE(p_pinned_tabs, '[]'::jsonb),
    COALESCE(p_show_launchpad, true),
    now()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    default_area = COALESCE(NULLIF(trim(p_default_area), ''), user_financial_shell_preferences.default_area),
    density = COALESCE(NULLIF(trim(p_density), ''), user_financial_shell_preferences.density),
    pinned_tabs = COALESCE(p_pinned_tabs, user_financial_shell_preferences.pinned_tabs),
    show_launchpad = COALESCE(p_show_launchpad, user_financial_shell_preferences.show_launchpad),
    updated_at = now();

  RETURN public.get_financial_shell_preferences(p_org_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_financial_shell_preferences(UUID, TEXT, TEXT, JSONB, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_financial_launchpad_tiles(p_org_id UUID)
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

  RETURN jsonb_build_object(
    'areas', jsonb_build_array(
      jsonb_build_object(
        'id', 'reporting',
        'label', 'Reporting & Analytics',
        'description', 'Statements, executive KPIs, and report library',
        'tiles', jsonb_build_array(
          jsonb_build_object('tab', 'overview', 'label', 'Overview', 'description', 'Period dashboard and charts', 'icon', 'layout-dashboard', 'accent', 'blue'),
          jsonb_build_object('tab', 'executive', 'label', 'Executive', 'description', 'KPI scorecard and drill-down', 'icon', 'gauge', 'accent', 'indigo'),
          jsonb_build_object('tab', 'pnl', 'label', 'Profit & Loss', 'description', 'Income statement', 'icon', 'trending-up', 'accent', 'green'),
          jsonb_build_object('tab', 'balance', 'label', 'Balance Sheet', 'description', 'Assets, liabilities, equity', 'icon', 'scale', 'accent', 'slate'),
          jsonb_build_object('tab', 'cashflow', 'label', 'Cash Flow', 'description', 'Operating cash movements', 'icon', 'wallet', 'accent', 'teal'),
          jsonb_build_object('tab', 'trial', 'label', 'Trial Balance', 'description', 'Account balances as of date', 'icon', 'book-open', 'accent', 'gray'),
          jsonb_build_object('tab', 'reports', 'label', 'Reports', 'description', 'Saved snapshots and exports', 'icon', 'file-text', 'accent', 'blue'),
          jsonb_build_object('tab', 'analytics', 'label', 'Analytics', 'description', 'Dimensional ledger summaries', 'icon', 'bar-chart-3', 'accent', 'purple')
        )
      ),
      jsonb_build_object(
        'id', 'ledger',
        'label', 'General Ledger',
        'description', 'Chart of accounts, journals, and periods',
        'tiles', jsonb_build_array(
          jsonb_build_object('tab', 'ledger', 'label', 'Ledger Entries', 'description', 'Posted journal lines', 'icon', 'list', 'accent', 'slate'),
          jsonb_build_object('tab', 'coa', 'label', 'Chart of Accounts', 'description', 'Account hierarchy', 'icon', 'git-branch', 'accent', 'gray'),
          jsonb_build_object('tab', 'journal', 'label', 'Manual JE', 'description', 'Draft and post journals', 'icon', 'pen-line', 'accent', 'amber'),
          jsonb_build_object('tab', 'periods', 'label', 'Fiscal Periods', 'description', 'Open, close, and lock periods', 'icon', 'calendar', 'accent', 'orange')
        )
      ),
      jsonb_build_object(
        'id', 'working_capital',
        'label', 'Working Capital',
        'description', 'Cash, banking, FX, and aging',
        'tiles', jsonb_build_array(
          jsonb_build_object('tab', 'aging', 'label', 'AR / AP Aging', 'description', 'Receivables and payables buckets', 'icon', 'clock', 'accent', 'rose'),
          jsonb_build_object('tab', 'banking', 'label', 'Banking', 'description', 'Bank accounts and reconciliation', 'icon', 'landmark', 'accent', 'blue'),
          jsonb_build_object('tab', 'treasury', 'label', 'Treasury', 'description', 'Cash position and liquidity', 'icon', 'banknote', 'accent', 'green'),
          jsonb_build_object('tab', 'fx', 'label', 'FX & Currencies', 'description', 'Rates and revaluation', 'icon', 'coins', 'accent', 'yellow')
        )
      ),
      jsonb_build_object(
        'id', 'compliance',
        'label', 'Compliance & Controls',
        'description', 'Tax and financial security',
        'tiles', jsonb_build_array(
          jsonb_build_object('tab', 'tax', 'label', 'Tax', 'description', 'VAT, returns, e-invoicing', 'icon', 'receipt', 'accent', 'red'),
          jsonb_build_object('tab', 'security', 'label', 'Security', 'description', 'SoD, dual approval, queue', 'icon', 'shield', 'accent', 'rose')
        )
      ),
      jsonb_build_object(
        'id', 'planning',
        'label', 'Planning & Assets',
        'description', 'Budgets, FP&A, job cost, FA, consolidation',
        'tiles', jsonb_build_array(
          jsonb_build_object('tab', 'budget', 'label', 'Budget', 'description', 'Budget vs actual', 'icon', 'target', 'accent', 'green'),
          jsonb_build_object('tab', 'fpa', 'label', 'FP&A', 'description', 'Scenarios and forecasts', 'icon', 'line-chart', 'accent', 'indigo'),
          jsonb_build_object('tab', 'jobcost', 'label', 'Job Cost', 'description', 'Projects and cost centers', 'icon', 'hard-hat', 'accent', 'orange'),
          jsonb_build_object('tab', 'assets', 'label', 'Fixed Assets', 'description', 'Multi-book depreciation', 'icon', 'building-2', 'accent', 'slate'),
          jsonb_build_object('tab', 'consolidation', 'label', 'Consolidation', 'description', 'Group reporting and IC', 'icon', 'network', 'accent', 'purple')
        )
      ),
      jsonb_build_object(
        'id', 'platform',
        'label', 'Platform',
        'description', 'Automation, performance, and AI assistant',
        'tiles', jsonb_build_array(
          jsonb_build_object('tab', 'automation', 'label', 'Automation', 'description', 'Rules and scheduled reports', 'icon', 'zap', 'accent', 'amber'),
          jsonb_build_object('tab', 'performance', 'label', 'Performance', 'description', 'Cache and partition ops', 'icon', 'gauge', 'accent', 'teal'),
          jsonb_build_object('tab', 'assistant', 'label', 'Assistant', 'description', 'AI financial Q&A', 'icon', 'bot', 'accent', 'violet')
        )
      )
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_financial_launchpad_tiles(UUID) TO authenticated;

-- Bust stale Balance Sheet / Cash Flow cache entries for all orgs.
-- Hub previously force-refreshed only P&L; BS/CF could serve 60m zero payloads
-- after late JE posts (esp. when pos_auto_post_sales is off).

DELETE FROM public.financial_report_cache
WHERE report_type IN ('balance_sheet', 'cash_flow', 'trial_balance', 'executive_dashboard');

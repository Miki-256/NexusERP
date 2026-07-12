import type { SupabaseClient } from "@supabase/supabase-js";
import { priorPeriod, priorBalanceSheetDate } from "@/lib/finance-dates";
import {
  getFinancialsFetchScope,
  resolveFinancialsLoadArea,
  shouldRunFinancialAiInsights,
  type FinancialsFetchScope,
  type FinancialsLoadArea,
} from "@/lib/finance/financials-area-scope";
import { skipScopedFetch } from "@/lib/finance/financials-skip-fetch";

export type FinancialsPageFetchParams = {
  orgId: string;
  from: string;
  to: string;
  pnlMode: "operational" | "gl";
  canPostLedger: boolean;
  initialTab?: string;
  initialArea?: string;
};

export type FinancialsPageRawData = {
  loadArea: FinancialsLoadArea;
  scope: FinancialsFetchScope;
  pnlData: unknown;
  trialData: unknown;
  bsData: unknown;
  cfData: unknown;
  chartData: unknown;
  accountsData: unknown;
  arAgingData: unknown;
  apAgingData: unknown;
  journalsData: unknown;
  fiscalData: unknown;
  draftsData: unknown;
  orgData: unknown;
  bankData: unknown;
  taxCodesData: unknown;
  taxSummaryData: unknown;
  pnlComparativeData: unknown;
  bsComparativeData: unknown;
  budgetsData: unknown;
  departmentsData: unknown;
  storeAnalyticData: unknown;
  projectAnalyticData: unknown;
  deptAnalyticData: unknown;
  storesData: unknown;
  projectsData: unknown;
  fixedAssetsData: unknown;
  consolidationGroupsData: unknown;
  myOrgsData: unknown;
  recurringTemplatesData: unknown;
  invoiceRemindersData: unknown;
  reportSnapshotsData: unknown;
  exchangeRatesData: unknown;
  fxRunsData: unknown;
  icRelationshipsData: unknown;
  icTransactionsData: unknown;
  treasuryPositionData: unknown;
  treasuryForecastData: unknown;
  treasuryTransfersData: unknown;
  taxComplianceData: unknown;
  vatLiabilityData: unknown;
  taxReturnsData: unknown;
  einvoiceDocsData: unknown;
  pendingEinvoiceData: unknown;
  withholdingRulesData: unknown;
  fpaScenariosData: unknown;
  fpaForecastsData: unknown;
  fpaDashboardData: unknown;
  fpaComparisonData: unknown;
  costCentersData: unknown;
  projectsJobCostData: unknown;
  costCenterSummaryData: unknown;
  faBooksData: unknown;
  faBookComparisonData: unknown;
  executiveDashboardData: unknown;
  financialRulesData: unknown;
  financialSchedulesData: unknown;
  financialSecurityData: unknown;
  sodRulesData: unknown;
  pendingApprovalsData: unknown;
  performanceDashboardData: unknown;
  financialAiSettingsData: unknown;
  financialAiPromptsData: unknown;
  financialAiInsightsData: unknown;
  shellPreferencesData: unknown;
  launchpadTilesData: unknown;
};

export async function runFinancialsEnsureRpcs(
  supabase: SupabaseClient,
  params: FinancialsPageFetchParams,
  loadArea: FinancialsLoadArea,
  scope: FinancialsFetchScope
): Promise<void> {
  if (!params.canPostLedger) return;

  const { orgId, from, to } = params;
  await supabase.rpc("ensure_fiscal_year", { p_org_id: orgId });
  await supabase.rpc("ensure_default_tax_codes", { p_org_id: orgId });

  if (scope.planning) {
    await supabase.rpc("ensure_default_fpa_scenarios", { p_org_id: orgId });
    await supabase.rpc("ensure_default_fa_books", { p_org_id: orgId });
  }
  if (scope.reporting) {
    await supabase.rpc("ensure_default_executive_layout", { p_org_id: orgId });
  }
  if (scope.platform) {
    await supabase.rpc("ensure_default_financial_automation_rules", { p_org_id: orgId });
    await supabase.rpc("ensure_default_financial_scheduled_reports", { p_org_id: orgId });
    await supabase.rpc("ensure_default_financial_partition_policies", { p_org_id: orgId });
  }
  if (scope.compliance) {
    await supabase.rpc("ensure_default_sod_rules", { p_org_id: orgId });
  }
  if (shouldRunFinancialAiInsights(loadArea, params.canPostLedger)) {
    await supabase.rpc("generate_financial_ai_insights", { p_org_id: orgId, p_from: from, p_to: to });
  }
}

export async function fetchFinancialsPageRawData(
  supabase: SupabaseClient,
  params: FinancialsPageFetchParams
): Promise<FinancialsPageRawData> {
  const { orgId, from, to, pnlMode, canPostLedger } = params;
  const loadArea = resolveFinancialsLoadArea(params.initialTab, params.initialArea);
  const scope = getFinancialsFetchScope(loadArea);
  const skip = skipScopedFetch;
  const prior = priorPeriod(from, to);
  const priorBsDate = priorBalanceSheetDate(to, from);

  await runFinancialsEnsureRpcs(supabase, params, loadArea, scope);

  const [
    { data: pnlData },
    { data: trialData },
    { data: bsData },
    { data: cfData },
    { data: chartData },
    { data: accountsData },
    { data: arAgingData },
    { data: apAgingData },
    { data: journalsData },
    { data: fiscalData },
    { data: draftsData },
    { data: orgData },
    { data: bankData },
    { data: taxCodesData },
    { data: taxSummaryData },
    { data: pnlComparativeData },
    { data: bsComparativeData },
    { data: budgetsData },
    { data: departmentsData },
    { data: storeAnalyticData },
    { data: projectAnalyticData },
    { data: deptAnalyticData },
    { data: storesData },
    { data: projectsData },
    { data: fixedAssetsData },
    { data: consolidationGroupsData },
    { data: myOrgsData },
    { data: recurringTemplatesData },
    { data: invoiceRemindersData },
    { data: reportSnapshotsData },
    { data: exchangeRatesData },
    { data: fxRunsData },
    { data: icRelationshipsData },
    { data: icTransactionsData },
    { data: treasuryPositionData },
    { data: treasuryForecastData },
    { data: treasuryTransfersData },
    { data: taxComplianceData },
    { data: vatLiabilityData },
    { data: taxReturnsData },
    { data: einvoiceDocsData },
    { data: pendingEinvoiceData },
    { data: withholdingRulesData },
    { data: fpaScenariosData },
    { data: fpaForecastsData },
    { data: fpaDashboardData },
    { data: fpaComparisonData },
    { data: costCentersData },
    { data: projectsJobCostData },
    { data: costCenterSummaryData },
    { data: faBooksData },
    { data: faBookComparisonData },
    { data: executiveDashboardData },
    { data: financialRulesData },
    { data: financialSchedulesData },
    { data: financialSecurityData },
    { data: sodRulesData },
    { data: pendingApprovalsData },
    { data: performanceDashboardData },
    { data: financialAiSettingsData },
    { data: financialAiPromptsData },
    { data: financialAiInsightsData },
    { data: shellPreferencesData },
    { data: launchpadTilesData },
  ] = await Promise.all([
    supabase.rpc("fetch_financial_report", {
      p_org_id: orgId,
      p_report_type: "profit_and_loss",
      p_from: from,
      p_to: to,
      p_mode: pnlMode,
    }),
    skip(
      scope.reporting,
      supabase.rpc("fetch_financial_report", {
        p_org_id: orgId,
        p_report_type: "trial_balance",
        p_to: to,
        p_as_of: to,
      })
    ),
    skip(
      scope.reporting,
      supabase.rpc("fetch_financial_report", {
        p_org_id: orgId,
        p_report_type: "balance_sheet",
        p_to: to,
        p_as_of: to,
      })
    ),
    skip(
      scope.reporting,
      supabase.rpc("fetch_financial_report", {
        p_org_id: orgId,
        p_report_type: "cash_flow",
        p_from: from,
        p_to: to,
      })
    ),
    skip(scope.reporting, supabase.rpc("financials_chart_data", { p_org_id: orgId, p_from: from, p_to: to })),
    skip(scope.ledger, supabase.rpc("list_accounts", { p_org_id: orgId })),
    skip(scope.workingCapital, supabase.rpc("accounts_receivable_aging", { p_org_id: orgId, p_as_of: to })),
    skip(scope.workingCapital, supabase.rpc("accounts_payable_aging", { p_org_id: orgId, p_as_of: to })),
    skip(scope.ledger, supabase.from("journals").select("id, code, name").eq("organization_id", orgId).order("code")),
    skip(scope.ledger, supabase.rpc("list_fiscal_periods", { p_org_id: orgId })),
    canPostLedger && scope.ledger
      ? supabase.rpc("list_journal_entry_drafts", { p_org_id: orgId })
      : Promise.resolve({ data: [] }),
    supabase.from("organizations").select("je_requires_approval").eq("id", orgId).single(),
    skip(scope.workingCapital, supabase.rpc("list_bank_accounts", { p_org_id: orgId })),
    skip(scope.compliance, supabase.rpc("list_tax_codes", { p_org_id: orgId })),
    skip(scope.compliance, supabase.rpc("tax_summary_report", { p_org_id: orgId, p_from: from, p_to: to })),
    skip(
      scope.reporting,
      supabase.rpc("comparative_profit_and_loss", {
        p_org_id: orgId,
        p_from: from,
        p_to: to,
        p_prior_from: prior.from,
        p_prior_to: prior.to,
        p_mode: pnlMode,
      })
    ),
    skip(
      scope.reporting,
      supabase.rpc("comparative_balance_sheet", {
        p_org_id: orgId,
        p_as_of: to,
        p_prior_as_of: priorBsDate,
      })
    ),
    skip(scope.planning, supabase.rpc("list_budgets", { p_org_id: orgId })),
    skip(scope.planning, supabase.rpc("list_departments", { p_org_id: orgId })),
    skip(
      scope.reporting,
      supabase.rpc("analytic_ledger_summary", { p_org_id: orgId, p_from: from, p_to: to, p_dimension: "store" })
    ),
    skip(
      scope.reporting,
      supabase.rpc("analytic_ledger_summary", { p_org_id: orgId, p_from: from, p_to: to, p_dimension: "project" })
    ),
    skip(
      scope.reporting,
      supabase.rpc("analytic_ledger_summary", { p_org_id: orgId, p_from: from, p_to: to, p_dimension: "department" })
    ),
    skip(scope.planning, supabase.from("stores").select("id, name").eq("organization_id", orgId).order("name")),
    skip(
      scope.planning,
      supabase.from("projects").select("id, name").eq("organization_id", orgId).order("name").limit(100)
    ),
    skip(scope.planning, supabase.rpc("list_fixed_assets", { p_org_id: orgId })),
    skip(scope.planning, supabase.rpc("list_consolidation_groups", { p_org_id: orgId })),
    skip(scope.planning, supabase.rpc("list_my_organizations")),
    skip(scope.platform, supabase.rpc("list_recurring_journal_templates", { p_org_id: orgId })),
    skip(scope.workingCapital, supabase.rpc("list_invoices_needing_reminder", { p_org_id: orgId })),
    skip(scope.reporting, supabase.rpc("list_financial_report_snapshots", { p_org_id: orgId })),
    skip(scope.workingCapital, supabase.rpc("list_exchange_rates", { p_org_id: orgId })),
    skip(scope.workingCapital, supabase.rpc("list_fx_revaluation_runs", { p_org_id: orgId, p_limit: 20 })),
    skip(scope.planning, supabase.rpc("list_intercompany_relationships", { p_org_id: orgId })),
    skip(scope.planning, supabase.rpc("list_intercompany_transactions", { p_org_id: orgId, p_limit: 20 })),
    skip(scope.workingCapital, supabase.rpc("get_treasury_cash_position", { p_org_id: orgId, p_as_of: to })),
    skip(
      scope.workingCapital,
      supabase.rpc("get_treasury_liquidity_forecast", { p_org_id: orgId, p_days: 30, p_as_of: to })
    ),
    skip(scope.workingCapital, supabase.rpc("list_treasury_transfers", { p_org_id: orgId, p_limit: 20 })),
    skip(scope.compliance, supabase.rpc("get_tax_compliance_settings", { p_org_id: orgId })),
    skip(scope.compliance, supabase.rpc("get_vat_liability_report", { p_org_id: orgId, p_from: from, p_to: to })),
    skip(scope.compliance, supabase.rpc("list_tax_return_periods", { p_org_id: orgId, p_limit: 24 })),
    skip(scope.compliance, supabase.rpc("list_einvoice_documents", { p_org_id: orgId, p_limit: 50 })),
    skip(scope.compliance, supabase.rpc("list_invoices_pending_einvoice", { p_org_id: orgId, p_limit: 50 })),
    skip(scope.compliance, supabase.rpc("list_withholding_tax_rules", { p_org_id: orgId })),
    skip(scope.planning, supabase.rpc("list_fpa_scenarios", { p_org_id: orgId })),
    skip(scope.planning, supabase.rpc("list_rolling_forecasts", { p_org_id: orgId, p_limit: 20 })),
    skip(scope.planning, supabase.rpc("get_fpa_dashboard", { p_org_id: orgId, p_as_of: to })),
    skip(scope.planning, supabase.rpc("compare_fpa_scenarios", { p_org_id: orgId, p_as_of: to })),
    skip(scope.planning, supabase.rpc("list_cost_centers", { p_org_id: orgId })),
    skip(scope.planning, supabase.rpc("list_projects_job_cost", { p_org_id: orgId, p_from: from, p_to: to })),
    skip(scope.planning, supabase.rpc("get_cost_center_summary", { p_org_id: orgId, p_from: from, p_to: to })),
    skip(scope.planning, supabase.rpc("list_fa_books", { p_org_id: orgId })),
    skip(scope.planning, supabase.rpc("get_fa_book_comparison", { p_org_id: orgId })),
    skip(
      scope.reporting,
      supabase.rpc("fetch_financial_report", {
        p_org_id: orgId,
        p_report_type: "executive_dashboard",
        p_from: from,
        p_to: to,
      })
    ),
    skip(scope.platform, supabase.rpc("list_financial_automation_rules", { p_org_id: orgId })),
    skip(scope.platform, supabase.rpc("list_financial_scheduled_reports", { p_org_id: orgId })),
    skip(scope.compliance, supabase.rpc("get_financial_security_settings", { p_org_id: orgId })),
    skip(scope.compliance, supabase.rpc("list_sod_conflict_rules", { p_org_id: orgId })),
    skip(scope.compliance, supabase.rpc("list_pending_financial_approvals", { p_org_id: orgId })),
    skip(scope.platform, supabase.rpc("get_financial_performance_dashboard", { p_org_id: orgId })),
    skip(scope.platform, supabase.rpc("get_financial_ai_settings", { p_org_id: orgId })),
    skip(scope.platform, supabase.rpc("list_financial_ai_suggested_prompts", { p_org_id: orgId })),
    skip(
      scope.platform,
      supabase.rpc("list_financial_ai_insights", { p_org_id: orgId, p_from: from, p_to: to })
    ),
    supabase.rpc("get_financial_shell_preferences", { p_org_id: orgId }),
    supabase.rpc("list_financial_launchpad_tiles", { p_org_id: orgId }),
  ]);

  return {
    loadArea,
    scope,
    pnlData,
    trialData,
    bsData,
    cfData,
    chartData,
    accountsData,
    arAgingData,
    apAgingData,
    journalsData,
    fiscalData,
    draftsData,
    orgData,
    bankData,
    taxCodesData,
    taxSummaryData,
    pnlComparativeData,
    bsComparativeData,
    budgetsData,
    departmentsData,
    storeAnalyticData,
    projectAnalyticData,
    deptAnalyticData,
    storesData,
    projectsData,
    fixedAssetsData,
    consolidationGroupsData,
    myOrgsData,
    recurringTemplatesData,
    invoiceRemindersData,
    reportSnapshotsData,
    exchangeRatesData,
    fxRunsData,
    icRelationshipsData,
    icTransactionsData,
    treasuryPositionData,
    treasuryForecastData,
    treasuryTransfersData,
    taxComplianceData,
    vatLiabilityData,
    taxReturnsData,
    einvoiceDocsData,
    pendingEinvoiceData,
    withholdingRulesData,
    fpaScenariosData,
    fpaForecastsData,
    fpaDashboardData,
    fpaComparisonData,
    costCentersData,
    projectsJobCostData,
    costCenterSummaryData,
    faBooksData,
    faBookComparisonData,
    executiveDashboardData,
    financialRulesData,
    financialSchedulesData,
    financialSecurityData,
    sodRulesData,
    pendingApprovalsData,
    performanceDashboardData,
    financialAiSettingsData,
    financialAiPromptsData,
    financialAiInsightsData,
    shellPreferencesData,
    launchpadTilesData,
  };
}

export async function fetchConsolidatedFinancialReports(
  supabase: SupabaseClient,
  params: {
    groupId: string;
    from: string;
    to: string;
    pnlMode: "operational" | "gl";
    asOf: string;
  }
): Promise<{ consolidatedPnl: Record<string, unknown> | null; consolidatedBs: Record<string, unknown> | null }> {
  const [{ data: cPnl }, { data: cBs }] = await Promise.all([
    supabase.rpc("consolidated_profit_and_loss", {
      p_group_id: params.groupId,
      p_from: params.from,
      p_to: params.to,
      p_mode: params.pnlMode,
    }),
    supabase.rpc("consolidated_balance_sheet", {
      p_group_id: params.groupId,
      p_as_of: params.asOf,
    }),
  ]);

  return {
    consolidatedPnl: (cPnl as Record<string, unknown>) ?? null,
    consolidatedBs: (cBs as Record<string, unknown>) ?? null,
  };
}

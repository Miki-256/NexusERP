import { requireAppAccess } from "@/lib/require-app-access";
import { createReportingClient } from "@/lib/supabase/server";
import { FinancialsClient } from "@/components/finance/financials-client";
import type { AccountRow } from "@/components/finance/chart-of-accounts-tab";
import type { JournalDraft } from "@/components/finance/manual-journal-tab";
import type { FiscalPeriodRow } from "@/components/finance/fiscal-periods-tab";
import {
  TreasuryTab,
  type TreasuryCashPosition,
  type TreasuryForecast,
  type TreasuryTransferRow,
} from "@/components/finance/treasury-tab";
import type { BankAccountRow } from "@/components/finance/banking-tab";
import type {
  TaxCodeRow,
  TaxSummaryLine,
  TaxComplianceSettings,
  VatLiabilityReport,
  TaxReturnPeriod,
  EinvoiceDocument,
  PendingEinvoiceInvoice,
  WithholdingRule,
} from "@/components/finance/tax-tab";
import type { BudgetRow } from "@/components/finance/budget-tab";
import {
  FpaTab,
  type FpaScenario,
  type RollingForecastSummary,
  type FpaDashboard,
  type ScenarioComparison,
} from "@/components/finance/fpa-tab";
import {
  JobCostTab,
  type CostCenterRow,
  type ProjectJobCostRow,
  type CostCenterSummaryRow,
} from "@/components/finance/job-cost-tab";
import type { DepartmentRow, AnalyticSummaryRow } from "@/components/finance/analytics-tab";
import type { FixedAssetRow, FaBookRow, FaBookComparison } from "@/components/finance/fixed-assets-tab";
import type { ExecutiveDashboard } from "@/components/finance/executive-dashboard-tab";
import type {
  ConsolidationGroup,
  OrgOption,
  IntercompanyRelationship,
  IntercompanyTransaction,
} from "@/components/finance/consolidation-tab";
import type { RecurringJournalTemplate, InvoiceReminderRow, FinancialAutomationRule, FinancialScheduledReport } from "@/components/finance/automation-tab";
import type {
  FinancialSecuritySettings,
  SodConflictRule,
  PendingFinancialApprovals,
} from "@/components/finance/financial-security-tab";
import type {
  FinancialPerformanceSettings,
  FinancialPerformanceDashboard,
} from "@/components/finance/financial-performance-tab";
import type {
  FinancialAiSettings,
  FinancialAiSuggestedPrompt,
  FinancialAiInsight,
} from "@/components/finance/financial-assistant-tab";
import type { FinancialShellPreferences, LaunchpadArea } from "@/lib/finance/financial-shell-config";
import type { ReportSnapshotRow } from "@/components/finance/reports-library-tab";
import type { ExchangeRateRow, FxRevaluationRunRow } from "@/components/finance/fx-currencies-tab";
import type { ArAging, ApAging } from "@/components/finance/aging-tab";
import { monthToDate, priorPeriod, priorBalanceSheetDate, formatPeriod } from "@/lib/finance-dates";
import { bucketDailyTotals } from "@/lib/finance-aggregates";
import {
  fetchConsolidatedFinancialReports,
  fetchFinancialsPageRawData,
} from "@/lib/finance/financials-page-data";

function unwrapCachedReport<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

type PnL = {
  from: string;
  to: string;
  revenue: number;
  tax_collected: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number;
  operating_expenses: number;
  net_profit: number;
  net_margin_pct: number;
};

type TrialRow = {
  account_code: string;
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
  balance: number;
};

type StatementLine = { code: string; name: string; amount: number };

type BalanceSheet = {
  as_of: string;
  assets: StatementLine[];
  total_assets: number;
  liabilities: StatementLine[];
  total_liabilities: number;
  equity: StatementLine[];
  current_earnings: number;
  total_equity: number;
  total_liabilities_and_equity: number;
  balanced: boolean;
};

type CashFlow = {
  from: string;
  to: string;
  opening_cash: number;
  inflows: number;
  outflows: number;
  net_change: number;
  closing_cash: number;
  by_source: { source: string; net: number }[];
};

async function FinancialsContent({
  orgId,
  currency,
  from,
  to,
  pnlMode,
  canPostLedger,
  unpostedCount,
  initialTab,
  initialArea,
  orgTimezone,
}: {
  orgId: string;
  currency: string;
  from: string;
  to: string;
  pnlMode: "operational" | "gl";
  canPostLedger: boolean;
  unpostedCount: number;
  initialTab?: string;
  initialArea?: string;
  orgTimezone: string;
}) {
  const supabase = await createReportingClient();
  const prior = priorPeriod(from, to);
  const priorBsDate = priorBalanceSheetDate(to, from);

  const raw = await fetchFinancialsPageRawData(supabase, {
    orgId,
    from,
    to,
    pnlMode,
    canPostLedger,
    initialTab,
    initialArea,
  });
  const { scope } = raw;
  const {
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
  } = raw;

  const charts = (chartData ?? {}) as {
    daily_revenue?: { date: string; value: number }[];
    daily_expenses?: { date: string; value: number }[];
    payment_mix?: { name: string; value: number }[];
    expense_by_category?: { name: string; value: number }[];
  };

  const revenueBuckets = bucketDailyTotals(
    from,
    to,
    (charts.daily_revenue ?? []).map((r) => ({
      date: r.date,
      value: Number(r.value),
    }))
  );

  const expenseBuckets = bucketDailyTotals(
    from,
    to,
    (charts.daily_expenses ?? []).map((e) => ({
      date: e.date,
      value: Number(e.value),
    }))
  );

  const dailyTrend = revenueBuckets.map((r, i) => ({
    label: r.label,
    revenue: r.value,
    expenses: expenseBuckets[i]?.value ?? 0,
  }));

  const paymentMix = (charts.payment_mix ?? [])
    .map((p) => ({ name: p.name.replace(/_/g, " "), value: Number(p.value) }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);

  const expenseByCategory = charts.expense_by_category ?? [];

  const arAging = (arAgingData ?? {
    as_of: to,
    buckets: { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0 },
    total: 0,
    rows: [],
  }) as ArAging;

  const apAging = (apAgingData ?? {
    as_of: to,
    buckets: { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0 },
    total: 0,
    rows: [],
  }) as ApAging;

  const fiscal = (fiscalData ?? {}) as {
    year?: number;
    lock_date?: string | null;
    periods?: FiscalPeriodRow[];
  };
  const fiscalYear = fiscal.year ?? new Date().getFullYear();
  const lockDate = fiscal.lock_date ?? null;
  const fiscalPeriods = fiscal.periods ?? [];
  const jeRequiresApproval =
    (orgData as { je_requires_approval?: boolean } | null)?.je_requires_approval ?? false;
  const journalDrafts = (Array.isArray(draftsData) ? draftsData : []) as JournalDraft[];
  const bankAccounts = (Array.isArray(bankData) ? bankData : []) as BankAccountRow[];
  const taxCodes = (Array.isArray(taxCodesData) ? taxCodesData : []) as TaxCodeRow[];
  const taxSummaryRaw = (taxSummaryData ?? {}) as {
    total_tax?: number;
    input_tax?: number;
    net_payable?: number;
    lines?: TaxSummaryLine[];
  };
  const taxSummary = {
    total_tax: Number(taxSummaryRaw.total_tax ?? 0),
    input_tax: Number(taxSummaryRaw.input_tax ?? 0),
    net_payable: Number(taxSummaryRaw.net_payable ?? 0),
    lines: taxSummaryRaw.lines ?? [],
  };
  const taxComplianceSettings = (taxComplianceData ?? {}) as TaxComplianceSettings;
  const vatLiability = (vatLiabilityData ?? {}) as VatLiabilityReport;
  const taxReturns = (Array.isArray(taxReturnsData) ? taxReturnsData : []) as TaxReturnPeriod[];
  const einvoiceDocuments = (Array.isArray(einvoiceDocsData) ? einvoiceDocsData : []) as EinvoiceDocument[];
  const pendingEinvoices = (Array.isArray(pendingEinvoiceData) ? pendingEinvoiceData : []) as PendingEinvoiceInvoice[];
  const withholdingRules = (Array.isArray(withholdingRulesData) ? withholdingRulesData : []) as WithholdingRule[];
  const fpaScenarios = (Array.isArray(fpaScenariosData) ? fpaScenariosData : []) as FpaScenario[];
  const fpaForecasts = (Array.isArray(fpaForecastsData) ? fpaForecastsData : []) as RollingForecastSummary[];
  const fpaDashboard = (fpaDashboardData ?? {
    as_of: to,
    ytd: { from: from, to: to, revenue: 0, net_profit: 0, operating_expenses: 0 },
    scenario_count: 0,
    active_forecast_count: 0,
  }) as FpaDashboard;
  const fpaComparison = (Array.isArray(fpaComparisonData) ? fpaComparisonData : []) as ScenarioComparison[];
  const costCenters = (Array.isArray(costCentersData) ? costCentersData : []) as CostCenterRow[];
  const projectsJobCost = (Array.isArray(projectsJobCostData) ? projectsJobCostData : []) as ProjectJobCostRow[];
  const costCenterSummary = (Array.isArray(costCenterSummaryData) ? costCenterSummaryData : []) as CostCenterSummaryRow[];
  const faBooks = (Array.isArray(faBooksData) ? faBooksData : []) as FaBookRow[];
  const faBookComparison = (Array.isArray(faBookComparisonData) ? faBookComparisonData : []) as FaBookComparison[];
  const executiveDashboard = unwrapCachedReport<ExecutiveDashboard>(
    executiveDashboardData ?? {
      from,
      to,
      kpis: [],
      monthly_trends: [],
    }
  );
  const financialRules = (Array.isArray(financialRulesData) ? financialRulesData : []) as FinancialAutomationRule[];
  const financialSchedules = (Array.isArray(financialSchedulesData) ? financialSchedulesData : []) as FinancialScheduledReport[];
  const financialSecuritySettings = (financialSecurityData ?? {
    je_requires_approval: jeRequiresApproval,
    je_dual_approval_enabled: false,
    je_dual_approval_threshold: null,
    ap_dual_approval_enabled: false,
    ap_dual_approval_threshold: 50000,
    sod_enforcement_enabled: true,
  }) as FinancialSecuritySettings;
  const sodRules = (Array.isArray(sodRulesData) ? sodRulesData : []) as SodConflictRule[];
  const pendingFinancialApprovals = (pendingApprovalsData ?? {
    journal_entries: [],
    payment_runs: [],
  }) as PendingFinancialApprovals;
  const performanceDashboard = (performanceDashboardData ?? {
    settings: {
      financial_cache_enabled: true,
      financial_cache_ttl_minutes: 60,
      financial_prefer_read_replica: true,
    },
    table_counts: {
      journal_entries: 0,
      journal_entry_lines: 0,
      journal_entries_archived: 0,
      sales: 0,
      sales_archived: 0,
    },
    cache: {},
    partition_policies: [],
  }) as FinancialPerformanceDashboard;
  const financialPerformanceSettings = (performanceDashboard.settings ?? {
    financial_cache_enabled: true,
    financial_cache_ttl_minutes: 60,
    financial_prefer_read_replica: true,
  }) as FinancialPerformanceSettings;
  const financialAiSettings = (financialAiSettingsData ?? {
    financial_ai_enabled: true,
    financial_ai_provider: "internal",
    financial_ai_model: "gpt-4o-mini",
  }) as FinancialAiSettings;
  const financialAiPrompts = (Array.isArray(financialAiPromptsData)
    ? financialAiPromptsData
    : []) as FinancialAiSuggestedPrompt[];
  const financialAiInsights = (Array.isArray(financialAiInsightsData)
    ? financialAiInsightsData
    : []) as FinancialAiInsight[];
  const shellPreferences = {
    default_area: ((shellPreferencesData as FinancialShellPreferences)?.default_area ?? "home") as FinancialShellPreferences["default_area"],
    density: ((shellPreferencesData as FinancialShellPreferences)?.density ?? "cozy") as FinancialShellPreferences["density"],
    pinned_tabs: Array.isArray((shellPreferencesData as FinancialShellPreferences)?.pinned_tabs)
      ? ((shellPreferencesData as FinancialShellPreferences).pinned_tabs as string[])
      : [],
    show_launchpad: (shellPreferencesData as FinancialShellPreferences)?.show_launchpad ?? true,
    updated_at: (shellPreferencesData as FinancialShellPreferences)?.updated_at,
  } satisfies FinancialShellPreferences;
  const launchpadCatalog = (
    (launchpadTilesData as { areas?: LaunchpadArea[] })?.areas ?? []
  ) as LaunchpadArea[];

  const pnlComparative = (pnlComparativeData ?? {}) as {
    prior?: Partial<PnL>;
    prior_from?: string;
    prior_to?: string;
    variance?: Record<string, number>;
  };
  const bsComparative = (bsComparativeData ?? {}) as {
    prior?: BalanceSheet;
    prior_as_of?: string;
    variance?: Record<string, number>;
  };
  const budgets = (Array.isArray(budgetsData) ? budgetsData : []) as BudgetRow[];
  const departments = (Array.isArray(departmentsData) ? departmentsData : []) as DepartmentRow[];
  const parseAnalytic = (raw: unknown) =>
    ((raw as { rows?: AnalyticSummaryRow[] })?.rows ?? []) as AnalyticSummaryRow[];
  const storeSummary = parseAnalytic(storeAnalyticData);
  const projectSummary = parseAnalytic(projectAnalyticData);
  const departmentSummary = parseAnalytic(deptAnalyticData);
  const stores = (storesData as { id: string; name: string }[]) ?? [];
  const projects = (projectsData as { id: string; name: string }[]) ?? [];
  const fixedAssets = (Array.isArray(fixedAssetsData) ? fixedAssetsData : []) as FixedAssetRow[];
  const consolidationGroups = (Array.isArray(consolidationGroupsData) ? consolidationGroupsData : []) as ConsolidationGroup[];
  const myOrganizations = (Array.isArray(myOrgsData) ? myOrgsData : []) as OrgOption[];
  const recurringTemplates = (Array.isArray(recurringTemplatesData) ? recurringTemplatesData : []) as RecurringJournalTemplate[];
  const invoiceReminders = (Array.isArray(invoiceRemindersData) ? invoiceRemindersData : []) as InvoiceReminderRow[];
  const reportSnapshots = (Array.isArray(reportSnapshotsData) ? reportSnapshotsData : []) as ReportSnapshotRow[];
  const exchangeRatesPayload = (exchangeRatesData ?? {}) as { rates?: ExchangeRateRow[] };
  const exchangeRates = exchangeRatesPayload.rates ?? [];
  const fxRevaluationRuns = (Array.isArray(fxRunsData) ? fxRunsData : []) as FxRevaluationRunRow[];
  const intercompanyRelationships = (Array.isArray(icRelationshipsData) ? icRelationshipsData : []) as IntercompanyRelationship[];
  const intercompanyTransactions = (Array.isArray(icTransactionsData) ? icTransactionsData : []) as IntercompanyTransaction[];
  const treasuryCashPosition = (treasuryPositionData ?? null) as TreasuryCashPosition | null;
  const treasuryForecast = (treasuryForecastData ?? null) as TreasuryForecast | null;
  const treasuryTransfers = (Array.isArray(treasuryTransfersData) ? treasuryTransfersData : []) as TreasuryTransferRow[];

  let consolidatedPnl: Record<string, unknown> | null = null;
  let consolidatedBs: Record<string, unknown> | null = null;
  if (scope.planning && consolidationGroups.length > 0) {
    const consolidated = await fetchConsolidatedFinancialReports(supabase, {
      groupId: consolidationGroups[0].id,
      from,
      to,
      pnlMode,
      asOf: to,
    });
    consolidatedPnl = consolidated.consolidatedPnl;
    consolidatedBs = consolidated.consolidatedBs;
  }

  return (
    <FinancialsClient
      orgId={orgId}
      currency={currency}
      from={from}
      to={to}
      pnlMode={pnlMode}
      canPostLedger={canPostLedger}
      unpostedCount={unpostedCount}
      accounts={(accountsData as AccountRow[]) ?? []}
      journals={(journalsData as { id: string; code: string; name: string }[]) ?? []}
      arAging={arAging}
      apAging={apAging}
      jeRequiresApproval={jeRequiresApproval}
      journalDrafts={journalDrafts}
      fiscalYear={fiscalYear}
      lockDate={lockDate}
      fiscalPeriods={fiscalPeriods}
      bankAccounts={bankAccounts}
      taxCodes={taxCodes}
      taxSummary={taxSummary}
      taxComplianceSettings={taxComplianceSettings}
      vatLiability={vatLiability}
      taxReturns={taxReturns}
      einvoiceDocuments={einvoiceDocuments}
      pendingEinvoices={pendingEinvoices}
      withholdingRules={withholdingRules}
      fpaScenarios={fpaScenarios}
      fpaForecasts={fpaForecasts}
      fpaDashboard={fpaDashboard}
      fpaComparison={fpaComparison}
      costCenters={costCenters}
      projectsJobCost={projectsJobCost}
      costCenterSummary={costCenterSummary}
      pnlPrior={(pnlComparative.prior ?? {}) as Partial<PnL>}
      pnlPriorLabel={formatPeriod(pnlComparative.prior_from ?? prior.from, pnlComparative.prior_to ?? prior.to)}
      pnlVariance={pnlComparative.variance ?? {}}
      bsPrior={bsComparative.prior ?? null}
      bsPriorLabel={bsComparative.prior_as_of ?? priorBsDate}
      bsVariance={bsComparative.variance ?? {}}
      budgets={budgets}
      departments={departments}
      storeSummary={storeSummary}
      projectSummary={projectSummary}
      departmentSummary={departmentSummary}
      stores={stores}
      projects={projects}
      fixedAssets={fixedAssets}
      faBooks={faBooks}
      faBookComparison={faBookComparison}
      executiveDashboard={executiveDashboard}
      initialTab={initialTab}
      initialArea={initialArea}
      shellPreferences={shellPreferences}
      launchpadCatalog={launchpadCatalog}
      consolidationGroups={consolidationGroups}
      myOrganizations={myOrganizations}
      consolidatedPnl={consolidatedPnl}
      consolidatedBs={consolidatedBs}
      intercompanyRelationships={intercompanyRelationships}
      intercompanyTransactions={intercompanyTransactions}
      treasuryCashPosition={treasuryCashPosition}
      treasuryForecast={treasuryForecast}
      treasuryTransfers={treasuryTransfers}
      recurringTemplates={recurringTemplates}
      invoiceReminders={invoiceReminders}
      financialRules={financialRules}
      financialSchedules={financialSchedules}
      orgTimezone={orgTimezone}
      financialSecuritySettings={financialSecuritySettings}
      sodRules={sodRules}
      pendingFinancialApprovals={pendingFinancialApprovals}
      financialPerformanceSettings={financialPerformanceSettings}
      performanceDashboard={performanceDashboard}
      financialAiSettings={financialAiSettings}
      financialAiPrompts={financialAiPrompts}
      financialAiInsights={financialAiInsights}
      reportSnapshots={reportSnapshots}
      exchangeRates={exchangeRates}
      fxRevaluationRuns={fxRevaluationRuns}
      pnl={unwrapCachedReport<Partial<PnL & { source?: string }>>(pnlData ?? {})}
      trial={unwrapCachedReport<TrialRow[]>(trialData ?? [])}
      bs={unwrapCachedReport<BalanceSheet | null>(bsData)}
      cf={unwrapCachedReport<CashFlow | null>(cfData)}
      dailyTrend={dailyTrend}
      paymentMix={paymentMix}
      expenseByCategory={expenseByCategory}
    />
  );
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; pnl?: string; tab?: string; area?: string }>;
}) {
  const ctx = await requireAppAccess("accounting");

  const sp = await searchParams;
  const def = monthToDate();
  const from = sp.from ?? def.from;
  const to = sp.to ?? def.to;
  const pnlMode = sp.pnl === "gl" ? "gl" : "operational";
  const initialTab = sp.tab;
  const initialArea = sp.area;
  const orgTimezone = ctx.organization.timezone?.trim() || "Africa/Addis_Ababa";
  const canPostLedger = ctx.canManageApp("accounting");

  let unpostedCount = 0;
  if (canPostLedger) {
    const supabase = await createReportingClient();
    const { data } = await supabase.rpc("count_unposted_sales", { p_org_id: ctx.organization.id });
    unpostedCount = typeof data === "number" ? data : 0;
  }

  return (
    <FinancialsContent
      orgId={ctx.organization.id}
      currency={ctx.organization.currency}
      from={from}
      to={to}
      pnlMode={pnlMode}
      canPostLedger={canPostLedger}
      unpostedCount={unpostedCount}
      initialTab={initialTab}
      initialArea={initialArea}
      orgTimezone={orgTimezone}
    />
  );
}

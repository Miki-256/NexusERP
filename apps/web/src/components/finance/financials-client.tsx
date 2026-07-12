"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { formatPeriod } from "@/lib/finance-dates";
import { createClient } from "@/lib/supabase/client";
import {
  getTenantMainElement,
  refreshPreservingTenantScroll,
  replaceTenantUrl,
  replaceTenantUrlQuery,
  restoreTenantMainScroll,
} from "@/lib/tenant-scroll";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { DateRangeToolbar } from "@/components/finance/date-range-toolbar";
import { ExportCsvButton } from "@/components/finance/export-csv-button";
import { LedgerEntriesTab } from "@/components/finance/ledger-entries-tab";
import { ChartOfAccountsTab, type AccountRow } from "@/components/finance/chart-of-accounts-tab";
import { ManualJournalTab, type JournalDraft } from "@/components/finance/manual-journal-tab";
import { OpeningBalanceWizard } from "@/components/finance/opening-balance-wizard";
import { AgingTab, type ArAging, type ApAging } from "@/components/finance/aging-tab";
import {
  TreasuryTab,
  type TreasuryCashPosition,
  type TreasuryForecast,
  type TreasuryTransferRow,
} from "@/components/finance/treasury-tab";
import { FxCurrenciesTab, type ExchangeRateRow, type FxRevaluationRunRow } from "@/components/finance/fx-currencies-tab";
import { FiscalPeriodsTab, type FiscalPeriodRow } from "@/components/finance/fiscal-periods-tab";
import { BankingTab, type BankAccountRow } from "@/components/finance/banking-tab";
import { TaxTab, type TaxCodeRow, type TaxSummaryLine, type TaxComplianceSettings, type VatLiabilityReport, type TaxReturnPeriod, type EinvoiceDocument, type PendingEinvoiceInvoice, type WithholdingRule } from "@/components/finance/tax-tab";
import { BudgetTab, type BudgetRow } from "@/components/finance/budget-tab";
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
import { AnalyticsTab, type DepartmentRow, type AnalyticSummaryRow } from "@/components/finance/analytics-tab";
import { FixedAssetsTab, type FixedAssetRow, type FaBookRow, type FaBookComparison } from "@/components/finance/fixed-assets-tab";
import {
  ExecutiveDashboardTab,
  type ExecutiveDashboard,
} from "@/components/finance/executive-dashboard-tab";
import {
  ConsolidationTab,
  type ConsolidationGroup,
  type OrgOption,
  type IntercompanyRelationship,
  type IntercompanyTransaction,
} from "@/components/finance/consolidation-tab";
import {
  AutomationTab,
  type RecurringJournalTemplate,
  type InvoiceReminderRow,
  type FinancialAutomationRule,
  type FinancialScheduledReport,
} from "@/components/finance/automation-tab";
import {
  FinancialSecurityTab,
  type FinancialSecuritySettings,
  type SodConflictRule,
  type PendingFinancialApprovals,
} from "@/components/finance/financial-security-tab";
import {
  FinancialPerformanceTab,
  type FinancialPerformanceSettings,
  type FinancialPerformanceDashboard,
} from "@/components/finance/financial-performance-tab";
import {
  FinancialAssistantTab,
  type FinancialAiSettings,
  type FinancialAiSuggestedPrompt,
  type FinancialAiInsight,
} from "@/components/finance/financial-assistant-tab";
import { ReportsLibraryTab, type ReportSnapshotRow } from "@/components/finance/reports-library-tab";
import { FinancialLaunchpad } from "@/components/finance/financial-launchpad";
import { FinancialShellNav, FinancialShellBreadcrumb } from "@/components/finance/financial-shell-nav";
import {
  areaForTab,
  isFinancialShellTab,
  AREA_TABS,
  FINANCIAL_SHELL_AREAS,
  type FinancialShellAreaId,
  type FinancialShellTab,
  type FinancialShellPreferences,
  type LaunchpadArea,
} from "@/lib/finance/financial-shell-config";
import { cn } from "@/lib/utils";
import { ReportSection, StatementTable, ComparativeStatementTable } from "@/components/finance/report-section";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ChartCard,
  DualMetricChart,
  FinanceBarChart,
  FinanceDonutChart,
  PnlWaterfallChart,
  TrendAreaChart,
} from "@/components/charts/finance-charts";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { PAGE_SHELL } from "@/lib/ui-classes";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  DollarSign,
  Landmark,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
  BookOpen,
  Loader2,
} from "lucide-react";

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
  source?: string;
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

type Tab = FinancialShellTab;

export function FinancialsClient({
  orgId,
  currency,
  from,
  to,
  pnlMode,
  canPostLedger,
  unpostedCount: initialUnpostedCount,
  accounts,
  journals,
  arAging,
  apAging,
  jeRequiresApproval,
  journalDrafts,
  fiscalYear,
  lockDate,
  fiscalPeriods,
  bankAccounts,
  taxCodes,
  taxSummary,
  taxComplianceSettings,
  vatLiability,
  taxReturns,
  einvoiceDocuments,
  pendingEinvoices,
  withholdingRules,
  fpaScenarios,
  fpaForecasts,
  fpaDashboard,
  fpaComparison,
  costCenters,
  projectsJobCost,
  costCenterSummary,
  pnlPrior,
  pnlPriorLabel,
  pnlVariance,
  bsPrior,
  bsPriorLabel,
  bsVariance,
  budgets,
  departments,
  storeSummary,
  projectSummary,
  departmentSummary,
  stores,
  projects,
  fixedAssets,
  faBooks,
  faBookComparison,
  executiveDashboard,
  initialTab,
  initialArea,
  shellPreferences,
  launchpadCatalog,
  consolidationGroups,
  myOrganizations,
  consolidatedPnl,
  consolidatedBs,
  intercompanyRelationships,
  intercompanyTransactions,
  treasuryCashPosition,
  treasuryForecast,
  treasuryTransfers,
  recurringTemplates,
  invoiceReminders,
  financialRules,
  financialSchedules,
  orgTimezone,
  financialSecuritySettings,
  sodRules,
  pendingFinancialApprovals,
  financialPerformanceSettings,
  performanceDashboard,
  financialAiSettings,
  financialAiPrompts,
  financialAiInsights,
  reportSnapshots,
  exchangeRates,
  fxRevaluationRuns,
  pnl,
  trial,
  bs,
  cf,
  dailyTrend,
  paymentMix,
  expenseByCategory,
}: {
  orgId: string;
  currency: string;
  from: string;
  to: string;
  pnlMode: "operational" | "gl";
  canPostLedger: boolean;
  unpostedCount: number;
  accounts: AccountRow[];
  journals: { id: string; code: string; name: string }[];
  arAging: ArAging;
  apAging: ApAging;
  jeRequiresApproval: boolean;
  journalDrafts: JournalDraft[];
  fiscalYear: number;
  lockDate: string | null;
  fiscalPeriods: FiscalPeriodRow[];
  bankAccounts: BankAccountRow[];
  taxCodes: TaxCodeRow[];
  taxSummary: { total_tax: number; input_tax?: number; net_payable?: number; lines: TaxSummaryLine[] };
  taxComplianceSettings: TaxComplianceSettings;
  vatLiability: VatLiabilityReport;
  taxReturns: TaxReturnPeriod[];
  einvoiceDocuments: EinvoiceDocument[];
  pendingEinvoices: PendingEinvoiceInvoice[];
  withholdingRules: WithholdingRule[];
  fpaScenarios: FpaScenario[];
  fpaForecasts: RollingForecastSummary[];
  fpaDashboard: FpaDashboard;
  fpaComparison: ScenarioComparison[];
  costCenters: CostCenterRow[];
  projectsJobCost: ProjectJobCostRow[];
  costCenterSummary: CostCenterSummaryRow[];
  pnlPrior: Partial<PnL>;
  pnlPriorLabel: string;
  pnlVariance: Record<string, number>;
  bsPrior: BalanceSheet | null;
  bsPriorLabel: string;
  bsVariance: Record<string, number>;
  budgets: BudgetRow[];
  departments: DepartmentRow[];
  storeSummary: AnalyticSummaryRow[];
  projectSummary: AnalyticSummaryRow[];
  departmentSummary: AnalyticSummaryRow[];
  stores: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  fixedAssets: FixedAssetRow[];
  faBooks: FaBookRow[];
  faBookComparison: FaBookComparison[];
  executiveDashboard: ExecutiveDashboard;
  initialTab?: string;
  initialArea?: string;
  shellPreferences: FinancialShellPreferences;
  launchpadCatalog: LaunchpadArea[];
  consolidationGroups: ConsolidationGroup[];
  myOrganizations: OrgOption[];
  consolidatedPnl: {
    revenue?: number;
    net_profit?: number;
    organizations?: { name: string; net_profit: number }[];
  } | null;
  consolidatedBs: {
    total_assets?: number;
    total_equity?: number;
    organizations?: { name: string; total_assets: number }[];
  } | null;
  intercompanyRelationships: IntercompanyRelationship[];
  intercompanyTransactions: IntercompanyTransaction[];
  treasuryCashPosition: TreasuryCashPosition | null;
  treasuryForecast: TreasuryForecast | null;
  treasuryTransfers: TreasuryTransferRow[];
  recurringTemplates: RecurringJournalTemplate[];
  invoiceReminders: InvoiceReminderRow[];
  financialRules: FinancialAutomationRule[];
  financialSchedules: FinancialScheduledReport[];
  orgTimezone: string;
  financialSecuritySettings: FinancialSecuritySettings;
  sodRules: SodConflictRule[];
  pendingFinancialApprovals: PendingFinancialApprovals;
  financialPerformanceSettings: FinancialPerformanceSettings;
  performanceDashboard: FinancialPerformanceDashboard;
  financialAiSettings: FinancialAiSettings;
  financialAiPrompts: FinancialAiSuggestedPrompt[];
  financialAiInsights: FinancialAiInsight[];
  reportSnapshots: ReportSnapshotRow[];
  exchangeRates: ExchangeRateRow[];
  fxRevaluationRuns: FxRevaluationRunRow[];
  pnl: Partial<PnL>;
  trial: TrialRow[];
  bs: BalanceSheet | null;
  cf: CashFlow | null;
  dailyTrend: { label: string; revenue: number; expenses: number }[];
  paymentMix: { name: string; value: number }[];
  expenseByCategory: { name: string; value: number }[];
}) {
  const defaultTab: Tab = shellPreferences.show_launchpad ? "home" : "overview";
  const resolvedInitialTab =
    initialTab && isFinancialShellTab(initialTab) ? initialTab : defaultTab;
  const resolvedInitialArea: FinancialShellAreaId =
    initialArea && FINANCIAL_SHELL_AREAS.some((a) => a.id === initialArea)
      ? (initialArea as FinancialShellAreaId)
      : areaForTab(resolvedInitialTab);

  const [tab, setTab] = useState<Tab>(resolvedInitialTab);
  const [area, setArea] = useState<FinancialShellAreaId>(resolvedInitialArea);
  const [shellPrefs, setShellPrefs] = useState(shellPreferences);
  const [unpostedCount, setUnpostedCount] = useState(initialUnpostedCount);
  const [posting, setPosting] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const money = (n: number | undefined) => formatCurrency(n ?? 0, currency);
  const period = formatPeriod(from, to);
  const compact = shellPrefs.density === "compact";

  function navigateShell(nextArea: FinancialShellAreaId, nextTab: Tab, refetchArea = false) {
    const main = getTenantMainElement();
    const scrollTop = main?.scrollTop ?? 0;
    setArea(nextArea);
    setTab(nextTab);
    const params = new URLSearchParams(window.location.search);
    params.set("from", from);
    params.set("to", to);
    if (pnlMode === "gl") params.set("pnl", "gl");
    else params.delete("pnl");
    params.set("tab", nextTab);
    params.set("area", nextArea);

    if (refetchArea) {
      replaceTenantUrlQuery(pathname, params);
      restoreTenantMainScroll(main, scrollTop);
      refreshPreservingTenantScroll(router, scrollTop);
      return;
    }
    replaceTenantUrlQuery(pathname, params);
    restoreTenantMainScroll(main, scrollTop);
  }

  function handleAreaChange(nextArea: FinancialShellAreaId) {
    const tabs = nextArea === "home" ? (["home"] as Tab[]) : (AREA_TABS[nextArea] as Tab[]);
    navigateShell(nextArea, tabs[0] ?? "overview", true);
  }

  function handleTabChange(nextTab: Tab) {
    const nextArea = areaForTab(nextTab);
    navigateShell(nextArea, nextTab, nextArea !== area);
  }

  async function toggleDensity() {
    const next = shellPrefs.density === "cozy" ? "compact" : "cozy";
    setShellPrefs((p) => ({ ...p, density: next }));
    const supabase = createClient();
    await supabase.rpc("update_financial_shell_preferences", {
      p_org_id: orgId,
      p_density: next,
    });
  }

  function setPnlMode(mode: "operational" | "gl") {
    const params = new URLSearchParams(window.location.search);
    params.set("from", from);
    params.set("to", to);
    if (mode === "gl") params.set("pnl", "gl");
    else params.delete("pnl");
    replaceTenantUrl(router, pathname, params);
  }

  async function handleBatchPost() {
    if (!canPostLedger || posting) return;
    setPosting(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("post_unposted_sales_batch", {
      p_org_id: orgId,
      p_limit: 200,
    });
    setPosting(false);
    if (error) {
      toast({ title: "Posting failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as {
      posted?: number;
      remaining?: number;
      skipped?: number;
      first_error?: string | null;
    } | null;
    const posted = result?.posted ?? 0;
    const remaining = result?.remaining ?? 0;
    const firstError = result?.first_error?.trim() || null;
    setUnpostedCount(remaining);
    toast({
      title: posted > 0 ? `Posted ${posted} sale${posted === 1 ? "" : "s"} to ledger` : "No sales posted",
      description:
        posted === 0 && firstError
          ? firstError
          : remaining > 0
            ? `${remaining} completed sale${remaining === 1 ? "" : "s"} still waiting to post.${
                firstError ? ` ${firstError}` : ""
              }`
            : "All eligible sales are on the ledger.",
      variant: posted === 0 ? "destructive" : undefined,
    });
    if (posted > 0) refreshPreservingTenantScroll(router);
  }

  const pnlModeLabel =
    pnlMode === "gl"
      ? "General ledger (posted journal entries)"
      : "Operational (sales rollups + expenses)";

  const PnlModeToggle = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={pnlMode === "operational" ? "default" : "outline"}
        onClick={() => setPnlMode("operational")}
      >
        Operational
      </Button>
      <Button
        type="button"
        size="sm"
        variant={pnlMode === "gl" ? "default" : "outline"}
        onClick={() => setPnlMode("gl")}
      >
        GL only
      </Button>
    </div>
  );

  const totalDebits = useMemo(() => trial.reduce((s, r) => s + Number(r.debit), 0), [trial]);
  const totalCredits = useMemo(() => trial.reduce((s, r) => s + Number(r.credit), 0), [trial]);

  const pnlRows = [
    { label: "Revenue", value: money(pnl.revenue), bold: true },
    { label: "Cost of Goods Sold", value: `(${money(pnl.cogs)})`, indent: true },
    { label: "Gross Profit", value: money(pnl.gross_profit), bold: true, border: true },
    { label: "Operating Expenses", value: `(${money(pnl.operating_expenses)})`, indent: true },
    { label: "Net Profit", value: money(pnl.net_profit), bold: true, border: true },
    {
      label: "Tax collected (liability, not revenue)",
      value: money(pnl.tax_collected),
      muted: true,
    },
  ];

  const pnlComparativeRows = [
    {
      label: "Revenue",
      current: money(pnl.revenue),
      prior: money(pnlPrior.revenue),
      variance: money(pnlVariance.revenue ?? 0),
      bold: true,
    },
    {
      label: "Cost of Goods Sold",
      current: `(${money(pnl.cogs)})`,
      prior: `(${money(pnlPrior.cogs)})`,
      variance: money(pnlVariance.cogs ?? 0),
      indent: true,
    },
    {
      label: "Gross Profit",
      current: money(pnl.gross_profit),
      prior: money(pnlPrior.gross_profit),
      variance: money(pnlVariance.gross_profit ?? 0),
      bold: true,
      border: true,
    },
    {
      label: "Operating Expenses",
      current: `(${money(pnl.operating_expenses)})`,
      prior: `(${money(pnlPrior.operating_expenses)})`,
      variance: money(pnlVariance.operating_expenses ?? 0),
      indent: true,
    },
    {
      label: "Net Profit",
      current: money(pnl.net_profit),
      prior: money(pnlPrior.net_profit),
      variance: money(pnlVariance.net_profit ?? 0),
      bold: true,
      border: true,
    },
  ];

  const bsComparativeRows = [
    {
      label: "Total Assets",
      current: money(bs?.total_assets),
      prior: money(bsPrior?.total_assets),
      variance: money(bsVariance.total_assets ?? 0),
      bold: true,
      border: true,
    },
    {
      label: "Total Liabilities",
      current: money(bs?.total_liabilities),
      prior: money(bsPrior?.total_liabilities),
      variance: money(bsVariance.total_liabilities ?? 0),
      bold: true,
      border: true,
    },
    {
      label: "Total Equity",
      current: money(bs?.total_equity),
      prior: money(bsPrior?.total_equity),
      variance: money(bsVariance.total_equity ?? 0),
      bold: true,
      border: true,
    },
  ];

  const bsRows = [
    { label: "Assets", section: true as const },
    ...(bs?.assets ?? []).map((l) => ({
      label: l.name,
      value: money(l.amount),
      indent: true,
    })),
    { label: "Total Assets", value: money(bs?.total_assets), bold: true, border: true },
    { label: "Liabilities", section: true as const },
    ...(bs?.liabilities ?? []).map((l) => ({
      label: l.name,
      value: money(l.amount),
      indent: true,
    })),
    { label: "Total Liabilities", value: money(bs?.total_liabilities), bold: true, border: true },
    { label: "Equity", section: true as const },
    ...(bs?.equity ?? []).map((l) => ({
      label: l.name,
      value: money(l.amount),
      indent: true,
    })),
    { label: "Current Earnings", value: money(bs?.current_earnings), indent: true },
    { label: "Total Equity", value: money(bs?.total_equity), bold: true, border: true },
    {
      label: "Liabilities + Equity",
      value: money(bs?.total_liabilities_and_equity),
      bold: true,
      border: true,
    },
  ];

  const cfRows = [
    { label: "Opening Cash", value: money(cf?.opening_cash) },
    { label: "Cash Inflows", value: money(cf?.inflows), indent: true },
    { label: "Cash Outflows", value: `(${money(cf?.outflows)})`, indent: true },
    { label: "Net Change", value: money(cf?.net_change), bold: true, border: true },
    { label: "Closing Cash", value: money(cf?.closing_cash), bold: true, border: true },
    ...((cf?.by_source?.length ?? 0) > 0 ? [{ label: "By source", section: true as const }] : []),
    ...(cf?.by_source ?? []).map((s) => ({
      label: s.source,
      value: money(s.net),
      indent: true,
    })),
  ];

  return (
    <div className={cn(PAGE_SHELL, compact && "financial-shell-compact space-y-4")}>
      <PageHeader
        breadcrumb={<FinancialShellBreadcrumb area={area} tab={tab} />}
        title="Financial Management"
        description={`Enterprise financial hub · ${period} · ${currency}`}
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => void toggleDensity()}>
            {compact ? "Cozy density" : "Compact density"}
          </Button>
        }
      />

      <DateRangeToolbar from={from} to={to} className="rounded-xl border border-border/60 bg-muted/20 p-4" />

      {canPostLedger && unpostedCount > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <p className="font-medium text-amber-950">
                {unpostedCount} completed sale{unpostedCount === 1 ? "" : "s"} not on the ledger
              </p>
              <p className="mt-1 text-sm text-amber-900/80">
                Post sales to sync the general ledger with POS activity, or enable auto-post in Settings.
              </p>
            </div>
          </div>
          <Button type="button" size="sm" onClick={handleBatchPost} disabled={posting}>
            {posting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Posting…
              </>
            ) : (
              <>
                <BookOpen className="mr-1.5 h-4 w-4" />
                Post {unpostedCount} to ledger
              </>
            )}
          </Button>
        </div>
      )}

      <FinancialShellNav
        area={area}
        tab={tab}
        onAreaChange={handleAreaChange}
        onTabChange={handleTabChange}
        tabCounts={{ coa: accounts.length }}
      />

      {tab === "home" && (
        <FinancialLaunchpad
          catalog={launchpadCatalog}
          pinnedTabs={shellPrefs.pinned_tabs}
          onSelectTab={(nextTab) => navigateShell(areaForTab(nextTab), nextTab)}
          compact={compact}
          kpis={[
            { label: "Revenue", value: money(pnl.revenue), sub: `${pnl.gross_margin_pct ?? 0}% gross margin` },
            { label: "Net profit", value: money(pnl.net_profit), sub: `${pnl.net_margin_pct ?? 0}% net margin` },
            { label: "Closing cash", value: money(cf?.closing_cash) },
            {
              label: "Ledger",
              value: bs?.balanced ? "Balanced" : "Review",
              sub: bs?.balanced ? "Trial balance OK" : "Out of balance",
            },
          ]}
        />
      )}

      {tab === "executive" && (
        <ExecutiveDashboardTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          from={from}
          to={to}
          dashboard={executiveDashboard}
        />
      )}

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Revenue"
              value={money(pnl.revenue)}
              sub={`${pnl.gross_margin_pct ?? 0}% gross margin`}
              icon={DollarSign}
            />
            <StatCard
              label="Gross Profit"
              value={money(pnl.gross_profit)}
              icon={TrendingUp}
              highlight={(pnl.gross_profit ?? 0) >= 0 ? "positive" : "negative"}
            />
            <StatCard
              label="Operating Expenses"
              value={money(pnl.operating_expenses)}
              icon={TrendingDown}
            />
            <StatCard
              label="Net Profit"
              value={money(pnl.net_profit)}
              sub={`${pnl.net_margin_pct ?? 0}% net margin`}
              icon={Landmark}
              highlight={(pnl.net_profit ?? 0) >= 0 ? "positive" : "negative"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total Assets" value={money(bs?.total_assets)} icon={Wallet} />
            <StatCard label="Closing Cash" value={money(cf?.closing_cash)} icon={ArrowUpRight} />
            <StatCard
              label="Ledger Balance"
              value={bs?.balanced ? "Balanced" : "Out of balance"}
              sub={`Debits ${money(totalDebits)} · Credits ${money(totalCredits)}`}
              icon={Scale}
              highlight={bs?.balanced ? "positive" : "negative"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Revenue vs expenses" subtitle={`Daily trend · ${period}`}>
              <DualMetricChart data={dailyTrend} formatValue={money} />
            </ChartCard>
            <ChartCard title="Payment method mix" subtitle="Collections in period">
              {paymentMix.length > 0 ? (
                <FinanceDonutChart data={paymentMix.slice(0, 6)} formatValue={money} />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No payments in this period.</p>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <ChartCard title="P&L composition" subtitle="Waterfall view" className="lg:col-span-2">
              <PnlWaterfallChart
                revenue={pnl.revenue ?? 0}
                cogs={pnl.cogs ?? 0}
                opex={pnl.operating_expenses ?? 0}
                netProfit={pnl.net_profit ?? 0}
                formatValue={money}
              />
            </ChartCard>
            <ChartCard title="Expenses by category" subtitle="Operating spend">
              {expenseByCategory.length > 0 ? (
                <FinanceDonutChart data={expenseByCategory.slice(0, 6)} formatValue={money} innerRadius={48} />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No expenses recorded.</p>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
          <ReportSection
            title="Profit & Loss"
            subtitle={`${pnlModeLabel} · ${period}`}
            actions={PnlModeToggle}
          >
            <StatementTable rows={pnlRows} />
          </ReportSection>

          <ReportSection title="Cash Flow Summary" subtitle={period}>
            <StatementTable rows={cfRows.slice(0, 5)} />
          </ReportSection>

          <ReportSection title="Balance Sheet Snapshot" subtitle={`As of ${to}`} className="lg:col-span-2">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">Assets</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{money(bs?.total_assets)}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">Liabilities</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{money(bs?.total_liabilities)}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">Equity</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{money(bs?.total_equity)}</p>
              </div>
            </div>
            {bs && !bs.balanced && (
              <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Ledger is not balanced. Post historical sales and expenses, or review journal entries.
              </p>
            )}
          </ReportSection>
          </div>
        </div>
      )}

      {tab === "pnl" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Profit waterfall" subtitle={period}>
              <PnlWaterfallChart
                revenue={pnl.revenue ?? 0}
                cogs={pnl.cogs ?? 0}
                opex={pnl.operating_expenses ?? 0}
                netProfit={pnl.net_profit ?? 0}
                formatValue={money}
              />
            </ChartCard>
            <ChartCard title="Margin analysis" subtitle="Key ratios">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="text-xs uppercase text-muted-foreground">Gross margin</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-emerald-600">{pnl.gross_margin_pct ?? 0}%</p>
                  <p className="mt-1 text-xs text-muted-foreground">{money(pnl.gross_profit)} gross profit</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="text-xs uppercase text-muted-foreground">Net margin</p>
                  <p className={`mt-2 text-3xl font-bold tabular-nums ${(pnl.net_profit ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {pnl.net_margin_pct ?? 0}%
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{money(pnl.net_profit)} net profit</p>
                </div>
                <div className="col-span-2 rounded-lg border bg-muted/20 p-4">
                  <p className="text-xs uppercase text-muted-foreground">Revenue trend</p>
                  <TrendAreaChart
                    data={dailyTrend.map((d) => ({ label: d.label, value: d.revenue }))}
                    height={160}
                    formatValue={money}
                  />
                </div>
              </div>
            </ChartCard>
          </div>
        <ReportSection
          title="Profit & Loss Statement"
          subtitle={`${pnlModeLabel} · ${period}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {PnlModeToggle}
              <ExportCsvButton
                filename={`profit-and-loss-${from}-${to}`}
                rows={pnlRows
                  .filter((r) => !("section" in r && r.section))
                  .map((r) => ({
                    line_item: r.label,
                    amount: r.value,
                  }))}
                columns={[
                  { key: "line_item", label: "Line Item" },
                  { key: "amount", label: "Amount" },
                ]}
              />
            </div>
          }
        >
          <StatementTable rows={pnlRows} />
          <div className="mt-8">
            <h3 className="mb-3 text-sm font-semibold">Comparative P&amp;L</h3>
            <ComparativeStatementTable
              rows={pnlComparativeRows}
              currentLabel={period}
              priorLabel={pnlPriorLabel}
            />
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Gross margin</p>
              <p className="text-xl font-semibold tabular-nums">{pnl.gross_margin_pct ?? 0}%</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Net margin</p>
              <p className="text-xl font-semibold tabular-nums">{pnl.net_margin_pct ?? 0}%</p>
            </div>
          </div>
        </ReportSection>
        </div>
      )}

      {tab === "balance" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Balance sheet composition" subtitle={`As of ${to}`}>
              <FinanceDonutChart
                data={[
                  { name: "Assets", value: bs?.total_assets ?? 0 },
                  { name: "Liabilities", value: bs?.total_liabilities ?? 0 },
                  { name: "Equity", value: bs?.total_equity ?? 0 },
                ].filter((d) => d.value > 0)}
                formatValue={money}
              />
            </ChartCard>
            <ChartCard title="Account breakdown" subtitle="By section">
              <FinanceBarChart
                layout="vertical"
                formatValue={money}
                data={[
                  ...(bs?.assets ?? []).slice(0, 4).map((l) => ({ name: l.name, value: l.amount, fill: "hsl(142 71% 45%)" })),
                  ...(bs?.liabilities ?? []).slice(0, 3).map((l) => ({ name: l.name, value: l.amount, fill: "hsl(0 72% 51%)" })),
                  ...(bs?.equity ?? []).slice(0, 3).map((l) => ({ name: l.name, value: l.amount, fill: "hsl(221 83% 53%)" })),
                ]}
              />
            </ChartCard>
          </div>
        <ReportSection
          title="Balance Sheet"
          subtitle={`As of ${to}`}
          actions={
            <ExportCsvButton
              filename={`balance-sheet-${to}`}
              rows={[
                ...(bs?.assets ?? []).map((l) => ({ section: "Assets", account: l.name, amount: l.amount })),
                ...(bs?.liabilities ?? []).map((l) => ({ section: "Liabilities", account: l.name, amount: l.amount })),
                ...(bs?.equity ?? []).map((l) => ({ section: "Equity", account: l.name, amount: l.amount })),
                { section: "Equity", account: "Current Earnings", amount: bs?.current_earnings ?? 0 },
              ]}
              columns={[
                { key: "section", label: "Section" },
                { key: "account", label: "Account" },
                { key: "amount", label: "Amount" },
              ]}
            />
          }
        >
          <StatementTable
            rows={bsRows}
            footer={
              bs && !bs.balanced ? (
                <p className="mt-4 flex items-center gap-2 text-sm text-amber-700">
                  <ArrowDownRight className="h-4 w-4" />
                  Assets do not equal liabilities plus equity — review unposted transactions.
                </p>
              ) : undefined
            }
          />
          <div className="mt-8">
            <h3 className="mb-3 text-sm font-semibold">Comparative balance sheet</h3>
            <ComparativeStatementTable
              rows={bsComparativeRows}
              currentLabel={`As of ${to}`}
              priorLabel={`As of ${bsPriorLabel}`}
            />
          </div>
        </ReportSection>
        </div>
      )}

      {tab === "cashflow" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Cash movement" subtitle={period}>
              <FinanceBarChart
                formatValue={money}
                data={[
                  { name: "Opening", value: cf?.opening_cash ?? 0, fill: "hsl(221 83% 53%)" },
                  { name: "Inflows", value: cf?.inflows ?? 0, fill: "hsl(142 71% 45%)" },
                  { name: "Outflows", value: cf?.outflows ?? 0, fill: "hsl(0 72% 51%)" },
                  { name: "Closing", value: cf?.closing_cash ?? 0, fill: "hsl(199 96% 36%)" },
                ]}
              />
            </ChartCard>
            <ChartCard title="Cash by source" subtitle="Net by activity">
              {(cf?.by_source?.length ?? 0) > 0 ? (
                <FinanceDonutChart
                  data={(cf?.by_source ?? []).map((s) => ({ name: s.source, value: Math.abs(s.net) }))}
                  formatValue={money}
                />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No cash flow sources recorded.</p>
              )}
            </ChartCard>
          </div>
        <ReportSection
          title="Cash Flow Statement"
          subtitle={`Direct method · ${period}`}
          actions={
            <ExportCsvButton
              filename={`cash-flow-${from}-${to}`}
              rows={[
                { line: "Opening Cash", amount: cf?.opening_cash ?? 0 },
                { line: "Inflows", amount: cf?.inflows ?? 0 },
                { line: "Outflows", amount: cf?.outflows ?? 0 },
                { line: "Net Change", amount: cf?.net_change ?? 0 },
                { line: "Closing Cash", amount: cf?.closing_cash ?? 0 },
                ...(cf?.by_source ?? []).map((s) => ({ line: s.source, amount: s.net })),
              ]}
              columns={[
                { key: "line", label: "Line Item" },
                { key: "amount", label: "Amount" },
              ]}
            />
          }
        >
          <StatementTable rows={cfRows} />
        </ReportSection>
        </div>
      )}

      {tab === "ledger" && (
        <LedgerEntriesTab orgId={orgId} currency={currency} from={from} to={to} canManage={canPostLedger} />
      )}

      {tab === "coa" && (
        <ChartOfAccountsTab orgId={orgId} canManage={canPostLedger} accounts={accounts} />
      )}

      {tab === "journal" && (
        <div className="space-y-6">
          <OpeningBalanceWizard
            orgId={orgId}
            currency={currency}
            canManage={canPostLedger}
            accounts={accounts}
          />
          <ManualJournalTab
            orgId={orgId}
            currency={currency}
            canManage={canPostLedger}
            jeRequiresApproval={jeRequiresApproval}
            drafts={journalDrafts}
            accounts={accounts}
            journals={journals}
            stores={stores}
            projects={projects}
            departments={departments}
          />
        </div>
      )}

      {tab === "periods" && (
        <FiscalPeriodsTab
          currency={currency}
          canManage={canPostLedger}
          fiscalYear={fiscalYear}
          lockDate={lockDate}
          periods={fiscalPeriods}
        />
      )}

      {tab === "banking" && (
        <BankingTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          from={from}
          to={to}
          bankAccounts={bankAccounts}
          glAccounts={accounts}
        />
      )}

      {tab === "treasury" && (
        <TreasuryTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          asOf={to}
          bankAccounts={bankAccounts}
          cashPosition={treasuryCashPosition}
          forecast={treasuryForecast}
          transfers={treasuryTransfers}
        />
      )}

      {tab === "fx" && (
        <FxCurrenciesTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          asOf={to}
          exchangeRates={exchangeRates}
          revaluationRuns={fxRevaluationRuns}
        />
      )}

      {tab === "tax" && (
        <TaxTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          from={from}
          to={to}
          taxCodes={taxCodes}
          taxSummary={taxSummary}
          complianceSettings={taxComplianceSettings}
          vatLiability={vatLiability}
          taxReturns={taxReturns}
          einvoiceDocuments={einvoiceDocuments}
          pendingEinvoices={pendingEinvoices}
          withholdingRules={withholdingRules}
        />
      )}

      {tab === "budget" && (
        <BudgetTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          from={from}
          to={to}
          budgets={budgets}
          accounts={accounts}
        />
      )}

      {tab === "fpa" && (
        <FpaTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          asOf={to}
          scenarios={fpaScenarios}
          forecasts={fpaForecasts}
          dashboard={fpaDashboard}
          scenarioComparison={fpaComparison}
        />
      )}

      {tab === "jobcost" && (
        <JobCostTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          from={from}
          to={to}
          costCenters={costCenters}
          projectsJobCost={projectsJobCost}
          costCenterSummary={costCenterSummary}
          accounts={accounts}
          projects={projects}
        />
      )}

      {tab === "analytics" && (
        <AnalyticsTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          from={from}
          to={to}
          departments={departments}
          storeSummary={storeSummary}
          projectSummary={projectSummary}
          departmentSummary={departmentSummary}
        />
      )}

      {tab === "assets" && (
        <FixedAssetsTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          assets={fixedAssets}
          faBooks={faBooks}
          bookComparison={faBookComparison}
        />
      )}

      {tab === "consolidation" && (
        <ConsolidationTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          from={from}
          to={to}
          groups={consolidationGroups}
          myOrganizations={myOrganizations}
          consolidatedPnl={consolidatedPnl}
          consolidatedBs={consolidatedBs}
          intercompanyRelationships={intercompanyRelationships}
          intercompanyTransactions={intercompanyTransactions}
        />
      )}

      {tab === "automation" && (
        <AutomationTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          orgTimezone={orgTimezone}
          accounts={accounts}
          journals={journals}
          templates={recurringTemplates}
          invoiceReminders={invoiceReminders}
          financialRules={financialRules}
          financialSchedules={financialSchedules}
        />
      )}

      {tab === "security" && (
        <FinancialSecurityTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          settings={financialSecuritySettings}
          sodRules={sodRules}
          pendingApprovals={pendingFinancialApprovals}
        />
      )}

      {tab === "performance" && (
        <FinancialPerformanceTab
          orgId={orgId}
          canManage={canPostLedger}
          settings={financialPerformanceSettings}
          dashboard={performanceDashboard}
        />
      )}

      {tab === "assistant" && (
        <FinancialAssistantTab
          orgId={orgId}
          from={from}
          to={to}
          canManage={canPostLedger}
          settings={financialAiSettings}
          suggestedPrompts={financialAiPrompts}
          insights={financialAiInsights}
          initialMessages={[]}
        />
      )}

      {tab === "reports" && (
        <ReportsLibraryTab
          orgId={orgId}
          currency={currency}
          canManage={canPostLedger}
          from={from}
          to={to}
          pnlMode={pnlMode}
          snapshots={reportSnapshots}
          currentPnl={{
            revenue: pnl.revenue,
            net_profit: pnl.net_profit,
            gross_profit: pnl.gross_profit,
            operating_expenses: pnl.operating_expenses,
            cogs: pnl.cogs,
          }}
          currentBs={
            bs
              ? {
                  total_assets: bs.total_assets,
                  total_liabilities: bs.total_liabilities,
                  total_equity: bs.total_equity,
                }
              : null
          }
        />
      )}

      {tab === "aging" && <AgingTab currency={currency} arAging={arAging} apAging={apAging} />}

      {tab === "trial" && (
        <ReportSection
          title="Trial Balance"
          subtitle={`As of ${to} · ${trial.length} accounts`}
          actions={
            <ExportCsvButton
              filename={`trial-balance-${to}`}
              rows={trial.map((r) => ({
                code: r.account_code,
                account: r.account_name,
                type: r.account_type,
                debit: r.debit || "",
                credit: r.credit || "",
                balance: r.balance,
              }))}
              columns={[
                { key: "code", label: "Code" },
                { key: "account", label: "Account" },
                { key: "type", label: "Type" },
                { key: "debit", label: "Debit" },
                { key: "credit", label: "Credit" },
                { key: "balance", label: "Balance" },
              ]}
            />
          }
        >
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Code</DataTableHead>
                <DataTableHead>Account</DataTableHead>
                <DataTableHead>Type</DataTableHead>
                <DataTableHead align="right">Debit</DataTableHead>
                <DataTableHead align="right">Credit</DataTableHead>
                <DataTableHead align="right">Balance</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {trial.length === 0 ? (
                  <DataTableEmpty
                    colSpan={6}
                    message="No ledger entries yet. Posted sales, expenses, and invoices will appear here."
                  />
                ) : (
                  <>
                    {trial.map((r) => (
                      <DataTableRow key={r.account_code}>
                        <DataTableCell className="font-mono text-xs">{r.account_code}</DataTableCell>
                        <DataTableCell>{r.account_name}</DataTableCell>
                        <DataTableCell className="capitalize text-muted-foreground">{r.account_type}</DataTableCell>
                        <DataTableCell align="right" className="font-mono">
                          {r.debit ? money(r.debit) : "—"}
                        </DataTableCell>
                        <DataTableCell align="right" className="font-mono">
                          {r.credit ? money(r.credit) : "—"}
                        </DataTableCell>
                        <DataTableCell align="right" className="font-mono font-medium">
                          {money(r.balance)}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                    <DataTableRow>
                      <DataTableCell className="font-semibold">Totals</DataTableCell>
                      <DataTableCell>{" "}</DataTableCell>
                      <DataTableCell>{" "}</DataTableCell>
                      <DataTableCell align="right" className="font-mono font-semibold">
                        {money(totalDebits)}
                      </DataTableCell>
                      <DataTableCell align="right" className="font-mono font-semibold">
                        {money(totalCredits)}
                      </DataTableCell>
                      <DataTableCell>{" "}</DataTableCell>
                    </DataTableRow>
                  </>
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}
    </div>
  );
}

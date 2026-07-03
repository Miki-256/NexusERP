import { requireAppAccess } from "@/lib/require-app-access";
import { createReportingClient } from "@/lib/supabase/server";
import { Suspense } from "react";
import { FinancialsClient } from "@/components/finance/financials-client";
import type { AccountRow } from "@/components/finance/chart-of-accounts-tab";
import type { JournalDraft } from "@/components/finance/manual-journal-tab";
import type { FiscalPeriodRow } from "@/components/finance/fiscal-periods-tab";
import type { BankAccountRow } from "@/components/finance/banking-tab";
import type { TaxCodeRow, TaxSummaryLine } from "@/components/finance/tax-tab";
import type { BudgetRow } from "@/components/finance/budget-tab";
import type { DepartmentRow, AnalyticSummaryRow } from "@/components/finance/analytics-tab";
import type { FixedAssetRow } from "@/components/finance/fixed-assets-tab";
import type { ConsolidationGroup, OrgOption } from "@/components/finance/consolidation-tab";
import type { RecurringJournalTemplate, InvoiceReminderRow } from "@/components/finance/automation-tab";
import type { ReportSnapshotRow } from "@/components/finance/reports-library-tab";
import type { ArAging, ApAging } from "@/components/finance/aging-tab";
import { monthToDate, priorPeriod, priorBalanceSheetDate, formatPeriod } from "@/lib/finance-dates";
import { bucketDailyTotals } from "@/lib/finance-aggregates";
import { Skeleton } from "@/components/ui/skeleton";

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
}: {
  orgId: string;
  currency: string;
  from: string;
  to: string;
  pnlMode: "operational" | "gl";
  canPostLedger: boolean;
  unpostedCount: number;
}) {
  const supabase = await createReportingClient();
  const prior = priorPeriod(from, to);
  const priorBsDate = priorBalanceSheetDate(to, from);

  if (canPostLedger) {
    await supabase.rpc("ensure_fiscal_year", { p_org_id: orgId });
    await supabase.rpc("ensure_default_tax_codes", { p_org_id: orgId });
  }

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
  ] = await Promise.all([
    supabase.rpc("profit_and_loss", {
      p_org_id: orgId,
      p_from: from,
      p_to: to,
      p_mode: pnlMode,
    }),
    supabase.rpc("trial_balance", { p_org_id: orgId, p_to: to }),
    supabase.rpc("balance_sheet", { p_org_id: orgId, p_to: to }),
    supabase.rpc("cash_flow", { p_org_id: orgId, p_from: from, p_to: to }),
    supabase.rpc("financials_chart_data", { p_org_id: orgId, p_from: from, p_to: to }),
    supabase.rpc("list_accounts", { p_org_id: orgId }),
    supabase.rpc("accounts_receivable_aging", { p_org_id: orgId, p_as_of: to }),
    supabase.rpc("accounts_payable_aging", { p_org_id: orgId, p_as_of: to }),
    supabase.from("journals").select("id, code, name").eq("organization_id", orgId).order("code"),
    supabase.rpc("list_fiscal_periods", { p_org_id: orgId }),
    canPostLedger
      ? supabase.rpc("list_journal_entry_drafts", { p_org_id: orgId })
      : Promise.resolve({ data: [] as JournalDraft[] }),
    supabase.from("organizations").select("je_requires_approval").eq("id", orgId).single(),
    supabase.rpc("list_bank_accounts", { p_org_id: orgId }),
    supabase.rpc("list_tax_codes", { p_org_id: orgId }),
    supabase.rpc("tax_summary_report", { p_org_id: orgId, p_from: from, p_to: to }),
    supabase.rpc("comparative_profit_and_loss", {
      p_org_id: orgId,
      p_from: from,
      p_to: to,
      p_prior_from: prior.from,
      p_prior_to: prior.to,
      p_mode: pnlMode,
    }),
    supabase.rpc("comparative_balance_sheet", {
      p_org_id: orgId,
      p_as_of: to,
      p_prior_as_of: priorBsDate,
    }),
    supabase.rpc("list_budgets", { p_org_id: orgId }),
    supabase.rpc("list_departments", { p_org_id: orgId }),
    supabase.rpc("analytic_ledger_summary", { p_org_id: orgId, p_from: from, p_to: to, p_dimension: "store" }),
    supabase.rpc("analytic_ledger_summary", { p_org_id: orgId, p_from: from, p_to: to, p_dimension: "project" }),
    supabase.rpc("analytic_ledger_summary", { p_org_id: orgId, p_from: from, p_to: to, p_dimension: "department" }),
    supabase.from("stores").select("id, name").eq("organization_id", orgId).order("name"),
    supabase.from("projects").select("id, name").eq("organization_id", orgId).order("name").limit(100),
    supabase.rpc("list_fixed_assets", { p_org_id: orgId }),
    supabase.rpc("list_consolidation_groups", { p_org_id: orgId }),
    supabase.rpc("list_my_organizations"),
    supabase.rpc("list_recurring_journal_templates", { p_org_id: orgId }),
    supabase.rpc("list_invoices_needing_reminder", { p_org_id: orgId }),
    supabase.rpc("list_financial_report_snapshots", { p_org_id: orgId }),
  ]);

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
  const jeRequiresApproval = orgData?.je_requires_approval ?? false;
  const journalDrafts = (Array.isArray(draftsData) ? draftsData : []) as JournalDraft[];
  const bankAccounts = (Array.isArray(bankData) ? bankData : []) as BankAccountRow[];
  const taxCodes = (Array.isArray(taxCodesData) ? taxCodesData : []) as TaxCodeRow[];
  const taxSummaryRaw = (taxSummaryData ?? {}) as { total_tax?: number; lines?: TaxSummaryLine[] };
  const taxSummary = {
    total_tax: Number(taxSummaryRaw.total_tax ?? 0),
    lines: taxSummaryRaw.lines ?? [],
  };

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

  let consolidatedPnl: Record<string, unknown> | null = null;
  let consolidatedBs: Record<string, unknown> | null = null;
  if (consolidationGroups.length > 0) {
    const firstGroupId = consolidationGroups[0].id;
    const [{ data: cPnl }, { data: cBs }] = await Promise.all([
      supabase.rpc("consolidated_profit_and_loss", {
        p_group_id: firstGroupId,
        p_from: from,
        p_to: to,
        p_mode: pnlMode,
      }),
      supabase.rpc("consolidated_balance_sheet", {
        p_group_id: firstGroupId,
        p_as_of: to,
      }),
    ]);
    consolidatedPnl = (cPnl as Record<string, unknown>) ?? null;
    consolidatedBs = (cBs as Record<string, unknown>) ?? null;
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
      consolidationGroups={consolidationGroups}
      myOrganizations={myOrganizations}
      consolidatedPnl={consolidatedPnl}
      consolidatedBs={consolidatedBs}
      recurringTemplates={recurringTemplates}
      invoiceReminders={invoiceReminders}
      reportSnapshots={reportSnapshots}
      pnl={(pnlData ?? {}) as Partial<PnL & { source?: string }>}
      trial={(trialData ?? []) as TrialRow[]}
      bs={bsData as BalanceSheet | null}
      cf={cfData as CashFlow | null}
      dailyTrend={dailyTrend}
      paymentMix={paymentMix}
      expenseByCategory={expenseByCategory}
    />
  );
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; pnl?: string }>;
}) {
  const ctx = await requireAppAccess("accounting");

  const sp = await searchParams;
  const def = monthToDate();
  const from = sp.from ?? def.from;
  const to = sp.to ?? def.to;
  const pnlMode = sp.pnl === "gl" ? "gl" : "operational";
  const canPostLedger = ctx.canManageApp("accounting");

  let unpostedCount = 0;
  if (canPostLedger) {
    const supabase = await createReportingClient();
    const { data } = await supabase.rpc("count_unposted_sales", { p_org_id: ctx.organization.id });
    unpostedCount = typeof data === "number" ? data : 0;
  }

  return (
    <Suspense
      fallback={
        <div className="space-y-6 p-6">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      }
    >
      <FinancialsContent
        orgId={ctx.organization.id}
        currency={ctx.organization.currency}
        from={from}
        to={to}
        pnlMode={pnlMode}
        canPostLedger={canPostLedger}
        unpostedCount={unpostedCount}
      />
    </Suspense>
  );
}

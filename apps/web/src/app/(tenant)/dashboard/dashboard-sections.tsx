import Link from "next/link";
import dynamic from "next/dynamic";
import type { ErpAppId } from "@/lib/app-permissions";
import { formatCurrency, relationName } from "@/lib/utils";
import { pctChange } from "@/lib/finance-dates";
import { StatCard } from "@/components/layout/stat-card";
import { StatusBadge } from "@/components/layout/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { ReportSection, StatementTable } from "@/components/finance/report-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CreditCard,
  FileText,
  Landmark,
  Package,
  Receipt,
  ShoppingCart,
  Smartphone,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { DashboardBundle } from "./dashboard-bundle";

function ChartSkeleton({ className }: { className?: string }) {
  return <Skeleton className={className ?? "h-80 rounded-lg"} />;
}

const SalesTrendChart = dynamic(
  () => import("@/components/charts/sales-trend-chart").then((m) => m.SalesTrendChart),
  { loading: () => <ChartSkeleton /> }
);

const DashboardFinancialCharts = dynamic(
  () => import("@/components/charts/dashboard-financial-charts").then((m) => m.DashboardFinancialCharts),
  { loading: () => <ChartSkeleton className="h-64 rounded-lg" /> }
);

const MetricBarChart = dynamic(
  () => import("@/components/charts/metric-bar-chart").then((m) => m.MetricBarChart),
  { loading: () => <ChartSkeleton className="h-40 rounded-lg" /> }
);

const ActivityTimeline = dynamic(
  () => import("@/components/charts/metric-bar-chart").then((m) => m.ActivityTimeline),
  { loading: () => <ChartSkeleton className="h-48 rounded-lg" /> }
);

export function DashboardKpis({
  bundle,
  currency,
  canAccessAccounting,
}: {
  bundle: DashboardBundle;
  currency: string;
  canAccessAccounting: boolean;
}) {
  const today = bundle.today_stats ?? {};

  if (!canAccessAccounting) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue today (POS)"
          value={formatCurrency(today.sales_total ?? 0, currency)}
          sub={`${today.transaction_count ?? 0} transactions`}
          icon={TrendingUp}
        />
        <StatCard
          label="Cash collected today"
          value={formatCurrency(today.cash_total ?? 0, currency)}
          icon={Banknote}
        />
        <StatCard
          label="Mobile money today"
          value={formatCurrency(today.mobile_total ?? 0, currency)}
          icon={Smartphone}
        />
        <StatCard
          label="Bank transfers today"
          value={formatCurrency(today.bank_total ?? 0, currency)}
          icon={CreditCard}
        />
      </div>
    );
  }

  const pnl = bundle.mtd_pnl ?? {};
  const prevNet = Number(bundle.prev_pnl?.net_profit ?? 0);
  const netChange = pctChange(Number(pnl.net_profit ?? 0), prevNet);
  const arTotal = Number(bundle.ar_total ?? 0);
  const apTotal = Number(bundle.ap_total ?? 0);
  const closingCash = Number(bundle.mtd_cash_flow?.closing_cash ?? 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue today (POS)"
          value={formatCurrency(today.sales_total ?? 0, currency)}
          sub={`${today.transaction_count ?? 0} transactions`}
          icon={TrendingUp}
        />
        <StatCard
          label="Net profit (MTD)"
          value={formatCurrency(pnl.net_profit ?? 0, currency)}
          sub={netChange != null ? `${netChange >= 0 ? "+" : ""}${netChange}% vs last month` : "Month to date"}
          icon={Landmark}
          trend={
            netChange != null
              ? { value: `${netChange >= 0 ? "+" : ""}${netChange}%`, positive: netChange >= 0 }
              : undefined
          }
          highlight={(pnl.net_profit ?? 0) >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Cash position"
          value={formatCurrency(closingCash, currency)}
          sub="Closing cash MTD"
          icon={Wallet}
        />
        <StatCard
          label="Receivables / Payables"
          value={formatCurrency(arTotal, currency)}
          sub={`AP ${formatCurrency(apTotal, currency)} outstanding`}
          icon={FileText}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Cash collected today"
          value={formatCurrency(today.cash_total ?? 0, currency)}
          icon={Banknote}
        />
        <StatCard
          label="Mobile money today"
          value={formatCurrency(today.mobile_total ?? 0, currency)}
          icon={Smartphone}
        />
        <StatCard
          label="Bank transfers today"
          value={formatCurrency(today.bank_total ?? 0, currency)}
          icon={CreditCard}
        />
        <StatCard
          label="Ledger revenue (MTD)"
          value={formatCurrency(pnl.revenue ?? 0, currency)}
          sub="Accrual basis"
          icon={ArrowUpRight}
        />
      </div>
    </>
  );
}

export function DashboardFinancialPanel({
  bundle,
  currency,
}: {
  bundle: DashboardBundle;
  currency: string;
}) {
  const pnl = bundle.mtd_pnl ?? {};
  const cf = bundle.mtd_cash_flow ?? {};
  const mtdFrom = bundle.mtd_from ?? "";
  const mtdTo = bundle.mtd_to ?? "";
  const money = (n: number | undefined) => formatCurrency(n ?? 0, currency);

  return (
    <ReportSection
      title="Financial performance"
      subtitle={`Month to date · ${mtdFrom} → ${mtdTo}`}
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href="/financials">View statements</Link>
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <StatementTable
          rows={[
            { label: "Revenue", value: money(pnl.revenue), bold: true },
            { label: "Cost of goods sold", value: `(${money(pnl.cogs)})`, indent: true },
            { label: "Gross profit", value: money(pnl.gross_profit), bold: true, border: true },
            { label: "Operating expenses", value: `(${money(pnl.operating_expenses)})`, indent: true },
            { label: "Net profit", value: money(pnl.net_profit), bold: true, border: true },
          ]}
        />
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Gross margin</p>
              <p className="text-lg font-semibold tabular-nums">{pnl.gross_margin_pct ?? 0}%</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Net margin</p>
              <p className="text-lg font-semibold tabular-nums">{pnl.net_margin_pct ?? 0}%</p>
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Cash inflows</p>
              <p className="text-lg font-semibold tabular-nums text-success">{money(cf?.inflows)}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Cash outflows</p>
              <p className="text-lg font-semibold tabular-nums text-destructive">{money(cf?.outflows)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-3">
            <span className="text-sm font-medium">Net cash change (MTD)</span>
            <span className="flex items-center gap-1 font-semibold tabular-nums">
              {(cf?.net_change ?? 0) >= 0 ? (
                <ArrowUpRight className="h-4 w-4 text-success" />
              ) : (
                <ArrowDownRight className="h-4 w-4 text-destructive" />
              )}
              {money(cf?.net_change)}
            </span>
          </div>
        </div>
      </div>
      <DashboardFinancialCharts currency={currency} pnl={pnl} cf={cf} />
    </ReportSection>
  );
}

export function DashboardSalesTrend({
  bundle,
  currency,
}: {
  bundle: DashboardBundle;
  currency: string;
}) {
  const chartData = (bundle.sales_trend_14d ?? []).map((row) => ({
    label: new Date(`${row.date}T12:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    value: Number(row.total),
  }));

  const total14 = chartData.reduce((s, d) => s + d.value, 0);

  return <SalesTrendChart data={chartData} total={total14} currency={currency} />;
}

export function DashboardRecentSales({
  bundle,
  currency,
}: {
  bundle: DashboardBundle;
  currency: string;
}) {
  const recentSales = bundle.recent_sales ?? [];

  const activity = recentSales.slice(0, 5).map((sale) => ({
    title: `Sale ${sale.receipt_no}`,
    meta: `${relationName(sale.stores)} · ${formatCurrency(sale.total, currency)}`,
    time: new Date(sale.created_at).toLocaleString(),
  }));

  return (
    <>
      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base font-semibold">Recent transactions</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sales">View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <DataTable className="rounded-none border-0 shadow-none">
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Receipt</DataTableHead>
                <DataTableHead>Store</DataTableHead>
                <DataTableHead align="right">Amount</DataTableHead>
                <DataTableHead>Status</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {recentSales.length === 0 ? (
                  <DataTableEmpty colSpan={4} message="No sales yet." />
                ) : (
                  recentSales.map((sale) => (
                    <DataTableRow key={sale.id}>
                      <DataTableCell>
                        <Link
                          href={`/sales/${sale.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {sale.receipt_no}
                        </Link>
                      </DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {relationName(sale.stores)}
                      </DataTableCell>
                      <DataTableCell align="right" className="font-mono font-medium tabular-nums">
                        {formatCurrency(sale.total, currency)}
                      </DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={sale.status} />
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </CardContent>
      </Card>

      {activity.length > 0 && (
        <Card className="mt-6 border-border">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Activity timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={activity} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

const FINANCE_SHORTCUTS: { href: string; label: string; icon: typeof Landmark; appId: ErpAppId }[] = [
  { href: "/financials", label: "Financial statements", icon: Landmark, appId: "accounting" },
  { href: "/reports", label: "Business reports", icon: Receipt, appId: "reports" },
  { href: "/invoicing", label: "Accounts receivable", icon: FileText, appId: "invoicing" },
  { href: "/purchasing", label: "Accounts payable", icon: ShoppingCart, appId: "purchasing" },
  { href: "/expenses", label: "Expense register", icon: CreditCard, appId: "expenses" },
];

export function DashboardSidebar({
  bundle,
  currency,
  accessibleApps,
}: {
  bundle: DashboardBundle;
  currency: string;
  accessibleApps: ErpAppId[];
}) {
  const appSet = new Set(accessibleApps);
  const canAccessExpenses = appSet.has("expenses");
  const financeShortcuts = FINANCE_SHORTCUTS.filter((s) => appSet.has(s.appId));

  const s = bundle.today_stats ?? {};
  const recentExpenses = bundle.recent_expenses ?? [];
  const productCount = bundle.product_count ?? 0;

  const paymentBreakdown = [
    { label: "Cash", value: Number(s.cash_total ?? 0), color: "bg-slate-700" },
    { label: "Mobile money", value: Number(s.mobile_total ?? 0), color: "bg-slate-500" },
    { label: "Bank transfer", value: Number(s.bank_total ?? 0), color: "bg-violet-500" },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Today&apos;s payment mix</CardTitle>
        </CardHeader>
        <CardContent>
          <MetricBarChart data={paymentBreakdown} />
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold">Recent expenses</CardTitle>
          {canAccessExpenses && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/expenses">All</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {!canAccessExpenses ? (
            <p className="text-sm text-muted-foreground">Expense details require access to the Expenses app.</p>
          ) : recentExpenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No expenses recorded yet.</p>
          ) : (
            recentExpenses.map((e, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.vendor_name || "Expense"}</p>
                  <p className="text-xs text-muted-foreground">{e.expense_date}</p>
                </div>
                <span className="shrink-0 font-mono font-medium tabular-nums">
                  {formatCurrency(Number(e.amount), currency)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Finance shortcuts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {financeShortcuts.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-4 w-4" />
                {label}
              </span>
              <span className="text-xs text-primary">Open →</span>
            </Link>
          ))}
          {financeShortcuts.length === 0 && (
            <p className="text-sm text-muted-foreground">No finance modules assigned to your role.</p>
          )}
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Package className="h-4 w-4" />
              Active products
            </div>
            <span className="font-semibold tabular-nums">{productCount}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

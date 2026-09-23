"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useFormatter, useTranslations } from "next-intl";
import type { ErpAppId } from "@/lib/app-permissions";
import { formatCurrency, relationName } from "@/lib/utils";
import { pctChange } from "@/lib/finance-dates";
import { StatCard } from "@/components/layout/stat-card";
import { StatusBadge } from "@/components/layout/status-badge";
import {
  MobileRecordCard,
  MobileRecordCardRow,
} from "@/components/layout/mobile-record-card";
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
  return <Skeleton className={className ?? "h-48 rounded-lg"} />;
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

/* ActivityTimeline kept for desktop-only optional use below */

export function DashboardKpis({
  bundle,
  currency,
  canAccessAccounting,
}: {
  bundle: DashboardBundle;
  currency: string;
  canAccessAccounting: boolean;
}) {
  const t = useTranslations("dashboard");
  const today = bundle.today_stats ?? {};

  if (!canAccessAccounting) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard
          label={t("salesToday")}
          value={formatCurrency(today.sales_total ?? 0, currency)}
          sub={t("transactionsCount", { count: today.transaction_count ?? 0 })}
          icon={TrendingUp}
        />
        <StatCard
          label={t("cashToday")}
          value={formatCurrency(today.cash_total ?? 0, currency)}
          icon={Banknote}
        />
        <StatCard
          label={t("mobileMoneyToday")}
          value={formatCurrency(today.mobile_total ?? 0, currency)}
          icon={Smartphone}
        />
        <StatCard
          label={t("bankToday")}
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
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard
          label={t("revenueTodayPos")}
          value={formatCurrency(today.sales_total ?? 0, currency)}
          sub={t("transactionsCount", { count: today.transaction_count ?? 0 })}
          icon={TrendingUp}
        />
        <StatCard
          label={t("netProfitMtd")}
          value={formatCurrency(pnl.net_profit ?? 0, currency)}
          sub={
            netChange != null
              ? t("vsLastMonth", { sign: netChange >= 0 ? "+" : "", pct: netChange })
              : t("monthToDate")
          }
          icon={Landmark}
          trend={
            netChange != null
              ? { value: `${netChange >= 0 ? "+" : ""}${netChange}%`, positive: netChange >= 0 }
              : undefined
          }
          highlight={(pnl.net_profit ?? 0) >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label={t("cashPosition")}
          value={formatCurrency(closingCash, currency)}
          sub={t("closingCashMtd")}
          icon={Wallet}
        />
        <StatCard
          label={t("receivablesPayables")}
          value={formatCurrency(arTotal, currency)}
          sub={t("apOutstanding", { amount: formatCurrency(apTotal, currency) })}
          icon={FileText}
        />
      </div>

      <details className="group rounded-lg border border-border bg-card open:pb-0">
        <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium text-muted-foreground marker:content-none hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-2">
            {t("moreTodayMetrics")}
            <ArrowDownRight className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="grid grid-cols-2 gap-2 border-t border-border p-2 sm:gap-3 xl:grid-cols-3 2xl:grid-cols-5">
          <StatCard
            label={t("cashToday")}
            value={formatCurrency(today.cash_total ?? 0, currency)}
            icon={Banknote}
          />
          <StatCard
            label={t("mobileMoneyToday")}
            value={formatCurrency(today.mobile_total ?? 0, currency)}
            icon={Smartphone}
          />
          <StatCard
            label={t("bankToday")}
            value={formatCurrency(today.bank_total ?? 0, currency)}
            icon={CreditCard}
          />
          <StatCard
            label={t("tipsToday")}
            value={formatCurrency(today.tips_total ?? 0, currency)}
            sub={t("tipsSub")}
            icon={ArrowUpRight}
          />
          <StatCard
            label={t("ledgerRevenueMtd")}
            value={formatCurrency(pnl.revenue ?? 0, currency)}
            sub={t("ledgerRevenueSub")}
            icon={ArrowUpRight}
            className="col-span-2 xl:col-span-1"
          />
        </div>
      </details>
    </div>
  );
}

export function DashboardFinancialPanel({
  bundle,
  currency,
}: {
  bundle: DashboardBundle;
  currency: string;
}) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const pnl = bundle.mtd_pnl ?? {};
  const cf = bundle.mtd_cash_flow ?? {};
  const mtdFrom = bundle.mtd_from ?? "";
  const mtdTo = bundle.mtd_to ?? "";
  const money = (n: number | undefined) => formatCurrency(n ?? 0, currency);

  return (
    <ReportSection
      title={t("financialPerformance")}
      subtitle={t("mtdRange", { from: mtdFrom, to: mtdTo })}
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link
            href={`/financials?pnl=gl&from=${encodeURIComponent(mtdFrom)}&to=${encodeURIComponent(mtdTo)}`}
          >
            {t("viewStatements")}
          </Link>
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <StatementTable
          rows={[
            { label: tc("revenue"), value: money(pnl.revenue), bold: true },
            { label: t("costOfGoodsSold"), value: `(${money(pnl.cogs)})`, indent: true },
            { label: tc("grossProfit"), value: money(pnl.gross_profit), bold: true, border: true },
            {
              label: tc("operatingExpenses"),
              value: `(${money(pnl.operating_expenses)})`,
              indent: true,
            },
            { label: tc("netProfit"), value: money(pnl.net_profit), bold: true, border: true },
          ]}
        />
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t("grossMargin")}</p>
              <p className="text-lg font-semibold tabular-nums">{pnl.gross_margin_pct ?? 0}%</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t("netMargin")}</p>
              <p className="text-lg font-semibold tabular-nums">{pnl.net_margin_pct ?? 0}%</p>
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{t("cashInflows")}</p>
              <p className="text-lg font-semibold tabular-nums text-success">{money(cf?.inflows)}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{t("cashOutflows")}</p>
              <p className="text-lg font-semibold tabular-nums text-destructive">{money(cf?.outflows)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-3">
            <span className="text-sm font-medium">{t("netCashChangeMtd")}</span>
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
  const format = useFormatter();

  const chartData = (bundle.sales_trend_14d ?? []).map((row) => ({
    // Anchored to UTC noon so the label is identical on the server and the client.
    label: format.dateTime(new Date(`${row.date}T12:00:00Z`), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
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
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const format = useFormatter();
  const recentSales = bundle.recent_sales ?? [];

  const activity = recentSales.slice(0, 5).map((sale) => ({
    title: t("saleWithReceipt", { receipt: sale.receipt_no }),
    meta: `${relationName(sale.stores)} · ${formatCurrency(sale.total, currency)}`,
    time: format.dateTime(new Date(sale.created_at), {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  }));

  return (
    <>
      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold">{t("recentTransactions")}</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sales">{t("viewAll")}</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <div className="space-y-2 px-3 pb-2 lg:hidden">
            {recentSales.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">{t("noRecentSales")}</p>
            ) : (
              recentSales.map((sale) => (
                <Link key={sale.id} href={`/sales/${sale.id}`} className="block">
                  <MobileRecordCard>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{sale.receipt_no}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {relationName(sale.stores)}
                        </p>
                      </div>
                      <StatusBadge status={sale.status} />
                    </div>
                    <MobileRecordCardRow className="mt-2">
                      <span className="font-mono tabular-nums">
                        {formatCurrency(sale.total, currency)}
                      </span>
                    </MobileRecordCardRow>
                  </MobileRecordCard>
                </Link>
              ))
            )}
          </div>
          <div className="hidden lg:block">
            <DataTable className="rounded-none border-0 shadow-none">
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>{tc("receipt")}</DataTableHead>
                  <DataTableHead>{tc("store")}</DataTableHead>
                  <DataTableHead align="right">{tc("amount")}</DataTableHead>
                  <DataTableHead>{tc("status")}</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {recentSales.length === 0 ? (
                    <DataTableEmpty colSpan={4} message={t("noRecentSales")} />
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
          </div>
        </CardContent>
      </Card>

      {activity.length > 0 && (
        <Card className="mt-3 hidden border-border lg:block lg:mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t("activityTimeline")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={activity} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

const FINANCE_SHORTCUTS: {
  href: string;
  labelKey: string;
  icon: typeof Landmark;
  appId: ErpAppId;
}[] = [
  {
    href: "/financials",
    labelKey: "shortcuts.financialStatements",
    icon: Landmark,
    appId: "accounting",
  },
  { href: "/reports", labelKey: "shortcuts.businessReports", icon: Receipt, appId: "reports" },
  {
    href: "/invoicing",
    labelKey: "shortcuts.accountsReceivable",
    icon: FileText,
    appId: "invoicing",
  },
  {
    href: "/purchasing",
    labelKey: "shortcuts.accountsPayable",
    icon: ShoppingCart,
    appId: "purchasing",
  },
  { href: "/expenses", labelKey: "shortcuts.expenseRegister", icon: CreditCard, appId: "expenses" },
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
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const tp = useTranslations("pos");

  const appSet = new Set(accessibleApps);
  const canAccessExpenses = appSet.has("expenses");
  const financeShortcuts = FINANCE_SHORTCUTS.filter((s) => appSet.has(s.appId));

  const s = bundle.today_stats ?? {};
  const recentExpenses = bundle.recent_expenses ?? [];
  const productCount = bundle.product_count ?? 0;

  const paymentBreakdown = [
    { label: tp("cash"), value: Number(s.cash_total ?? 0), color: "bg-slate-700" },
    { label: tp("mobileMoney"), value: Number(s.mobile_total ?? 0), color: "bg-slate-500" },
    { label: tp("bankTransfer"), value: Number(s.bank_total ?? 0), color: "bg-violet-500" },
  ];

  return (
    <div className="space-y-3 sm:space-y-4">
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t("todaysPaymentMix")}</CardTitle>
        </CardHeader>
        <CardContent>
          <MetricBarChart data={paymentBreakdown} />
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-semibold">{t("recentExpenses")}</CardTitle>
          {canAccessExpenses && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/expenses">{tc("all")}</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-1.5">
          {!canAccessExpenses ? (
            <p className="text-sm text-muted-foreground">{t("expensesNoAccess")}</p>
          ) : recentExpenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noExpensesYet")}</p>
          ) : (
            recentExpenses.map((e, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-1.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.vendor_name || t("expense")}</p>
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
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t("financeShortcuts")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {financeShortcuts.map(({ href, labelKey, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-sm transition-colors hover:bg-muted/40"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-4 w-4" />
                {t(labelKey)}
              </span>
              <span className="text-xs text-primary">{t("openLink")}</span>
            </Link>
          ))}
          {financeShortcuts.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("noFinanceModules")}</p>
          )}
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Package className="h-4 w-4" />
              {t("activeProducts")}
            </div>
            <span className="font-semibold tabular-nums">{productCount}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatCurrency, cn } from "@/lib/utils";
import { DateRangeToolbar } from "@/components/finance/date-range-toolbar";
import { ChartCard, FinanceDonutChart, TrendAreaChart } from "@/components/charts/finance-charts-lazy";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { StatusBadge } from "@/components/layout/status-badge";
import { ExportCsvButton } from "@/components/finance/export-csv-button";
import { ReportSection } from "@/components/finance/report-section";
import { TableToolbar, TablePagination } from "@/components/layout/table-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SalesActions } from "./sales-actions";
import { SalesAlertsBanner } from "@/components/sales/sales-alerts-banner";
import { SalesAnalyticsPanel } from "@/components/sales/sales-analytics-panel";
import { DailySalesSummaryPrint } from "@/components/sales/daily-sales-summary";
import {
  buildSalesSearchParams,
  discountPct,
  paymentMixLabel,
  PAYMENT_METHODS,
  SALES_VIEW_PRESETS,
  type SalesAnalytics,
  type SalesRegisterListResult,
  type SalesRegisterRow,
} from "@/lib/sales-register";
import { createClient } from "@/lib/supabase/client";
import { Banknote, BarChart3, Receipt, ShoppingCart, TrendingUp } from "lucide-react";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { useTranslations } from "next-intl";
import { DEFAULT_ORG_TIMEZONE, formatOrgDateTime, utcDayRangeForCalendarDate } from "@/lib/finance-dates";

type FilterState = {
  from: string;
  to: string;
  page: number;
  status: string;
  storeId?: string;
  registerId?: string;
  staffId?: string;
  paymentMethod: string;
  paymentStatus: string;
  search?: string;
  view?: string;
};

export function SalesClient({
  currency,
  canManage,
  orgName,
  organizationId,
  registerData,
  analytics,
  filters,
  pageSize,
  stores,
  registers,
  staff,
  timeZone = DEFAULT_ORG_TIMEZONE,
}: {
  currency: string;
  canManage: boolean;
  orgName: string;
  organizationId: string;
  registerData: SalesRegisterListResult;
  analytics: SalesAnalytics;
  filters: FilterState;
  pageSize: number;
  stores: { id: string; name: string }[];
  registers: { id: string; name: string; storeId: string }[];
  staff: { id: string; name: string }[];
  timeZone?: string;
}) {
  const t = useTranslations("sales");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tab, setTab] = useState<"register" | "analytics">("register");

  const rows = registerData.rows ?? [];
  const summary = registerData.summary ?? {
    count: 0,
    gross: 0,
    tax: 0,
    discounts: 0,
    tips: 0,
    voided: 0,
    returned: 0,
  };
  const total = registerData.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const money = (n: number) => formatCurrency(n, currency);

  const filtersActive =
    filters.status !== "all" ||
    Boolean(filters.storeId) ||
    Boolean(filters.registerId) ||
    Boolean(filters.staffId) ||
    filters.paymentMethod !== "all" ||
    filters.paymentStatus !== "all" ||
    Boolean(filters.view);

  const filteredRegisters = useMemo(
    () => (filters.storeId ? registers.filter((r) => r.storeId === filters.storeId) : registers),
    [registers, filters.storeId]
  );

  const dailyTrend = useMemo(
    () =>
      analytics.daily_trend.slice(-14).map((d) => ({
        label: new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: Number(d.revenue),
      })),
    [analytics.daily_trend]
  );

  function pushFilters(updates: Record<string, string | undefined>) {
    const params = buildSalesSearchParams(
      new URLSearchParams({
        from: filters.from,
        to: filters.to,
        ...(filters.status !== "all" ? { status: filters.status } : {}),
        ...(filters.storeId ? { store: filters.storeId } : {}),
        ...(filters.registerId ? { register: filters.registerId } : {}),
        ...(filters.staffId ? { staff: filters.staffId } : {}),
        ...(filters.paymentMethod !== "all" ? { method: filters.paymentMethod } : {}),
        ...(filters.paymentStatus !== "all" ? { payStatus: filters.paymentStatus } : {}),
        ...(filters.search ? { q: filters.search } : {}),
        ...(filters.view ? { view: filters.view } : {}),
        ...(filters.page > 1 ? { page: String(filters.page) } : {}),
      }),
      updates
    );
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function applySearch() {
    pushFilters({ q: searchInput.trim() || undefined, page: undefined });
  }

  return (
    <div className={cn(PAGE_SHELL, isPending && "opacity-70 transition-opacity")}>
      <PageHeader
        breadcrumb={t("title")}
        title={t("registerTitle")}
        description={t("description")}
      />

      <DateRangeToolbar from={filters.from} to={filters.to} timeZone={timeZone} />

      <div className="flex flex-wrap gap-2">
        {SALES_VIEW_PRESETS.map((preset) => {
          const active = filters.view === preset.key;
          return (
            <Button
              key={preset.key}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              className="h-8"
              onClick={() =>
                pushFilters({
                  view: active ? undefined : preset.key,
                  status: preset.status,
                  payStatus:
                    "paymentStatus" in preset && preset.paymentStatus
                      ? preset.paymentStatus
                      : undefined,
                  page: undefined,
                })
              }
            >
              {preset.label}
            </Button>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant={tab === "analytics" ? "default" : "outline"}
          className="ml-auto h-8 gap-1.5"
          onClick={() => setTab(tab === "analytics" ? "register" : "analytics")}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {tab === "analytics" ? t("showRegister") : t("analytics")}
        </Button>
      </div>

      <SalesAlertsBanner alerts={analytics.alerts ?? []} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label={t("completedSales")} value={summary.count} icon={ShoppingCart} />
        <StatCard label={t("grossRevenue")} value={money(summary.gross)} icon={TrendingUp} />
        <StatCard label={t("taxCollected")} value={money(summary.tax)} icon={Receipt} />
        <StatCard
          label={t("averageTicket")}
          value={money(summary.count > 0 ? summary.gross / summary.count : 0)}
          icon={Banknote}
        />
      </div>

      {tab === "analytics" ? (
        <div>
          <SalesAnalyticsPanel analytics={analytics} currency={currency} />
        </div>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
            <ChartCard title={t("salesTrend")} subtitle={t("dailyCompleted")}>
              {dailyTrend.length > 0 ? (
                <TrendAreaChart data={dailyTrend} formatValue={money} height={220} />
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">{tCommon("noResults")}</p>
              )}
            </ChartCard>
            <ChartCard title={t("revenueByStore")} subtitle={t("completedSales")}>
              {analytics.by_store.length > 0 ? (
                <FinanceDonutChart data={analytics.by_store} formatValue={money} />
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">{tCommon("noResults")}</p>
              )}
            </ChartCard>
          </div>

          <ReportSection
            className="mt-6"
            title={t("transactions")}
            subtitle={t("recordsPage", {
              total,
              page: filters.page,
              pages: totalPages,
            })}
            actions={
              <div className="flex flex-wrap gap-2">
                <DailySalesSummaryPrint
                  from={filters.from}
                  to={filters.to}
                  orgName={orgName}
                  currency={currency}
                  summary={summary}
                  byStore={analytics.by_store}
                />
                <ExportCsvButton
                  filename="sales-register"
                  label={t("exportSales")}
                  rows={rows.map((s) => ({
                    receipt_no: s.receipt_no,
                    date: formatOrgDateTime(s.created_at, timeZone),
                    store: s.store_name ?? "",
                    customer: s.customer_name ?? s.customer_phone ?? "",
                    cashier: s.staff_name ?? "",
                    register: s.register_name ?? "",
                    status: s.status,
                    subtotal: s.subtotal,
                    tax: s.tax_amount,
                    discount: s.discount_amount,
                    tip: s.tip_amount,
                    total: s.total,
                    payments: paymentMixLabel(s.payments),
                  }))}
                  columns={[
                    { key: "receipt_no", label: t("receipt") },
                    { key: "date", label: tCommon("date") },
                    { key: "store", label: tCommon("store") },
                    { key: "customer", label: t("customer") },
                    { key: "cashier", label: t("cashier") },
                    { key: "register", label: t("register") },
                    { key: "status", label: tCommon("status") },
                    { key: "subtotal", label: tCommon("subtotal") },
                    { key: "tax", label: tCommon("tax") },
                    { key: "discount", label: tCommon("discount") },
                    { key: "tip", label: tCommon("tip") },
                    { key: "total", label: tCommon("total") },
                    { key: "payments", label: t("payments") },
                  ]}
                />
                <ExportCsvButton
                  filename="sales-line-items"
                  label={t("exportLines")}
                  loadRows={async () => {
                    const supabase = createClient();
                    const fromIso = utcDayRangeForCalendarDate(filters.from, timeZone).from;
                    const toIso = utcDayRangeForCalendarDate(filters.to, timeZone).to;
                    const { data: lineExportSales } = await supabase
                      .from("sales")
                      .select(
                        `receipt_no, created_at, status, total, tip_amount, stores(name),
                         sale_lines(product_name, variant_name, quantity, unit_price, discount_amount, line_total)`
                      )
                      .eq("organization_id", organizationId)
                      .gte("created_at", fromIso)
                      .lte("created_at", toIso)
                      .order("created_at", { ascending: false })
                      .limit(500);
                    const rows: Record<string, unknown>[] = [];
                    for (const sale of lineExportSales ?? []) {
                      const storeRaw = sale.stores as
                        | { name: string }
                        | { name: string }[]
                        | null;
                      const store = Array.isArray(storeRaw)
                        ? storeRaw[0]?.name
                        : storeRaw?.name;
                      for (const line of (sale.sale_lines as Record<string, unknown>[]) ?? []) {
                        rows.push({
                          receipt_no: sale.receipt_no,
                          date: formatOrgDateTime(sale.created_at as string, timeZone),
                          store: store ?? "",
                          status: sale.status,
                          product: line.product_name,
                          variant: line.variant_name ?? "",
                          quantity: line.quantity,
                          unit_price: line.unit_price,
                          discount: line.discount_amount,
                          line_total: line.line_total,
                          sale_tip: (sale as { tip_amount?: number }).tip_amount ?? 0,
                          sale_total: sale.total,
                        });
                      }
                    }
                    return rows;
                  }}
                  columns={[
                    { key: "receipt_no", label: t("receipt") },
                    { key: "date", label: tCommon("date") },
                    { key: "store", label: tCommon("store") },
                    { key: "status", label: tCommon("status") },
                    { key: "product", label: t("product") },
                    { key: "variant", label: t("variant") },
                    { key: "quantity", label: t("qty") },
                    { key: "unit_price", label: t("unitPrice") },
                    { key: "discount", label: tCommon("discount") },
                    { key: "line_total", label: t("lineTotal") },
                    { key: "sale_tip", label: t("saleTip") },
                    { key: "sale_total", label: t("saleTotal") },
                  ]}
                />
              </div>
            }
          >
            <div className="mb-3">
              <TableToolbar
                search={searchInput}
                onSearchChange={setSearchInput}
                onSearchSubmit={applySearch}
                placeholder={t("searchPlaceholder")}
                filterOpen={filtersOpen}
                onFilterOpenChange={setFiltersOpen}
                filterActive={filtersActive}
                filterContent={
                  <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <select
                        className={cn(SELECT_CLS, "h-9 w-full")}
                        value={filters.status}
                        onChange={(e) => pushFilters({ status: e.target.value, view: undefined, page: undefined })}
                      >
                        <option value="all">All</option>
                        <option value="completed">Completed</option>
                        <option value="voided">Voided</option>
                        <option value="returned">Returned</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Store</Label>
                      <select
                        className={cn(SELECT_CLS, "h-9 w-full")}
                        value={filters.storeId ?? ""}
                        onChange={(e) =>
                          pushFilters({
                            store: e.target.value || undefined,
                            register: undefined,
                            page: undefined,
                          })
                        }
                      >
                        <option value="">All stores</option>
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Register</Label>
                      <select
                        className={cn(SELECT_CLS, "h-9 w-full")}
                        value={filters.registerId ?? ""}
                        onChange={(e) => pushFilters({ register: e.target.value || undefined, page: undefined })}
                      >
                        <option value="">All registers</option>
                        {filteredRegisters.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Cashier</Label>
                      <select
                        className={cn(SELECT_CLS, "h-9 w-full")}
                        value={filters.staffId ?? ""}
                        onChange={(e) => pushFilters({ staff: e.target.value || undefined, page: undefined })}
                      >
                        <option value="">All staff</option>
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Payment method</Label>
                      <select
                        className={cn(SELECT_CLS, "h-9 w-full")}
                        value={filters.paymentMethod}
                        onChange={(e) => pushFilters({ method: e.target.value, page: undefined })}
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Payment status</Label>
                      <select
                        className={cn(SELECT_CLS, "h-9 w-full")}
                        value={filters.paymentStatus}
                        onChange={(e) =>
                          pushFilters({ payStatus: e.target.value, view: undefined, page: undefined })
                        }
                      >
                        <option value="all">All</option>
                        <option value="completed">Confirmed</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>
                    {filtersActive && (
                      <div className="flex items-end sm:col-span-2 lg:col-span-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            pushFilters({
                              status: undefined,
                              store: undefined,
                              register: undefined,
                              staff: undefined,
                              method: undefined,
                              payStatus: undefined,
                              view: undefined,
                              q: undefined,
                              page: undefined,
                            })
                          }
                        >
                          Clear filters
                        </Button>
                      </div>
                    )}
                  </div>
                }
              />
            </div>

            {/* Mobile card list */}
            <div className="space-y-3 lg:hidden">
              {rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No sales match your filters.</p>
              ) : (
                rows.map((s: SalesRegisterRow) => (
                  <MobileRecordCard key={s.id}>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <Link href={`/sales/${s.id}`} className="font-semibold text-primary hover:underline">
                        {s.receipt_no}
                        {s.has_pending_payment && (
                          <span className="ml-1.5 text-[10px] font-semibold text-amber-600">PENDING</span>
                        )}
                      </Link>
                      <StatusBadge status={s.status} />
                    </div>
                    <div className="space-y-1.5">
                      <MobileRecordCardRow label={tCommon("total")}>{money(s.total)}</MobileRecordCardRow>
                      {Number(s.tip_amount) > 0 && (
                        <MobileRecordCardRow label={tCommon("tip")}>{money(Number(s.tip_amount))}</MobileRecordCardRow>
                      )}
                      <MobileRecordCardRow label={tCommon("store")}>{s.store_name ?? "—"}</MobileRecordCardRow>
                      <MobileRecordCardRow label={tCommon("date")}>
                        {formatOrgDateTime(s.created_at, timeZone)}
                      </MobileRecordCardRow>
                      {(s.customer_name || s.customer_phone) && (
                        <MobileRecordCardRow label={t("customer")}>
                          {s.customer_name ?? s.customer_phone}
                        </MobileRecordCardRow>
                      )}
                    </div>
                    {canManage && s.status === "completed" && (
                      <div className="mt-3 flex justify-end border-t border-border pt-3">
                        <SalesActions saleId={s.id} />
                      </div>
                    )}
                  </MobileRecordCard>
                ))
              )}
            </div>

            <div className="hidden lg:block">
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>{t("receipt")}</DataTableHead>
                  <DataTableHead hideBelow="md">{tCommon("store")}</DataTableHead>
                  <DataTableHead hideBelow="lg">{t("customer")}</DataTableHead>
                  <DataTableHead hideBelow="xl">{t("cashier")}</DataTableHead>
                  <DataTableHead hideBelow="xl">{t("payments")}</DataTableHead>
                  <DataTableHead align="right" hideBelow="lg">{tCommon("discount")} %</DataTableHead>
                  <DataTableHead align="right" hideBelow="lg">{tCommon("tip")}</DataTableHead>
                  <DataTableHead align="right">{tCommon("total")}</DataTableHead>
                  <DataTableHead>{tCommon("status")}</DataTableHead>
                  <DataTableHead hideBelow="md">{tCommon("date")}</DataTableHead>
                  {canManage && <DataTableHead align="right">{tCommon("actions")}</DataTableHead>}
                </DataTableHeader>
                <DataTableBody>
                  {rows.length === 0 ? (
                    <DataTableEmpty colSpan={canManage ? 10 : 9} message="No sales match your filters." />
                  ) : (
                    rows.map((s: SalesRegisterRow) => (
                      <DataTableRow key={s.id}>
                        <DataTableCell>
                          <Link href={`/sales/${s.id}`} className="font-medium text-primary hover:underline">
                            {s.receipt_no}
                            {s.has_pending_payment && (
                              <span className="ml-1.5 text-[10px] font-semibold text-amber-600">PENDING</span>
                            )}
                          </Link>
                        </DataTableCell>
                        <DataTableCell hideBelow="md" className="text-muted-foreground">{s.store_name ?? "—"}</DataTableCell>
                        <DataTableCell hideBelow="lg" className="max-w-[120px] truncate text-muted-foreground">
                          {s.customer_id ? (
                            <Link href={`/customers?highlight=${s.customer_id}`} className="hover:text-primary">
                              {s.customer_name ?? s.customer_phone ?? "Customer"}
                            </Link>
                          ) : (
                            s.customer_name ?? s.customer_phone ?? "—"
                          )}
                        </DataTableCell>
                        <DataTableCell hideBelow="xl" className="text-muted-foreground">{s.staff_name ?? "—"}</DataTableCell>
                        <DataTableCell hideBelow="xl" className="max-w-[140px] truncate text-xs text-muted-foreground">
                          {paymentMixLabel(s.payments)}
                        </DataTableCell>
                        <DataTableCell hideBelow="lg" align="right" className="font-mono text-muted-foreground">
                          {s.discount_amount > 0 ? `${discountPct(s)}%` : "—"}
                        </DataTableCell>
                        <DataTableCell hideBelow="lg" align="right" className="font-mono text-muted-foreground">
                          {Number(s.tip_amount) > 0 ? money(Number(s.tip_amount)) : "—"}
                        </DataTableCell>
                        <DataTableCell align="right" className="font-mono font-medium">
                          {money(s.total)}
                        </DataTableCell>
                        <DataTableCell>
                          <StatusBadge status={s.status} />
                        </DataTableCell>
                        <DataTableCell hideBelow="md" className="text-muted-foreground">
                          {formatOrgDateTime(s.created_at, timeZone)}
                        </DataTableCell>
                        {canManage && (
                          <DataTableCell align="right">
                            {s.status === "completed" && <SalesActions saleId={s.id} />}
                          </DataTableCell>
                        )}
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>
            </div>

            <div className="mt-4">
              <TablePagination
                page={filters.page}
                totalPages={totalPages}
                total={total}
                onPageChange={(p) => pushFilters({ page: p > 1 ? String(p) : undefined })}
              />
            </div>
          </ReportSection>
        </>
      )}
    </div>
  );
}

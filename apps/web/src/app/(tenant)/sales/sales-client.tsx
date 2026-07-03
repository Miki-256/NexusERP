"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatCurrency, cn } from "@/lib/utils";
import { DateRangeToolbar } from "@/components/finance/date-range-toolbar";
import { ChartCard, FinanceDonutChart, TrendAreaChart } from "@/components/charts/finance-charts";
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
import { Banknote, BarChart3, Receipt, ShoppingCart, TrendingUp } from "lucide-react";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";

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
  registerData,
  analytics,
  lineExportRows,
  filters,
  pageSize,
  stores,
  registers,
  staff,
}: {
  currency: string;
  canManage: boolean;
  orgName: string;
  registerData: SalesRegisterListResult;
  analytics: SalesAnalytics;
  lineExportRows: Record<string, unknown>[];
  filters: FilterState;
  pageSize: number;
  stores: { id: string; name: string }[];
  registers: { id: string; name: string; storeId: string }[];
  staff: { id: string; name: string }[];
}) {
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
        breadcrumb="Revenue"
        title="Sales Register"
        description="Complete transaction history with filters, analytics, returns, and exports."
      />

      <DateRangeToolbar from={filters.from} to={filters.to} className="mb-4" />

      <div className="mb-4 flex flex-wrap gap-2">
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
          {tab === "analytics" ? "Show register" : "Analytics"}
        </Button>
      </div>

      <SalesAlertsBanner alerts={analytics.alerts ?? []} />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Completed sales" value={summary.count} icon={ShoppingCart} />
        <StatCard label="Gross revenue" value={money(summary.gross)} icon={TrendingUp} />
        <StatCard label="Tax collected" value={money(summary.tax)} icon={Receipt} />
        <StatCard
          label="Average ticket"
          value={money(summary.count > 0 ? summary.gross / summary.count : 0)}
          icon={Banknote}
        />
      </div>

      {tab === "analytics" ? (
        <div className="mt-6">
          <SalesAnalyticsPanel analytics={analytics} currency={currency} />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <ChartCard title="Sales trend" subtitle="Daily completed sales">
              {dailyTrend.length > 0 ? (
                <TrendAreaChart data={dailyTrend} formatValue={money} height={220} />
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">No completed sales in range.</p>
              )}
            </ChartCard>
            <ChartCard title="Revenue by store" subtitle="Completed sales">
              {analytics.by_store.length > 0 ? (
                <FinanceDonutChart data={analytics.by_store} formatValue={money} />
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">No store breakdown.</p>
              )}
            </ChartCard>
          </div>

          <ReportSection
            className="mt-6"
            title="Transactions"
            subtitle={`${total} records · page ${filters.page} of ${totalPages}`}
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
                  label="Export sales"
                  rows={rows.map((s) => ({
                    receipt_no: s.receipt_no,
                    date: new Date(s.created_at).toLocaleString(),
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
                    { key: "receipt_no", label: "Receipt" },
                    { key: "date", label: "Date" },
                    { key: "store", label: "Store" },
                    { key: "customer", label: "Customer" },
                    { key: "cashier", label: "Cashier" },
                    { key: "register", label: "Register" },
                    { key: "status", label: "Status" },
                    { key: "subtotal", label: "Subtotal" },
                    { key: "tax", label: "Tax" },
                    { key: "discount", label: "Discount" },
                    { key: "tip", label: "Tip" },
                    { key: "total", label: "Total" },
                    { key: "payments", label: "Payments" },
                  ]}
                />
                <ExportCsvButton
                  filename="sales-line-items"
                  label="Export lines"
                  rows={lineExportRows}
                  columns={[
                    { key: "receipt_no", label: "Receipt" },
                    { key: "date", label: "Date" },
                    { key: "store", label: "Store" },
                    { key: "status", label: "Status" },
                    { key: "product", label: "Product" },
                    { key: "variant", label: "Variant" },
                    { key: "quantity", label: "Qty" },
                    { key: "unit_price", label: "Unit price" },
                    { key: "discount", label: "Discount" },
                    { key: "line_total", label: "Line total" },
                  ]}
                />
              </div>
            }
          >
            <div className="mb-4">
              <TableToolbar
                search={searchInput}
                onSearchChange={setSearchInput}
                onSearchSubmit={applySearch}
                placeholder="Search receipt, customer, store…"
                filterOpen={filtersOpen}
                onFilterOpenChange={setFiltersOpen}
                filterActive={filtersActive}
                filterContent={
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                      <MobileRecordCardRow label="Total">{money(s.total)}</MobileRecordCardRow>
                      <MobileRecordCardRow label="Store">{s.store_name ?? "—"}</MobileRecordCardRow>
                      <MobileRecordCardRow label="Date">
                        {new Date(s.created_at).toLocaleString()}
                      </MobileRecordCardRow>
                      {(s.customer_name || s.customer_phone) && (
                        <MobileRecordCardRow label="Customer">
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
                  <DataTableHead>Receipt</DataTableHead>
                  <DataTableHead hideBelow="md">Store</DataTableHead>
                  <DataTableHead hideBelow="lg">Customer</DataTableHead>
                  <DataTableHead hideBelow="xl">Cashier</DataTableHead>
                  <DataTableHead hideBelow="xl">Payments</DataTableHead>
                  <DataTableHead align="right" hideBelow="lg">Disc %</DataTableHead>
                  <DataTableHead align="right">Total</DataTableHead>
                  <DataTableHead>Status</DataTableHead>
                  <DataTableHead hideBelow="md">Date</DataTableHead>
                  {canManage && <DataTableHead align="right">Actions</DataTableHead>}
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
                        <DataTableCell align="right" className="font-mono font-medium">
                          {money(s.total)}
                        </DataTableCell>
                        <DataTableCell>
                          <StatusBadge status={s.status} />
                        </DataTableCell>
                        <DataTableCell hideBelow="md" className="text-muted-foreground">
                          {new Date(s.created_at).toLocaleString()}
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

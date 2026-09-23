"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatCurrency, relationName, cn } from "@/lib/utils";
import { formatPeriod } from "@/lib/finance-dates";
import { ExportCsvButton } from "@/components/finance/export-csv-button";
import { ReportSection } from "@/components/finance/report-section";
import { StatusBadge } from "@/components/layout/status-badge";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SELECT_CLS } from "@/lib/ui-classes";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { localeToBcp47, type AppLocale } from "@/i18n/config";

export type SaleLineRow = {
  id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  tax_amount: number;
  discount_amount: number;
  line_total: number;
};

function lineExTax(line: SaleLineRow): number {
  const tax = Number(line.tax_amount ?? 0);
  if (tax > 0) return Math.round((Number(line.line_total) - tax) * 100) / 100;
  return Math.round(
    (Number(line.unit_price) * Number(line.quantity) - Number(line.discount_amount ?? 0)) * 100
  ) / 100;
}

export type PaymentRow = {
  id: string;
  method: string;
  amount: number;
  reference: string | null;
  provider: string | null;
  phone: string | null;
  bank_name: string | null;
  cash_tendered: number | null;
  change_given: number | null;
  created_at: string;
};

export type TransactionRow = {
  id: string;
  receipt_no: string;
  total: number;
  status: string;
  created_at: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  tip_amount?: number;
  customer_name: string | null;
  customer_phone: string | null;
  stores: { name: string } | { name: string }[] | null;
  registers: { name: string } | { name: string }[] | null;
  pos_staff: { display_name: string } | { display_name: string }[] | null;
  sale_lines: SaleLineRow[];
  payments: PaymentRow[];
};

const PAGE_SIZE = 20;

function staffName(row: TransactionRow): string {
  const s = row.pos_staff;
  if (!s) return "—";
  if (Array.isArray(s)) return s[0]?.display_name ?? "—";
  return s.display_name;
}

function paymentLabel(p: PaymentRow): string {
  const method = p.method.replace(/_/g, " ");
  if (p.provider) return `${method} (${p.provider.replace(/_/g, " ")})`;
  if (p.bank_name) return `${method} · ${p.bank_name}`;
  return method;
}

export function TransactionsTab({
  currency,
  from,
  to,
  transactions,
}: {
  currency: string;
  from: string;
  to: string;
  transactions: TransactionRow[];
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const t = useTranslations("finance");
  const tCommon = useTranslations("common");
  const locale = useLocale() as AppLocale;

  const filtersActive = status !== "all";

  const money = (n: number) => formatCurrency(n, currency, localeToBcp47(locale));
  const period = formatPeriod(from, to);

  const filtered = useMemo(() => {
    return transactions.filter((txn) => {
      if (status !== "all" && txn.status !== status) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const store = relationName(txn.stores).toLowerCase();
      const register = relationName(txn.registers).toLowerCase();
      const customer = (txn.customer_name ?? "").toLowerCase();
      const phone = (txn.customer_phone ?? "").toLowerCase();
      const productHit = txn.sale_lines.some(
        (l) =>
          l.product_name.toLowerCase().includes(q) ||
          (l.variant_name ?? "").toLowerCase().includes(q)
      );
      return (
        (txn.receipt_no ?? "").toLowerCase().includes(q) ||
        store.includes(q) ||
        register.includes(q) ||
        customer.includes(q) ||
        phone.includes(q) ||
        productHit
      );
    });
  }, [transactions, search, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const lineExportRows = useMemo(
    () =>
      filtered.flatMap((txn) =>
        (txn.sale_lines.length ? txn.sale_lines : [null]).map((line) => ({
          receipt_no: txn.receipt_no,
          date: new Date(txn.created_at).toLocaleString(),
          store: relationName(txn.stores) || "",
          register: relationName(txn.registers) || "",
          cashier: staffName(txn),
          customer: txn.customer_name || "",
          customer_phone: txn.customer_phone || "",
          status: txn.status,
          product: line?.product_name ?? "",
          variant: line?.variant_name ?? "",
          quantity: line?.quantity ?? "",
          unit_price: line?.unit_price ?? "",
          line_discount: line?.discount_amount ?? "",
          line_tax: line?.tax_amount ?? "",
          line_total: line ? lineExTax(line) : "",
          sale_subtotal: txn.subtotal,
          sale_tax: txn.tax_amount,
          sale_discount: txn.discount_amount,
          sale_tip: txn.tip_amount ?? 0,
          sale_total: txn.total,
          payments: txn.payments.map((p) => `${p.method}:${p.amount}`).join("; "),
        }))
      ),
    [filtered]
  );

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ReportSection
      title={t("transactionDetail")}
      subtitle={t("transactionDetailSubtitle", { count: filtered.length, period })}
      actions={
        <ExportCsvButton
          label={tCommon("exportCsv")}
          filename={`transactions-detail-${from}-${to}`}
          rows={lineExportRows}
          columns={[
            { key: "receipt_no", label: "Receipt" },
            { key: "date", label: "Date" },
            { key: "store", label: "Store" },
            { key: "register", label: "Register" },
            { key: "cashier", label: "Cashier" },
            { key: "customer", label: "Customer" },
            { key: "customer_phone", label: "Phone" },
            { key: "status", label: "Status" },
            { key: "product", label: "Product" },
            { key: "variant", label: "Variant" },
            { key: "quantity", label: "Qty" },
            { key: "unit_price", label: "Unit Price" },
            { key: "line_discount", label: "Line Discount" },
            { key: "line_tax", label: "Line Tax" },
            { key: "line_total", label: "Line Total" },
            { key: "sale_subtotal", label: "Sale Subtotal" },
            { key: "sale_tax", label: "Sale Tax" },
            { key: "sale_discount", label: "Sale Discount" },
            { key: "sale_tip", label: "Sale Tip" },
            { key: "sale_total", label: "Sale Total" },
            { key: "payments", label: "Payments" },
          ]}
        />
      }
    >
      <div className="mb-4">
        <TableToolbar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={t("searchTxnPlaceholder")}
          filterOpen={filtersOpen}
          onFilterOpenChange={setFiltersOpen}
          filterActive={filtersActive}
          filterContent={
            <>
              <div className="space-y-2">
                <Label htmlFor="txn-status-filter">{tCommon("status")}</Label>
                <select
                  id="txn-status-filter"
                  className={cn(SELECT_CLS, "h-9 min-w-[160px]")}
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">{tCommon("allStatuses")}</option>
                  <option value="completed">{tCommon("statusCompleted")}</option>
                  <option value="voided">{tCommon("statusVoided")}</option>
                  <option value="returned">{tCommon("statusReturned")}</option>
                </select>
              </div>
              {filtersActive && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer"
                  onClick={() => {
                    setStatus("all");
                    setPage(1);
                  }}
                >
                  {tCommon("clearFilters")}
                </Button>
              )}
            </>
          }
        />
      </div>

      <div className="space-y-2">
        {paged.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            {t("noTxnMatch")}
          </div>
        ) : (
          paged.map((txn) => {
            const isOpen = expanded.has(txn.id);
            return (
              <div key={txn.id} className="overflow-hidden rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => toggleExpand(txn.id)}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                >
                  <span className="text-muted-foreground">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                    <div>
                      <p className="text-xs text-muted-foreground">{tCommon("receipt")}</p>
                      <p className="font-medium">{txn.receipt_no}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{tCommon("date")}</p>
                      <p className="text-sm">{new Date(txn.created_at).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("storeRegister")}</p>
                      <p className="truncate text-sm">
                        {relationName(txn.stores) || "—"}
                        {relationName(txn.registers) ? ` · ${relationName(txn.registers)}` : ""}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{tCommon("cashier")}</p>
                      <p className="text-sm">{staffName(txn)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{tCommon("customer")}</p>
                      <p className="truncate text-sm">{txn.customer_name || tCommon("walkIn")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{tCommon("tip")}</p>
                      <p className="font-mono text-sm">
                        {Number(txn.tip_amount) > 0 ? money(Number(txn.tip_amount)) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{tCommon("total")}</p>
                      <p className="font-mono font-semibold">{money(Number(txn.total))}</p>
                    </div>
                  </div>
                  <StatusBadge status={txn.status} />
                </button>

                {isOpen && (
                  <div className="border-t bg-muted/10 px-4 py-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-4 text-sm">
                        <span>
                          <span className="text-muted-foreground">{tCommon("subtotal")}: </span>
                          <span className="font-mono">{money(Number(txn.subtotal))}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">{tCommon("tax")}: </span>
                          <span className="font-mono">{money(Number(txn.tax_amount))}</span>
                        </span>
                        {Number(txn.discount_amount) > 0 && (
                          <span>
                            <span className="text-muted-foreground">{tCommon("discount")}: </span>
                            <span className="font-mono">({money(Number(txn.discount_amount))})</span>
                          </span>
                        )}
                        {Number(txn.tip_amount) > 0 && (
                          <span>
                            <span className="text-muted-foreground">{tCommon("tip")}: </span>
                            <span className="font-mono">{money(Number(txn.tip_amount))}</span>
                          </span>
                        )}
                        {txn.customer_phone && (
                          <span>
                            <span className="text-muted-foreground">{tCommon("phone")}: </span>
                            {txn.customer_phone}
                          </span>
                        )}
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/sales/${txn.id}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          {t("txnFlow.fullSale")}
                        </Link>
                      </Button>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {tCommon("products")} ({txn.sale_lines.length})
                        </p>
                        <DataTable>
                          <table className="w-full text-sm">
                            <DataTableHeader>
                              <DataTableHead>{tCommon("product")}</DataTableHead>
                              <DataTableHead align="right">{tCommon("qty")}</DataTableHead>
                              <DataTableHead align="right">{tCommon("unit")}</DataTableHead>
                              <DataTableHead align="right">{tCommon("discountShort")}</DataTableHead>
                              <DataTableHead align="right">{tCommon("total")}</DataTableHead>
                            </DataTableHeader>
                            <DataTableBody>
                              {txn.sale_lines.length === 0 ? (
                                <DataTableEmpty colSpan={5} message={t("noLineItems")} />
                              ) : (
                                txn.sale_lines.map((line) => (
                                  <DataTableRow key={line.id}>
                                    <DataTableCell>
                                      <p className="font-medium">{line.product_name}</p>
                                      {line.variant_name && line.variant_name !== "Default" && (
                                        <p className="text-xs text-muted-foreground">{line.variant_name}</p>
                                      )}
                                    </DataTableCell>
                                    <DataTableCell align="right" className="font-mono">
                                      {line.quantity}
                                    </DataTableCell>
                                    <DataTableCell align="right" className="font-mono">
                                      {money(Number(line.unit_price))}
                                    </DataTableCell>
                                    <DataTableCell align="right" className="font-mono text-muted-foreground">
                                      {Number(line.discount_amount) > 0
                                        ? money(Number(line.discount_amount))
                                        : "—"}
                                    </DataTableCell>
                                    <DataTableCell align="right" className="font-mono font-medium">
                                      {money(lineExTax(line))}
                                    </DataTableCell>
                                  </DataTableRow>
                                ))
                              )}
                            </DataTableBody>
                          </table>
                        </DataTable>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {tCommon("payments")} ({txn.payments.length})
                        </p>
                        <DataTable>
                          <table className="w-full text-sm">
                            <DataTableHeader>
                              <DataTableHead>{tCommon("method")}</DataTableHead>
                              <DataTableHead>{tCommon("reference")}</DataTableHead>
                              <DataTableHead align="right">{tCommon("amount")}</DataTableHead>
                            </DataTableHeader>
                            <DataTableBody>
                              {txn.payments.length === 0 ? (
                                <DataTableEmpty colSpan={3} message={t("noPaymentRecords")} />
                              ) : (
                                txn.payments.map((p) => (
                                  <DataTableRow key={p.id}>
                                    <DataTableCell>
                                      <p className="capitalize">{paymentLabel(p)}</p>
                                      {p.method === "cash" && p.cash_tendered != null && (
                                        <p className="text-xs text-muted-foreground">
                                          {t("tendered", { amount: money(Number(p.cash_tendered)) })}
                                          {p.change_given != null && Number(p.change_given) > 0
                                            ? ` · ${t("changeGiven", {
                                                amount: money(Number(p.change_given)),
                                              })}`
                                            : ""}
                                        </p>
                                      )}
                                      {p.phone && (
                                        <p className="text-xs text-muted-foreground">{p.phone}</p>
                                      )}
                                    </DataTableCell>
                                    <DataTableCell className="font-mono text-xs text-muted-foreground">
                                      {p.reference || "—"}
                                    </DataTableCell>
                                    <DataTableCell align="right" className="font-mono font-medium">
                                      {money(Number(p.amount))}
                                    </DataTableCell>
                                  </DataTableRow>
                                ))
                              )}
                            </DataTableBody>
                          </table>
                        </DataTable>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {filtered.length > 0 && (
        <div className={cn("mt-4")}>
          <TablePagination
            page={page}
            totalPages={totalPages}
            total={filtered.length}
            onPageChange={setPage}
          />
        </div>
      )}
    </ReportSection>
  );
}

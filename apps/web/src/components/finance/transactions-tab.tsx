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

  const filtersActive = status !== "all";

  const money = (n: number) => formatCurrency(n, currency);
  const period = formatPeriod(from, to);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const store = relationName(t.stores).toLowerCase();
      const register = relationName(t.registers).toLowerCase();
      const customer = (t.customer_name ?? "").toLowerCase();
      const phone = (t.customer_phone ?? "").toLowerCase();
      const productHit = t.sale_lines.some(
        (l) =>
          l.product_name.toLowerCase().includes(q) ||
          (l.variant_name ?? "").toLowerCase().includes(q)
      );
      return (
        (t.receipt_no ?? "").toLowerCase().includes(q) ||
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
      filtered.flatMap((t) =>
        (t.sale_lines.length ? t.sale_lines : [null]).map((line) => ({
          receipt_no: t.receipt_no,
          date: new Date(t.created_at).toLocaleString(),
          store: relationName(t.stores) || "",
          register: relationName(t.registers) || "",
          cashier: staffName(t),
          customer: t.customer_name || "",
          customer_phone: t.customer_phone || "",
          status: t.status,
          product: line?.product_name ?? "",
          variant: line?.variant_name ?? "",
          quantity: line?.quantity ?? "",
          unit_price: line?.unit_price ?? "",
          line_discount: line?.discount_amount ?? "",
          line_tax: line?.tax_amount ?? "",
          line_total: line?.line_total ?? "",
          sale_subtotal: t.subtotal,
          sale_tax: t.tax_amount,
          sale_discount: t.discount_amount,
          sale_total: t.total,
          payments: t.payments.map((p) => `${p.method}:${p.amount}`).join("; "),
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
      title="Transaction detail"
      subtitle={`${filtered.length} sales · line items & payments · ${period}`}
      actions={
        <ExportCsvButton
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
          placeholder="Search receipt, product, customer, store…"
          filterOpen={filtersOpen}
          onFilterOpenChange={setFiltersOpen}
          filterActive={filtersActive}
          filterContent={
            <>
              <div className="space-y-2">
                <Label htmlFor="txn-status-filter">Status</Label>
                <select
                  id="txn-status-filter"
                  className={cn(SELECT_CLS, "h-9 min-w-[160px]")}
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="completed">Completed</option>
                  <option value="voided">Voided</option>
                  <option value="returned">Returned</option>
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
                  Clear filters
                </Button>
              )}
            </>
          }
        />
      </div>

      <div className="space-y-2">
        {paged.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            No transactions match your filters.
          </div>
        ) : (
          paged.map((t) => {
            const isOpen = expanded.has(t.id);
            return (
              <div key={t.id} className="overflow-hidden rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => toggleExpand(t.id)}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                >
                  <span className="text-muted-foreground">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                    <div>
                      <p className="text-xs text-muted-foreground">Receipt</p>
                      <p className="font-medium">{t.receipt_no}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Date</p>
                      <p className="text-sm">{new Date(t.created_at).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Store / Register</p>
                      <p className="truncate text-sm">
                        {relationName(t.stores) || "—"}
                        {relationName(t.registers) ? ` · ${relationName(t.registers)}` : ""}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Cashier</p>
                      <p className="text-sm">{staffName(t)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Customer</p>
                      <p className="truncate text-sm">{t.customer_name || "Walk-in"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="font-mono font-semibold">{money(Number(t.total))}</p>
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </button>

                {isOpen && (
                  <div className="border-t bg-muted/10 px-4 py-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-4 text-sm">
                        <span>
                          <span className="text-muted-foreground">Subtotal: </span>
                          <span className="font-mono">{money(Number(t.subtotal))}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">Tax: </span>
                          <span className="font-mono">{money(Number(t.tax_amount))}</span>
                        </span>
                        {Number(t.discount_amount) > 0 && (
                          <span>
                            <span className="text-muted-foreground">Discount: </span>
                            <span className="font-mono">({money(Number(t.discount_amount))})</span>
                          </span>
                        )}
                        {t.customer_phone && (
                          <span>
                            <span className="text-muted-foreground">Phone: </span>
                            {t.customer_phone}
                          </span>
                        )}
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/sales/${t.id}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Full sale
                        </Link>
                      </Button>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Products ({t.sale_lines.length})
                        </p>
                        <DataTable>
                          <table className="w-full text-sm">
                            <DataTableHeader>
                              <DataTableHead>Product</DataTableHead>
                              <DataTableHead align="right">Qty</DataTableHead>
                              <DataTableHead align="right">Unit</DataTableHead>
                              <DataTableHead align="right">Disc.</DataTableHead>
                              <DataTableHead align="right">Total</DataTableHead>
                            </DataTableHeader>
                            <DataTableBody>
                              {t.sale_lines.length === 0 ? (
                                <DataTableEmpty colSpan={5} message="No line items." />
                              ) : (
                                t.sale_lines.map((line) => (
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
                                      {money(Number(line.line_total))}
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
                          Payments ({t.payments.length})
                        </p>
                        <DataTable>
                          <table className="w-full text-sm">
                            <DataTableHeader>
                              <DataTableHead>Method</DataTableHead>
                              <DataTableHead>Reference</DataTableHead>
                              <DataTableHead align="right">Amount</DataTableHead>
                            </DataTableHeader>
                            <DataTableBody>
                              {t.payments.length === 0 ? (
                                <DataTableEmpty colSpan={3} message="No payment records." />
                              ) : (
                                t.payments.map((p) => (
                                  <DataTableRow key={p.id}>
                                    <DataTableCell>
                                      <p className="capitalize">{paymentLabel(p)}</p>
                                      {p.method === "cash" && p.cash_tendered != null && (
                                        <p className="text-xs text-muted-foreground">
                                          Tendered {money(Number(p.cash_tendered))}
                                          {p.change_given != null && Number(p.change_given) > 0
                                            ? ` · Change ${money(Number(p.change_given))}`
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

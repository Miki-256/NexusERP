"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, relationName } from "@/lib/utils";
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
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { localeToBcp47, type AppLocale } from "@/i18n/config";
import { DEFAULT_ORG_TIMEZONE, formatOrgDateTimeFull } from "@/lib/finance-dates";

type SaleLine = {
  id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  tax_amount: number;
  discount_amount: number;
  line_total: number;
  uom_code?: string | null;
};

type Payment = {
  id: string;
  method: string;
  amount: number;
  status?: string;
};

type JeLine = {
  id: string;
  debit: number;
  credit: number;
  description: string | null;
  accounts?: { code: string; name: string } | { code: string; name: string }[] | null;
};

type JournalEntry = {
  id: string;
  entry_date: string;
  memo: string | null;
  journal_entry_lines: JeLine[];
};

type FlowSale = {
  id: string;
  receipt_no: string;
  created_at: string;
  status: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  tip_amount: number;
  total: number;
  customer_name: string | null;
  stores: { name: string } | { name: string }[] | null;
  registers: { name: string } | { name: string }[] | null;
  pos_staff: { display_name: string } | { display_name: string }[] | null;
  sale_lines: SaleLine[];
  payments: Payment[];
  journal?: JournalEntry | null;
  postError?: string | null;
};

const PAGE_SIZE = 20;

function staffName(s: FlowSale): string {
  const st = s.pos_staff;
  if (!st) return "—";
  if (Array.isArray(st)) return st[0]?.display_name ?? "—";
  return st.display_name;
}

function accountLabel(line: JeLine): string {
  const a = line.accounts;
  if (!a) return "—";
  const row = Array.isArray(a) ? a[0] : a;
  return row ? `${row.code} ${row.name}` : "—";
}

export function TransactionFlowTab({
  orgId,
  currency,
  from,
  to,
  timeZone = DEFAULT_ORG_TIMEZONE,
}: {
  orgId: string;
  currency: string;
  from: string;
  to: string;
  timeZone?: string;
}) {
  const [sales, setSales] = useState<FlowSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const t = useTranslations("finance");
  const tCommon = useTranslations("common");
  const locale = useLocale() as AppLocale;

  const money = (n: number) => formatCurrency(n, currency, localeToBcp47(locale));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const fromIso = `${from}T00:00:00.000Z`;
    const toIso = `${to}T23:59:59.999Z`;

    const { data: saleRows, error: saleErr } = await supabase
      .from("sales")
      .select(
        `id, receipt_no, created_at, status, subtotal, tax_amount, discount_amount, tip_amount, total,
         customer_name,
         stores(name), registers(name), pos_staff(display_name),
         sale_lines(id, product_name, variant_name, quantity, unit_price, tax_amount, discount_amount, line_total, uom_code),
         payments(id, method, amount, status)`
      )
      .eq("organization_id", orgId)
      .eq("status", "completed")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .limit(300);

    if (saleErr) {
      setError(saleErr.message);
      setLoading(false);
      return;
    }

    const list = (saleRows as unknown as FlowSale[]) ?? [];
    const ids = list.map((s) => s.id);
    const jeBySale = new Map<string, JournalEntry>();
    const errBySale = new Map<string, string>();

    if (ids.length > 0) {
      const [{ data: jes }, { data: queueRows }] = await Promise.all([
        supabase
          .from("journal_entries")
          .select(
            `id, entry_date, memo, source_id,
           journal_entry_lines(id, debit, credit, description, accounts(code, name))`
          )
          .eq("organization_id", orgId)
          .eq("source_type", "sale")
          .in("source_id", ids),
        supabase
          .from("sale_ledger_post_queue")
          .select("sale_id, last_error, attempts")
          .in("sale_id", ids),
      ]);

      for (const je of jes ?? []) {
        const sourceId = (je as { source_id?: string }).source_id;
        if (sourceId) {
          jeBySale.set(sourceId, {
            id: je.id as string,
            entry_date: je.entry_date as string,
            memo: (je.memo as string | null) ?? null,
            journal_entry_lines: ((je as { journal_entry_lines?: JeLine[] }).journal_entry_lines ??
              []) as JeLine[],
          });
        }
      }

      for (const q of queueRows ?? []) {
        const sid = (q as { sale_id: string }).sale_id;
        const err = (q as { last_error?: string | null }).last_error;
        const attempts = Number((q as { attempts?: number }).attempts ?? 0);
        if (err && (attempts > 0 || err.length > 0)) errBySale.set(sid, err);
      }
    }

    setSales(
      list.map((s) => ({
        ...s,
        tip_amount: Number(s.tip_amount ?? 0),
        sale_lines: s.sale_lines ?? [],
        payments: s.payments ?? [],
        journal: jeBySale.get(s.id) ?? null,
        postError: errBySale.get(s.id) ?? null,
      }))
    );
    setLoading(false);
  }, [orgId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter((s) => {
      const hay = [
        s.receipt_no,
        s.customer_name,
        relationName(s.stores),
        staffName(s),
        ...s.sale_lines.map((l) => l.product_name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sales, search]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const tipsTotal = useMemo(
    () => filtered.reduce((sum, s) => sum + Number(s.tip_amount || 0), 0),
    [filtered]
  );

  const csvRows = useMemo(() => {
    const rows: Record<string, unknown>[] = [];
    for (const s of filtered) {
      const base = {
        receipt_no: s.receipt_no,
        date: formatOrgDateTimeFull(s.created_at, timeZone),
        status: s.status,
        store: relationName(s.stores) || "",
        cashier: staffName(s),
        tip_amount: s.tip_amount,
        sale_total: s.total,
        journal_entry_id: s.journal?.id ?? "",
        posted: s.journal ? "yes" : "no",
      };
      if (s.sale_lines.length === 0 && s.payments.length === 0 && !s.journal) {
        rows.push({ ...base, row_kind: "sale", detail: "", amount: s.total });
        continue;
      }
      for (const line of s.sale_lines) {
        rows.push({
          ...base,
          row_kind: "line",
          detail: `${line.product_name}${line.variant_name ? ` / ${line.variant_name}` : ""}${
            line.uom_code ? ` (${line.uom_code})` : ""
          }`,
          quantity: line.quantity,
          amount:
            Math.round(
              (Number(line.line_total) - Number(line.tax_amount || 0)) * 100
            ) / 100,
        });
      }
      for (const p of s.payments) {
        rows.push({
          ...base,
          row_kind: "payment",
          detail: p.method,
          amount: p.amount,
        });
      }
      for (const jl of s.journal?.journal_entry_lines ?? []) {
        rows.push({
          ...base,
          row_kind: "journal",
          detail: accountLabel(jl),
          description: jl.description ?? "",
          debit: jl.debit,
          credit: jl.credit,
          amount: Number(jl.debit) || Number(jl.credit) || 0,
        });
      }
    }
    return rows;
  }, [filtered]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ReportSection
      title={t("txnFlow.title")}
      subtitle={`${filtered.length} · ${t("txnFlow.subtitle")} · ${from} → ${to}`}
      actions={
        <ExportCsvButton
          label={tCommon("exportCsv")}
          filename={`transaction-flow-${from}-${to}`}
          rows={csvRows}
          columns={[
            { key: "receipt_no", label: "Receipt" },
            { key: "date", label: "Date" },
            { key: "status", label: "Status" },
            { key: "store", label: "Store" },
            { key: "cashier", label: "Cashier" },
            { key: "tip_amount", label: "Tip" },
            { key: "sale_total", label: "Sale total" },
            { key: "posted", label: "Posted" },
            { key: "journal_entry_id", label: "Journal ID" },
            { key: "row_kind", label: "Row kind" },
            { key: "detail", label: "Detail" },
            { key: "description", label: "Description" },
            { key: "quantity", label: "Qty" },
            { key: "debit", label: "Debit" },
            { key: "credit", label: "Credit" },
            { key: "amount", label: "Amount" },
          ]}
        />
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
        <span>
          <span className="text-muted-foreground">{t("txnFlow.tipsInPeriod")}: </span>
          <span className="font-mono font-semibold">{money(tipsTotal)}</span>
        </span>
      </div>

      <TableToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder={t("searchTxnPlaceholder")}
        className="mb-4"
      />

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("txnFlow.loading")}
        </div>
      )}

      {error && <p className="py-6 text-center text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <div className="space-y-2">
          {paged.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              {t("txnFlow.noCompletedSales")}
            </div>
          ) : (
            paged.map((s) => {
              const isOpen = expanded.has(s.id);
              const posted = Boolean(s.journal);
              return (
                <div key={s.id} className="overflow-hidden rounded-lg border border-border bg-card">
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="grid min-w-0 flex-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                      <div>
                        <p className="text-xs text-muted-foreground">{tCommon("receipt")}</p>
                        <p className="font-medium">{s.receipt_no}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{tCommon("date")}</p>
                        <p className="text-sm">{formatOrgDateTimeFull(s.created_at, timeZone)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{tCommon("store")}</p>
                        <p className="truncate text-sm">{relationName(s.stores) || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{tCommon("cashier")}</p>
                        <p className="text-sm">{staffName(s)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{tCommon("tip")}</p>
                        <p className="font-mono text-sm">
                          {Number(s.tip_amount) > 0 ? money(Number(s.tip_amount)) : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{tCommon("total")}</p>
                        <p className="font-mono font-semibold">{money(Number(s.total))}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("tabs.ledger")}</p>
                        <p className="text-sm">
                          {posted ? t("txnFlow.posted") : t("txnFlow.unposted")}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={posted ? "completed" : "pending"} />
                  </button>

                  {isOpen && (
                    <div className="space-y-4 border-t bg-muted/10 px-4 py-4">
                      <div className="flex flex-wrap gap-4 text-sm">
                        <span>
                          {tCommon("subtotal")}{" "}
                          <span className="font-mono">{money(Number(s.subtotal))}</span>
                        </span>
                        <span>
                          {tCommon("tax")}{" "}
                          <span className="font-mono">{money(Number(s.tax_amount))}</span>
                        </span>
                        {Number(s.discount_amount) > 0 && (
                          <span>
                            {tCommon("discount")}{" "}
                            <span className="font-mono">({money(Number(s.discount_amount))})</span>
                          </span>
                        )}
                        {Number(s.tip_amount) > 0 && (
                          <span>
                            {tCommon("tip")}{" "}
                            <span className="font-mono">{money(Number(s.tip_amount))}</span>
                            <span className="text-muted-foreground"> → {t("tipPayable")}</span>
                          </span>
                        )}
                        <Button variant="outline" size="sm" asChild className="ml-auto">
                          <Link href={`/sales/${s.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                            {t("txnFlow.fullSale")}
                          </Link>
                        </Button>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {tCommon("lines")} ({s.sale_lines.length})
                          </p>
                          <DataTable>
                            <table className="w-full text-sm">
                              <DataTableHeader>
                                <DataTableHead>{tCommon("product")}</DataTableHead>
                                <DataTableHead align="right">{tCommon("qty")}</DataTableHead>
                                <DataTableHead align="right">{tCommon("total")}</DataTableHead>
                              </DataTableHeader>
                              <DataTableBody>
                                {s.sale_lines.length === 0 ? (
                                  <DataTableEmpty colSpan={3} message={t("txnFlow.noLines")} />
                                ) : (
                                  s.sale_lines.map((l) => (
                                    <DataTableRow key={l.id}>
                                      <DataTableCell>
                                        {l.product_name}
                                        {l.uom_code ? (
                                          <span className="text-muted-foreground"> · {l.uom_code}</span>
                                        ) : null}
                                      </DataTableCell>
                                      <DataTableCell align="right">{l.quantity}</DataTableCell>
                                      <DataTableCell align="right">
                                        {money(
                                          Math.round(
                                            (Number(l.line_total) - Number(l.tax_amount || 0)) * 100
                                          ) / 100
                                        )}
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
                            {tCommon("payments")} ({s.payments.length})
                          </p>
                          <DataTable>
                            <table className="w-full text-sm">
                              <DataTableHeader>
                                <DataTableHead>{tCommon("method")}</DataTableHead>
                                <DataTableHead align="right">{tCommon("amount")}</DataTableHead>
                              </DataTableHeader>
                              <DataTableBody>
                                {s.payments.length === 0 ? (
                                  <DataTableEmpty colSpan={2} message={t("txnFlow.noPayments")} />
                                ) : (
                                  s.payments.map((p) => (
                                    <DataTableRow key={p.id}>
                                      <DataTableCell className="capitalize">
                                        {p.method.replace(/_/g, " ")}
                                      </DataTableCell>
                                      <DataTableCell align="right">{money(Number(p.amount))}</DataTableCell>
                                    </DataTableRow>
                                  ))
                                )}
                              </DataTableBody>
                            </table>
                          </DataTable>
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t("txnFlow.journal")}{" "}
                          {s.journal
                            ? `(${s.journal.entry_date})`
                            : s.postError
                              ? t("txnFlow.failedToPostShort")
                              : t("txnFlow.notPostedShort")}
                        </p>
                        {!s.journal ? (
                          <p className="text-sm text-amber-700">
                            {s.postError
                              ? t("txnFlow.failedToPostHint", { error: s.postError })
                              : t("txnFlow.notPostedHint")}
                          </p>
                        ) : (
                          <DataTable>
                            <table className="w-full text-sm">
                              <DataTableHeader>
                                <DataTableHead>{tCommon("account")}</DataTableHead>
                                <DataTableHead>{tCommon("description")}</DataTableHead>
                                <DataTableHead align="right">{tCommon("debit")}</DataTableHead>
                                <DataTableHead align="right">{tCommon("credit")}</DataTableHead>
                              </DataTableHeader>
                              <DataTableBody>
                                {s.journal.journal_entry_lines.map((jl) => (
                                  <DataTableRow key={jl.id}>
                                    <DataTableCell>{accountLabel(jl)}</DataTableCell>
                                    <DataTableCell>{jl.description ?? "—"}</DataTableCell>
                                    <DataTableCell align="right">
                                      {Number(jl.debit) > 0 ? money(Number(jl.debit)) : "—"}
                                    </DataTableCell>
                                    <DataTableCell align="right">
                                      {Number(jl.credit) > 0 ? money(Number(jl.credit)) : "—"}
                                    </DataTableCell>
                                  </DataTableRow>
                                ))}
                              </DataTableBody>
                            </table>
                          </DataTable>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          <TablePagination
            page={page}
            totalPages={Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}
            total={filtered.length}
            onPageChange={setPage}
          />
        </div>
      )}
    </ReportSection>
  );
}

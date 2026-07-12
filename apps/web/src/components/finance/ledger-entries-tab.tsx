"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { ExportCsvButton } from "@/components/finance/export-csv-button";
import { ReportSection } from "@/components/finance/report-section";
import { StatusBadge } from "@/components/layout/status-badge";
import { TableToolbar, TablePagination } from "@/components/layout/table-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SELECT_CLS } from "@/lib/ui-classes";
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type LedgerLineRow = {
  id: string;
  debit: number;
  credit: number;
  description: string | null;
  account_code?: string;
  account_name?: string;
  account_type?: string;
  accounts?: { code: string; name: string; account_type: string } | { code: string; name: string; account_type: string }[] | null;
};

export type LedgerEntryRow = {
  id: string;
  entry_date: string;
  memo: string | null;
  reference: string | null;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
  journal_code?: string;
  reversal_entry_id?: string | null;
  reversed_entry_id?: string | null;
  entry_status?: string;
  journal_entry_lines: LedgerLineRow[];
};

const PAGE_SIZE = 25;

function accountInfo(line: LedgerLineRow) {
  if (line.account_code) {
    return { code: line.account_code, name: line.account_name ?? "", type: line.account_type ?? "" };
  }
  const a = line.accounts;
  if (!a) return { code: "—", name: "Unknown", type: "" };
  const row = Array.isArray(a) ? a[0] : a;
  return { code: row.code, name: row.name, type: row.account_type };
}

function sourceLink(entry: LedgerEntryRow): { href: string; label: string } | null {
  if (!entry.source_type || !entry.source_id) return null;
  if (entry.source_type === "sale") return { href: `/sales/${entry.source_id}`, label: "View sale" };
  if (entry.source_type === "expense") return { href: "/expenses", label: "Expenses" };
  return null;
}

function normalizeRpcEntry(raw: Record<string, unknown>): LedgerEntryRow {
  const lines = (raw.lines as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: String(raw.id),
    entry_date: String(raw.entry_date),
    memo: (raw.memo as string | null) ?? null,
    reference: (raw.reference as string | null) ?? null,
    source_type: (raw.source_type as string | null) ?? null,
    source_id: (raw.source_id as string | null) ?? null,
    created_at: String(raw.created_at),
    journal_code: raw.journal_code as string | undefined,
    reversal_entry_id: (raw.reversal_entry_id as string | null) ?? null,
    reversed_entry_id: (raw.reversed_entry_id as string | null) ?? null,
    entry_status: raw.entry_status as string | undefined,
    journal_entry_lines: lines.map((l) => ({
      id: String(l.id),
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: (l.description as string | null) ?? null,
      account_code: l.account_code as string | undefined,
      account_name: l.account_name as string | undefined,
      account_type: l.account_type as string | undefined,
    })),
  };
}

export function LedgerEntriesTab({
  orgId,
  currency,
  from,
  to,
  canManage = false,
  entries: initialEntries,
}: {
  orgId?: string;
  currency: string;
  from: string;
  to: string;
  canManage?: boolean;
  entries?: LedgerEntryRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<LedgerEntryRow[]>(initialEntries ?? []);
  const [total, setTotal] = useState(initialEntries?.length ?? 0);
  const [loading, setLoading] = useState(Boolean(orgId));
  const [reversingId, setReversingId] = useState<string | null>(null);

  const money = (n: number) => formatCurrency(n, currency);
  const serverMode = Boolean(orgId);

  const loadPage = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_journal_entries_page", {
      p_org_id: orgId,
      p_from: from,
      p_to: to,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
      p_source_type: sourceFilter === "all" ? null : sourceFilter,
    });
    setLoading(false);
    if (error || !data) {
      setEntries([]);
      setTotal(0);
      return;
    }
    const payload = data as { total?: number; entries?: Record<string, unknown>[] };
    setTotal(payload.total ?? 0);
    setEntries((payload.entries ?? []).map(normalizeRpcEntry));
  }, [orgId, from, to, page, sourceFilter]);

  useEffect(() => {
    if (serverMode) void loadPage();
  }, [serverMode, loadPage]);

  const filtered = useMemo(() => {
    if (serverMode) return entries;
    const list = initialEntries ?? [];
    return list.filter((e) => {
      if (sourceFilter !== "all" && (e.source_type ?? "manual") !== sourceFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const lineHit = e.journal_entry_lines.some((l) => {
        const acc = accountInfo(l);
        return (
          acc.name.toLowerCase().includes(q) ||
          acc.code.toLowerCase().includes(q) ||
          (l.description ?? "").toLowerCase().includes(q)
        );
      });
      return (
        (e.memo ?? "").toLowerCase().includes(q) ||
        (e.reference ?? "").toLowerCase().includes(q) ||
        (e.source_type ?? "").toLowerCase().includes(q) ||
        lineHit
      );
    });
  }, [entries, initialEntries, search, sourceFilter, serverMode]);

  const totalPages = serverMode
    ? Math.max(1, Math.ceil(total / PAGE_SIZE))
    : Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const paged = serverMode ? filtered : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const displayTotal = serverMode ? total : filtered.length;

  const totals = useMemo(() => {
    let debits = 0;
    let credits = 0;
    for (const e of paged) {
      for (const l of e.journal_entry_lines) {
        debits += Number(l.debit);
        credits += Number(l.credit);
      }
    }
    return { debits, credits, count: displayTotal };
  }, [paged, displayTotal]);

  const exportRows = useMemo(
    () =>
      paged.flatMap((e) =>
        e.journal_entry_lines.map((l) => {
          const acc = accountInfo(l);
          return {
            date: e.entry_date,
            memo: e.memo ?? "",
            reference: e.reference ?? "",
            source: e.source_type ?? "manual",
            account_code: acc.code,
            account: acc.name,
            description: l.description ?? "",
            debit: l.debit || "",
            credit: l.credit || "",
          };
        })
      ),
    [paged]
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleReverse(entryId: string) {
    if (!canManage) return;
    setReversingId(entryId);
    const supabase = createClient();
    const { error } = await supabase.rpc("reverse_journal_entry", {
      p_entry_id: entryId,
      p_reversal_date: to,
      p_memo: null,
    });
    setReversingId(null);
    if (error) {
      toast({ title: "Reverse failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Journal entry reversed" });
    if (serverMode) void loadPage();
    router.refresh();
  }

  const clientSearch = serverMode ? null : (
    <TableToolbar
      search={search}
      onSearchChange={(v) => {
        setSearch(v);
        setPage(1);
      }}
      placeholder="Search memo, account, reference…"
    />
  );

  return (
    <ReportSection
      title="General ledger entries"
      subtitle={`${totals.count} journal entries${serverMode ? " in period" : ""}`}
      actions={
        <ExportCsvButton
          filename={`ledger-entries-${from}-${to}`}
          rows={exportRows}
          columns={[
            { key: "date", label: "Date" },
            { key: "memo", label: "Memo" },
            { key: "reference", label: "Reference" },
            { key: "source", label: "Source" },
            { key: "account_code", label: "Account Code" },
            { key: "account", label: "Account" },
            { key: "description", label: "Line Description" },
            { key: "debit", label: "Debit" },
            { key: "credit", label: "Credit" },
          ]}
        />
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {clientSearch}
        <select
          className={SELECT_CLS + " h-9 w-[160px]"}
          value={sourceFilter}
          onChange={(e) => {
            setSourceFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All sources</option>
          <option value="sale">Sales</option>
          <option value="expense">Expenses</option>
          <option value="manual">Manual</option>
          <option value="invoice">Invoices</option>
          <option value="credit_note">Credit notes</option>
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading ledger…
        </div>
      )}

      {!loading && (
        <div className="space-y-2">
          {paged.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              No ledger entries in this period. Post sales and expenses to populate the ledger.
            </div>
          ) : (
            paged.map((entry) => {
              const isOpen = expanded.has(entry.id);
              const entryDebits = entry.journal_entry_lines.reduce((s, l) => s + Number(l.debit), 0);
              const link = sourceLink(entry);
              return (
                <div key={entry.id} className="overflow-hidden rounded-lg border border-border bg-card">
                  <button
                    type="button"
                    onClick={() => toggle(entry.id)}
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="grid min-w-0 flex-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-5">
                      <div>
                        <p className="text-xs text-muted-foreground">Date</p>
                        <p className="text-sm font-medium">{entry.entry_date}</p>
                      </div>
                      <div className="min-w-0 lg:col-span-2">
                        <p className="text-xs text-muted-foreground">Memo</p>
                        <p className="truncate text-sm">{entry.memo || entry.reference || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Source</p>
                        <p className="text-sm capitalize">{entry.source_type?.replace(/_/g, " ") ?? "Manual"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Entry total</p>
                        <p className="font-mono text-sm font-semibold">{money(entryDebits)}</p>
                      </div>
                    </div>
                    {entry.source_type && (
                      <StatusBadge status={entry.source_type === "sale" ? "completed" : entry.source_type} />
                    )}
                  </button>

                  {isOpen && (
                    <div className="border-t bg-muted/10 px-4 py-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          Posted {new Date(entry.created_at).toLocaleString()}
                          {entry.journal_code ? ` · ${entry.journal_code}` : ""}
                        </span>
                        {entry.reference && <span>Ref: {entry.reference}</span>}
                        {link && (
                          <Button variant="outline" size="sm" asChild>
                            <Link href={link.href}>
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              {link.label}
                            </Link>
                          </Button>
                        )}
                        {canManage &&
                          entry.entry_status !== "draft" &&
                          !entry.reversal_entry_id &&
                          !entry.reversed_entry_id &&
                          entry.source_type !== "reversal" &&
                          entry.source_type !== "period_close" && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={reversingId === entry.id}
                              onClick={() => void handleReverse(entry.id)}
                            >
                              {reversingId === entry.id ? "Reversing…" : "Reverse entry"}
                            </Button>
                          )}
                        {entry.reversal_entry_id && (
                          <span className="text-amber-700">Reversed</span>
                        )}
                      </div>
                      <DataTable>
                        <table className="w-full text-sm">
                          <DataTableHeader>
                            <DataTableHead>Account</DataTableHead>
                            <DataTableHead>Description</DataTableHead>
                            <DataTableHead align="right">Debit</DataTableHead>
                            <DataTableHead align="right">Credit</DataTableHead>
                          </DataTableHeader>
                          <DataTableBody>
                            {entry.journal_entry_lines.map((line) => {
                              const acc = accountInfo(line);
                              return (
                                <DataTableRow key={line.id}>
                                  <DataTableCell>
                                    <p className="font-mono text-xs text-muted-foreground">{acc.code}</p>
                                    <p className="font-medium">{acc.name}</p>
                                  </DataTableCell>
                                  <DataTableCell className="text-muted-foreground">
                                    {line.description || "—"}
                                  </DataTableCell>
                                  <DataTableCell align="right" className="font-mono">
                                    {Number(line.debit) > 0 ? money(Number(line.debit)) : "—"}
                                  </DataTableCell>
                                  <DataTableCell align="right" className="font-mono">
                                    {Number(line.credit) > 0 ? money(Number(line.credit)) : "—"}
                                  </DataTableCell>
                                </DataTableRow>
                              );
                            })}
                          </DataTableBody>
                        </table>
                      </DataTable>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {!loading && displayTotal > 0 && (
        <div className={cn("mt-4")}>
          <TablePagination page={page} totalPages={totalPages} total={displayTotal} onPageChange={setPage} />
        </div>
      )}
    </ReportSection>
  );
}

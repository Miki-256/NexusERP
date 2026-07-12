"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
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
import { formatCurrency } from "@/lib/utils";
import { SELECT_CLS } from "@/lib/ui-classes";
import { Building2, Link2, Upload } from "lucide-react";
import type { AccountRow } from "@/components/finance/chart-of-accounts-tab";

export type BankAccountRow = {
  id: string;
  name: string;
  account_number: string | null;
  bank_name: string | null;
  currency: string;
  account_type?: string;
  target_balance?: number | null;
  minimum_balance?: number | null;
  is_foreign?: boolean;
  functional_currency?: string;
  is_active: boolean;
  gl_account_id: string;
  gl_account_code: string;
  gl_account_name: string;
  gl_balance: number;
  unreconciled_lines: number;
};

type StmtLine = {
  id: string;
  line_date: string;
  description: string | null;
  reference: string | null;
  amount: number;
  reconciled: boolean;
  matched_entry_id: string | null;
  statement_date: string;
};

type UnmatchedEntry = {
  id: string;
  entry_date: string;
  memo: string | null;
  source_type: string | null;
  net_amount: number;
};

type ImportLine = { date: string; description: string; reference: string; amount: string };

export function BankingTab({
  orgId,
  currency,
  canManage,
  from,
  to,
  bankAccounts: initialAccounts,
  glAccounts,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  from: string;
  to: string;
  bankAccounts: BankAccountRow[];
  glAccounts: AccountRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [selectedId, setSelectedId] = useState(initialAccounts[0]?.id ?? "");
  const [stmtLines, setStmtLines] = useState<StmtLine[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedEntry[]>([]);
  const [busy, setBusy] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [name, setName] = useState("");
  const [glAccountId, setGlAccountId] = useState(glAccounts.find((a) => a.code === "1010")?.id ?? glAccounts[0]?.id ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankCurrency, setBankCurrency] = useState(currency);
  const [stmtDate, setStmtDate] = useState(to);
  const [openingBal, setOpeningBal] = useState("0");
  const [closingBal, setClosingBal] = useState("0");
  const [importLines, setImportLines] = useState<ImportLine[]>([
    { date: to, description: "", reference: "", amount: "" },
  ]);

  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedId) ?? null,
    [accounts, selectedId]
  );

  const assetAccounts = useMemo(
    () => glAccounts.filter((a) => a.type === "asset" && a.is_active),
    [glAccounts]
  );

  async function loadReconciliation(accountId: string) {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_bank_reconciliation", {
      p_bank_account_id: accountId,
      p_from: from,
      p_to: to,
    });
    if (error) {
      toast({ title: "Load failed", description: error.message, variant: "destructive" });
      return;
    }
    const payload = data as {
      statement_lines?: StmtLine[];
      unmatched_entries?: UnmatchedEntry[];
    };
    setStmtLines(payload.statement_lines ?? []);
    setUnmatched(payload.unmatched_entries ?? []);
  }

  useEffect(() => {
    if (selectedId) loadReconciliation(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, from, to]);

  async function refreshAccounts() {
    const supabase = createClient();
    const { data } = await supabase.rpc("list_bank_accounts", { p_org_id: orgId });
    const list = (data as BankAccountRow[]) ?? [];
    setAccounts(list);
    if (!list.find((a) => a.id === selectedId) && list[0]) {
      setSelectedId(list[0].id);
    }
    router.refresh();
  }

  async function saveBankAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !glAccountId) return;
    setBusy("save-acct");
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_bank_account", {
      p_org_id: orgId,
      p_bank_account_id: null,
      p_name: name.trim(),
      p_gl_account_id: glAccountId,
      p_account_number: accountNumber || null,
      p_bank_name: bankName || null,
      p_currency: bankCurrency.toUpperCase(),
      p_is_active: true,
    });
    setBusy("");
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Bank account created" });
    setShowAdd(false);
    setName("");
    setAccountNumber("");
    setBankName("");
    setBankCurrency(currency);
    await refreshAccounts();
  }

  async function importStatement(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !selectedId) return;
    const lines = importLines
      .filter((l) => l.amount.trim())
      .map((l) => ({
        date: l.date || stmtDate,
        description: l.description.trim() || null,
        reference: l.reference.trim() || null,
        amount: Number(l.amount),
      }));
    if (lines.length === 0) {
      toast({ title: "Add at least one line", variant: "destructive" });
      return;
    }
    setBusy("import");
    const supabase = createClient();
    const { error } = await supabase.rpc("import_bank_statement", {
      p_bank_account_id: selectedId,
      p_statement_date: stmtDate,
      p_opening_balance: Number(openingBal) || 0,
      p_closing_balance: Number(closingBal) || 0,
      p_lines: lines,
    });
    setBusy("");
    if (error) {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Statement imported", description: `${lines.length} line(s) added.` });
    setShowImport(false);
    setImportLines([{ date: to, description: "", reference: "", amount: "" }]);
    await loadReconciliation(selectedId);
    await refreshAccounts();
  }

  async function autoMatch() {
    if (!canManage || !selectedId) return;
    setBusy("auto");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("auto_match_bank_statement", {
      p_bank_account_id: selectedId,
    });
    setBusy("");
    if (error) {
      toast({ title: "Auto-match failed", description: error.message, variant: "destructive" });
      return;
    }
    const matched = (data as { matched?: number })?.matched ?? 0;
    toast({ title: matched > 0 ? `Matched ${matched} line(s)` : "No matches found" });
    await loadReconciliation(selectedId);
    await refreshAccounts();
  }

  async function matchLine(lineId: string, entryId: string) {
    setBusy(lineId);
    const supabase = createClient();
    const { error } = await supabase.rpc("match_bank_statement_line", {
      p_line_id: lineId,
      p_entry_id: entryId,
    });
    setBusy("");
    if (error) {
      toast({ title: "Match failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Line reconciled" });
    await loadReconciliation(selectedId);
    await refreshAccounts();
  }

  async function unmatchLine(lineId: string) {
    setBusy(lineId);
    const supabase = createClient();
    const { error } = await supabase.rpc("unmatch_bank_statement_line", { p_line_id: lineId });
    setBusy("");
    if (error) {
      toast({ title: "Unmatch failed", description: error.message, variant: "destructive" });
      return;
    }
    await loadReconciliation(selectedId);
    await refreshAccounts();
  }

  const unreconciled = stmtLines.filter((l) => !l.reconciled).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Bank accounts"
          value={String(accounts.length)}
          sub={`${accounts.filter((a) => a.is_active).length} active`}
          icon={Building2}
        />
        <StatCard
          label="GL balance"
          value={selected ? money(Number(selected.gl_balance)) : "—"}
          sub={selected ? `${selected.gl_account_code} · ${selected.name}` : "Select an account"}
          icon={Building2}
        />
        <StatCard
          label="Unreconciled"
          value={String(unreconciled)}
          sub="Statement lines in range"
          icon={Link2}
        />
      </div>

      <ReportSection title="Bank accounts" subtitle="Link operational bank accounts to GL asset accounts">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            className={SELECT_CLS}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {accounts.length === 0 && <option value="">No bank accounts</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.gl_account_code})
              </option>
            ))}
          </select>
          {canManage && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
                Add account
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowImport((v) => !v)} disabled={!selectedId}>
                <Upload className="mr-1.5 h-4 w-4" />
                Import statement
              </Button>
              <Button size="sm" onClick={autoMatch} disabled={!!busy || !selectedId}>
                Auto-match
              </Button>
            </>
          )}
        </div>

        {showAdd && canManage && (
          <form onSubmit={saveBankAccount} className="mb-6 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Account name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Operating account" />
            </div>
            <div className="space-y-2">
              <Label>GL account</Label>
              <select className={SELECT_CLS} value={glAccountId} onChange={(e) => setGlAccountId(e.target.value)} required>
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Bank name</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Commercial Bank" />
            </div>
            <div className="space-y-2">
              <Label>Account number</Label>
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Input
                value={bankCurrency}
                onChange={(e) => setBankCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                placeholder={currency}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy === "save-acct"}>Save bank account</Button>
            </div>
          </form>
        )}

        {showImport && canManage && selectedId && (
          <form onSubmit={importStatement} className="mb-6 space-y-4 rounded-lg border border-border/60 bg-muted/10 p-4">
            <p className="text-sm text-muted-foreground">
              Manual statement import (CSV/API stub). Enter lines as they appear on your bank statement.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Statement date</Label>
                <DatePicker value={stmtDate} onChange={setStmtDate} />
              </div>
              <div className="space-y-2">
                <Label>Opening balance</Label>
                <Input type="number" step="0.01" value={openingBal} onChange={(e) => setOpeningBal(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Closing balance</Label>
                <Input type="number" step="0.01" value={closingBal} onChange={(e) => setClosingBal(e.target.value)} />
              </div>
            </div>
            {importLines.map((line, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-5">
                <DatePicker value={line.date} onChange={(v) => setImportLines((prev) => prev.map((l, idx) => idx === i ? { ...l, date: v } : l))} />
                <Input className="sm:col-span-2" placeholder="Description" value={line.description} onChange={(e) => setImportLines((prev) => prev.map((l, idx) => idx === i ? { ...l, description: e.target.value } : l))} />
                <Input placeholder="Reference" value={line.reference} onChange={(e) => setImportLines((prev) => prev.map((l, idx) => idx === i ? { ...l, reference: e.target.value } : l))} />
                <Input type="number" step="0.01" placeholder="Amount (+/−)" value={line.amount} onChange={(e) => setImportLines((prev) => prev.map((l, idx) => idx === i ? { ...l, amount: e.target.value } : l))} />
              </div>
            ))}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setImportLines((prev) => [...prev, { date: stmtDate, description: "", reference: "", amount: "" }])}>
                Add line
              </Button>
              <Button type="submit" disabled={busy === "import"}>Import</Button>
            </div>
          </form>
        )}

        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Account</DataTableHead>
              <DataTableHead>GL</DataTableHead>
              <DataTableHead>Currency</DataTableHead>
              <DataTableHead align="right">Balance</DataTableHead>
              <DataTableHead align="right">Unreconciled</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {accounts.length === 0 ? (
                <DataTableEmpty colSpan={5} message="No bank accounts. Add one linked to your Bank GL account (1010)." />
              ) : (
                accounts.map((a) => (
                  <DataTableRow key={a.id}>
                    <DataTableCell>{a.name}</DataTableCell>
                    <DataTableCell className="font-mono text-xs">{a.gl_account_code}</DataTableCell>
                    <DataTableCell>
                      {a.currency}
                      {a.is_foreign && (
                        <span className="ml-1 text-xs text-amber-600">FC</span>
                      )}
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(a.gl_balance))}</DataTableCell>
                    <DataTableCell align="right">{a.unreconciled_lines}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      {selectedId && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ReportSection title="Statement lines" subtitle={`${from} → ${to}`}>
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Date</DataTableHead>
                  <DataTableHead>Description</DataTableHead>
                  <DataTableHead align="right">Amount</DataTableHead>
                  <DataTableHead>Status</DataTableHead>
                  {canManage && <DataTableHead align="right">Match</DataTableHead>}
                </DataTableHeader>
                <DataTableBody>
                  {stmtLines.length === 0 ? (
                    <DataTableEmpty colSpan={canManage ? 5 : 4} message="No statement lines in this range." />
                  ) : (
                    stmtLines.map((l) => (
                      <DataTableRow key={l.id}>
                        <DataTableCell>{l.line_date}</DataTableCell>
                        <DataTableCell>{l.description || l.reference || "—"}</DataTableCell>
                        <DataTableCell align="right" className="font-mono">{money(Number(l.amount))}</DataTableCell>
                        <DataTableCell>
                          <StatusBadge status={l.reconciled ? "completed" : "draft"} />
                        </DataTableCell>
                        {canManage && (
                          <DataTableCell align="right">
                            {l.reconciled ? (
                              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => unmatchLine(l.id)}>
                                Unmatch
                              </Button>
                            ) : (
                              <select
                                className={`${SELECT_CLS} max-w-[10rem] text-xs`}
                                defaultValue=""
                                onChange={(e) => {
                                  if (e.target.value) matchLine(l.id, e.target.value);
                                  e.target.value = "";
                                }}
                              >
                                <option value="">Match to…</option>
                                {unmatched
                                  .filter((u) => Math.abs(Number(u.net_amount) - Number(l.amount)) < 0.03)
                                  .map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.entry_date} · {money(Number(u.net_amount))}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </DataTableCell>
                        )}
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>
          </ReportSection>

          <ReportSection title="Unmatched GL entries" subtitle="Posted movements on linked GL account">
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Date</DataTableHead>
                  <DataTableHead>Memo</DataTableHead>
                  <DataTableHead>Source</DataTableHead>
                  <DataTableHead align="right">Net</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {unmatched.length === 0 ? (
                    <DataTableEmpty colSpan={4} message="All GL entries in range are matched or none exist." />
                  ) : (
                    unmatched.map((u) => (
                      <DataTableRow key={u.id}>
                        <DataTableCell>{u.entry_date}</DataTableCell>
                        <DataTableCell>{u.memo || "—"}</DataTableCell>
                        <DataTableCell className="text-xs text-muted-foreground">{u.source_type || "manual"}</DataTableCell>
                        <DataTableCell align="right" className="font-mono">{money(Number(u.net_amount))}</DataTableCell>
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>
          </ReportSection>
        </div>
      )}
    </div>
  );
}

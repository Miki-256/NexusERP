"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { StatCard } from "@/components/layout/stat-card";
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
import type { AccountRow } from "@/components/finance/chart-of-accounts-tab";
import { Target } from "lucide-react";

export type BudgetRow = {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  status: string;
  line_count: number;
  total_budget: number;
};

type BudgetLineResult = {
  account_code: string;
  account_name: string;
  budget: number;
  actual: number;
  variance: number;
};

type BudgetVsActual = {
  name: string;
  period_start: string;
  period_end: string;
  total_budget: number;
  total_actual: number;
  total_variance: number;
  lines: BudgetLineResult[];
};

type LineDraft = { accountId: string; amount: string };

export function BudgetTab({
  orgId,
  currency,
  canManage,
  from,
  to,
  budgets: initialBudgets,
  accounts,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  from: string;
  to: string;
  budgets: BudgetRow[];
  accounts: AccountRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);
  const [budgets, setBudgets] = useState(initialBudgets);
  const [selectedId, setSelectedId] = useState(initialBudgets[0]?.id ?? "");
  const [report, setReport] = useState<BudgetVsActual | null>(null);
  const [busy, setBusy] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [periodStart, setPeriodStart] = useState(from);
  const [periodEnd, setPeriodEnd] = useState(to);
  const [lines, setLines] = useState<LineDraft[]>([{ accountId: accounts[0]?.id ?? "", amount: "" }]);

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.is_active && (a.type === "expense" || a.type === "income")),
    [accounts]
  );

  useEffect(() => {
    if (selectedId) loadReport(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function loadReport(budgetId: string) {
    if (!budgetId) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("budget_vs_actual", { p_budget_id: budgetId });
    if (error) {
      toast({ title: "Load failed", description: error.message, variant: "destructive" });
      return;
    }
    setReport(data as BudgetVsActual);
  }

  async function refreshBudgets(selectId?: string) {
    const supabase = createClient();
    const { data } = await supabase.rpc("list_budgets", { p_org_id: orgId });
    const list = (data as BudgetRow[]) ?? [];
    setBudgets(list);
    const id = selectId ?? selectedId ?? list[0]?.id ?? "";
    if (id) {
      setSelectedId(id);
      await loadReport(id);
    }
    router.refresh();
  }

  async function createBudget(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const payload = lines
      .filter((l) => l.accountId && l.amount)
      .map((l) => ({ accountId: l.accountId, amount: Number(l.amount) }));
    if (!name.trim() || payload.length === 0) {
      toast({ title: "Name and at least one line required", variant: "destructive" });
      return;
    }
    setBusy("create");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("upsert_budget", {
      p_org_id: orgId,
      p_budget_id: null,
      p_name: name.trim(),
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_status: "active",
      p_lines: payload,
    });
    setBusy("");
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Budget created" });
    setShowForm(false);
    setName("");
    setLines([{ accountId: expenseAccounts[0]?.id ?? "", amount: "" }]);
    await refreshBudgets(data as string);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Budgets" value={String(budgets.length)} icon={Target} />
        <StatCard
          label="Selected budget"
          value={report ? money(Number(report.total_budget)) : "—"}
          sub={report?.name ?? "Choose a budget"}
          icon={Target}
        />
        <StatCard
          label="Variance"
          value={report ? money(Number(report.total_variance)) : "—"}
          sub={report ? `Actual ${money(Number(report.total_actual))}` : undefined}
          icon={Target}
          highlight={report && Number(report.total_variance) < 0 ? "negative" : undefined}
        />
      </div>

      <ReportSection title="Budgets" subtitle="Plan amounts by GL account and compare to actuals">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            className={SELECT_CLS}
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              loadReport(e.target.value);
            }}
          >
            {budgets.length === 0 && <option value="">No budgets</option>}
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.period_start} → {b.period_end})
              </option>
            ))}
          </select>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>
              New budget
            </Button>
          )}
        </div>

        {showForm && canManage && (
          <form onSubmit={createBudget} className="mb-6 space-y-4 rounded-lg border border-border/60 bg-muted/10 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-3">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="FY 2026 Operating" required />
              </div>
              <div className="space-y-2">
                <Label>Period start</Label>
                <DatePicker value={periodStart} onChange={setPeriodStart} />
              </div>
              <div className="space-y-2">
                <Label>Period end</Label>
                <DatePicker value={periodEnd} onChange={setPeriodEnd} />
              </div>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <select
                  className={SELECT_CLS}
                  value={line.accountId}
                  onChange={(e) =>
                    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, accountId: e.target.value } : l)))
                  }
                >
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Budget amount"
                  value={line.amount}
                  onChange={(e) =>
                    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, amount: e.target.value } : l)))
                  }
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, { accountId: expenseAccounts[0]?.id ?? "", amount: "" }])}>
                Add line
              </Button>
              <Button type="submit" disabled={busy === "create"}>Save budget</Button>
            </div>
          </form>
        )}

        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Budget</DataTableHead>
              <DataTableHead>Period</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Total</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {budgets.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No budgets yet." />
              ) : (
                budgets.map((b) => (
                  <DataTableRow key={b.id}>
                    <DataTableCell>{b.name}</DataTableCell>
                    <DataTableCell className="text-xs">{b.period_start} → {b.period_end}</DataTableCell>
                    <DataTableCell>{b.status}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(b.total_budget))}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      {report && (
        <ReportSection title="Budget vs actual" subtitle={`${report.period_start} → ${report.period_end}`}>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Account</DataTableHead>
                <DataTableHead align="right">Budget</DataTableHead>
                <DataTableHead align="right">Actual</DataTableHead>
                <DataTableHead align="right">Variance</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {(report.lines ?? []).length === 0 ? (
                  <DataTableEmpty colSpan={4} message="No budget lines." />
                ) : (
                  (report.lines ?? []).map((l, i) => (
                    <DataTableRow key={i}>
                      <DataTableCell>{l.account_code} — {l.account_name}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(l.budget))}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(l.actual))}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(l.variance))}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}
    </div>
  );
}

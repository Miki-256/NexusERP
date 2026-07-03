"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { TabBar } from "@/components/layout/tab-bar";
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
import { ChartCard, FinanceBarChart } from "@/components/charts/finance-charts";

export type DepartmentRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type AnalyticSummaryRow = {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  cogs: number;
  net: number;
};

type DimTab = "store" | "project" | "department";

export function AnalyticsTab({
  orgId,
  currency,
  canManage,
  from,
  to,
  departments: initialDepartments,
  storeSummary,
  projectSummary,
  departmentSummary,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  from: string;
  to: string;
  departments: DepartmentRow[];
  storeSummary: AnalyticSummaryRow[];
  projectSummary: AnalyticSummaryRow[];
  departmentSummary: AnalyticSummaryRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);
  const [dim, setDim] = useState<DimTab>("store");
  const [departments, setDepartments] = useState(initialDepartments);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const rows =
    dim === "store" ? storeSummary : dim === "project" ? projectSummary : departmentSummary;

  const chartData = rows.slice(0, 8).map((r) => ({
    name: r.name.length > 16 ? r.name.slice(0, 14) + "…" : r.name,
    value: Number(r.net),
    fill: Number(r.net) >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)",
  }));

  function resetDeptForm() {
    setEditingId(null);
    setCode("");
    setName("");
  }

  async function saveDepartment(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_department", {
      p_org_id: orgId,
      p_department_id: editingId,
      p_code: code.trim(),
      p_name: name.trim(),
      p_is_active: true,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Department updated" : "Department created" });
    const { data } = await supabase.rpc("list_departments", { p_org_id: orgId });
    setDepartments((data as DepartmentRow[]) ?? []);
    resetDeptForm();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <TabBar
        tabs={[
          { key: "store" as const, label: "By store" },
          { key: "project" as const, label: "By project" },
          { key: "department" as const, label: "By department" },
        ]}
        value={dim}
        onChange={setDim}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Net by dimension" subtitle={`${from} → ${to}`}>
          {chartData.length > 0 ? (
            <FinanceBarChart layout="vertical" data={chartData} formatValue={money} />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No tagged journal lines for this dimension in the selected period.
            </p>
          )}
        </ChartCard>

        <ReportSection title="P&L by tag" subtitle="From journal line analytic dimensions">
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead align="right">Revenue</DataTableHead>
                <DataTableHead align="right">Expenses</DataTableHead>
                <DataTableHead align="right">Net</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {rows.length === 0 ? (
                  <DataTableEmpty colSpan={4} message="No analytic data — tag manual entries or post sales with store context." />
                ) : (
                  rows.map((r) => (
                    <DataTableRow key={r.id}>
                      <DataTableCell>{r.name}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(r.revenue))}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(r.expenses) + Number(r.cogs))}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(r.net))}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      </div>

      {dim === "department" && canManage && (
        <ReportSection title="Departments" subtitle="Cost centers for journal line tagging">
          <form onSubmit={saveDepartment} className="mb-4 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required disabled={!!editingId} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>{editingId ? "Update" : "Add department"}</Button>
              {editingId && <Button type="button" variant="outline" onClick={resetDeptForm}>Cancel</Button>}
            </div>
          </form>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Code</DataTableHead>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead align="right">Actions</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {departments.map((d) => (
                  <DataTableRow key={d.id}>
                    <DataTableCell className="font-mono text-xs">{d.code}</DataTableCell>
                    <DataTableCell>{d.name}</DataTableCell>
                    <DataTableCell align="right">
                      <Button size="sm" variant="ghost" onClick={() => { setEditingId(d.id); setCode(d.code); setName(d.name); }}>
                        Edit
                      </Button>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}
    </div>
  );
}

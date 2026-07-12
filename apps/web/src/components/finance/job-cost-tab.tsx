"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Briefcase, Building2, Hammer } from "lucide-react";

export type CostCenterRow = {
  id: string;
  code: string;
  name: string;
  parent_id?: string | null;
  is_active: boolean;
  project_count?: number;
};

export type ProjectJobCostRow = {
  id: string;
  name: string;
  project_code?: string | null;
  accounting_status: string;
  cost_center_name?: string | null;
  budget_cost: number;
  budget_revenue: number;
  contract_value?: number | null;
  actual_revenue: number;
  actual_cost: number;
  margin: number;
  cost_variance: number;
  percent_complete?: number | null;
};

export type CostCenterSummaryRow = {
  id: string;
  code: string;
  name: string;
  project_count: number;
  revenue: number;
  cost: number;
  margin: number;
};

export type ProjectJobCostDetail = {
  project_id: string;
  project_name: string;
  project_code?: string | null;
  budget_cost: number;
  budget_revenue: number;
  actual_revenue: number;
  actual_cost: number;
  margin: number;
  cost_variance: number;
  percent_complete?: number | null;
  account_lines: { account_code: string; account_name: string; amount: number }[];
  budget_lines: {
    cost_category: string;
    budget_amount: number;
    actual_amount: number;
    variance: number;
  }[];
};

const COST_CATEGORIES = ["labor", "materials", "subcontract", "overhead", "other"] as const;

export function JobCostTab({
  orgId,
  currency,
  canManage,
  from,
  to,
  costCenters: initialCenters,
  projectsJobCost: initialProjects,
  costCenterSummary: initialCenterSummary,
  accounts,
  projects,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  from: string;
  to: string;
  costCenters: CostCenterRow[];
  projectsJobCost: ProjectJobCostRow[];
  costCenterSummary: CostCenterSummaryRow[];
  accounts: AccountRow[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);

  const [centers, setCenters] = useState(initialCenters);
  const [projectRows, setProjectRows] = useState(initialProjects);
  const [centerSummary, setCenterSummary] = useState(initialCenterSummary);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjects[0]?.id ?? projects[0]?.id ?? "");
  const [detail, setDetail] = useState<ProjectJobCostDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const [ccCode, setCcCode] = useState("");
  const [ccName, setCcName] = useState("");

  const [allocAmount, setAllocAmount] = useState("");
  const [allocSource, setAllocSource] = useState("");
  const [allocDest, setAllocDest] = useState("");
  const [allocCategory, setAllocCategory] = useState<string>("other");
  const [allocMemo, setAllocMemo] = useState("");

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.is_active && a.type === "expense"),
    [accounts]
  );

  const totals = useMemo(() => {
    const revenue = projectRows.reduce((s, p) => s + Number(p.actual_revenue), 0);
    const cost = projectRows.reduce((s, p) => s + Number(p.actual_cost), 0);
    return { revenue, cost, margin: revenue - cost };
  }, [projectRows]);

  const loadDetail = useCallback(async (projectId: string) => {
    if (!projectId) {
      setDetail(null);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_project_job_cost", {
      p_project_id: projectId,
      p_from: from,
      p_to: to,
    });
    if (error) {
      toast({ title: "Load failed", description: error.message, variant: "destructive" });
      return;
    }
    setDetail(data as ProjectJobCostDetail);
  }, [from, to, toast]);

  useEffect(() => {
    if (selectedProjectId) void loadDetail(selectedProjectId);
  }, [selectedProjectId, loadDetail]);

  async function refreshAll() {
    const supabase = createClient();
    const [{ data: cc }, { data: pj }, { data: cs }] = await Promise.all([
      supabase.rpc("list_cost_centers", { p_org_id: orgId }),
      supabase.rpc("list_projects_job_cost", { p_org_id: orgId, p_from: from, p_to: to }),
      supabase.rpc("get_cost_center_summary", { p_org_id: orgId, p_from: from, p_to: to }),
    ]);
    setCenters((cc as CostCenterRow[]) ?? []);
    setProjectRows((pj as ProjectJobCostRow[]) ?? []);
    setCenterSummary((cs as CostCenterSummaryRow[]) ?? []);
    router.refresh();
  }

  async function addCostCenter(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_cost_center", {
      p_org_id: orgId,
      p_cost_center_id: null,
      p_code: ccCode.trim(),
      p_name: ccName.trim(),
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Cost center created" });
    setCcCode("");
    setCcName("");
    await refreshAll();
  }

  async function postAllocation(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !selectedProjectId) return;
    const amount = parseFloat(allocAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    if (!allocSource || !allocDest) {
      toast({ title: "Select source and destination accounts", variant: "destructive" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("post_project_cost_allocation", {
      p_org_id: orgId,
      p_project_id: selectedProjectId,
      p_amount: amount,
      p_source_account_id: allocSource,
      p_destination_account_id: allocDest,
      p_cost_category: allocCategory,
      p_memo: allocMemo.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Allocation failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Cost allocated to project" });
    setAllocAmount("");
    setAllocMemo("");
    await refreshAll();
    await loadDetail(selectedProjectId);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Project revenue" value={money(totals.revenue)} sub={`${from} → ${to}`} icon={Briefcase} />
        <StatCard label="Project cost" value={money(totals.cost)} icon={Hammer} />
        <StatCard label="Project margin" value={money(totals.margin)} icon={Building2} />
        <StatCard label="Cost centers" value={String(centers.length)} sub={`${projectRows.length} projects w/ activity`} icon={Building2} />
      </div>

      <ReportSection title="Cost center rollup" subtitle="Revenue and cost from journal lines tagged to projects in each center">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Center</DataTableHead>
              <DataTableHead align="right">Projects</DataTableHead>
              <DataTableHead align="right">Revenue</DataTableHead>
              <DataTableHead align="right">Cost</DataTableHead>
              <DataTableHead align="right">Margin</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {centerSummary.length === 0 ? (
                <DataTableEmpty colSpan={5} message="No cost centers or tagged activity." />
              ) : (
                centerSummary.map((row) => (
                  <DataTableRow key={row.id}>
                    <DataTableCell>{row.code} — {row.name}</DataTableCell>
                    <DataTableCell align="right">{row.project_count}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.revenue))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.cost))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.margin))}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      {canManage && (
        <ReportSection title="Cost centers" subtitle="Organize projects for management reporting">
          <form onSubmit={addCostCenter} className="mb-4 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={ccCode} onChange={(e) => setCcCode(e.target.value.toUpperCase())} required placeholder="CC-100" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Name</Label>
              <Input value={ccName} onChange={(e) => setCcName(e.target.value)} required placeholder="Operations" />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm" disabled={busy}>Add cost center</Button>
            </div>
          </form>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Code</DataTableHead>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead align="right">Projects</DataTableHead>
                <DataTableHead>Status</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {centers.length === 0 ? (
                  <DataTableEmpty colSpan={4} message="No cost centers yet." />
                ) : (
                  centers.map((c) => (
                    <DataTableRow key={c.id}>
                      <DataTableCell className="font-mono text-xs">{c.code}</DataTableCell>
                      <DataTableCell>{c.name}</DataTableCell>
                      <DataTableCell align="right">{c.project_count ?? 0}</DataTableCell>
                      <DataTableCell>{c.is_active ? "Active" : "Inactive"}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}

      <ReportSection title="Project job cost" subtitle="Budget vs actual from GL lines tagged with project_id">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Project</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Budget cost</DataTableHead>
              <DataTableHead align="right">Actual cost</DataTableHead>
              <DataTableHead align="right">Revenue</DataTableHead>
              <DataTableHead align="right">Margin</DataTableHead>
              <DataTableHead align="right">Complete</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {projectRows.length === 0 ? (
                <DataTableEmpty colSpan={7} message="No project-tagged ledger activity in period." />
              ) : (
                projectRows.map((p) => (
                  <DataTableRow
                    key={p.id}
                    selected={p.id === selectedProjectId}
                  >
                    <DataTableCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => setSelectedProjectId(p.id)}
                      >
                        {p.project_code && (
                          <span className="mr-2 font-mono text-xs text-muted-foreground">{p.project_code}</span>
                        )}
                        {p.name}
                      </button>
                    </DataTableCell>
                    <DataTableCell>{p.accounting_status}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(p.budget_cost))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(p.actual_cost))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(p.actual_revenue))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(p.margin))}</DataTableCell>
                    <DataTableCell align="right">
                      {p.percent_complete != null ? `${p.percent_complete}%` : "—"}
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      {selectedProjectId && (
        <ReportSection title="Project detail" subtitle={detail?.project_name ?? "Loading…"}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select
              className={SELECT_CLS}
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {detail && (
            <div className="mb-4 grid gap-4 sm:grid-cols-4">
              <StatCard label="Budget cost" value={money(Number(detail.budget_cost))} icon={Hammer} />
              <StatCard label="Actual cost" value={money(Number(detail.actual_cost))} icon={Hammer} />
              <StatCard label="Revenue" value={money(Number(detail.actual_revenue))} icon={Briefcase} />
              <StatCard label="Margin" value={money(Number(detail.margin))} icon={Building2} />
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>GL account</DataTableHead>
                  <DataTableHead align="right">Amount</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {(detail?.account_lines ?? []).length === 0 ? (
                    <DataTableEmpty colSpan={2} message="No tagged journal lines." />
                  ) : (
                    (detail?.account_lines ?? []).map((l, i) => (
                      <DataTableRow key={`${l.account_code}-${i}`}>
                        <DataTableCell>{l.account_code} — {l.account_name}</DataTableCell>
                        <DataTableCell align="right" className="font-mono">{money(Number(l.amount))}</DataTableCell>
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>

            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Category budget</DataTableHead>
                  <DataTableHead align="right">Budget</DataTableHead>
                  <DataTableHead align="right">Actual</DataTableHead>
                  <DataTableHead align="right">Var</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {(detail?.budget_lines ?? []).length === 0 ? (
                    <DataTableEmpty colSpan={4} message="No category budgets set." />
                  ) : (
                    (detail?.budget_lines ?? []).map((l, i) => (
                      <DataTableRow key={`${l.cost_category}-${i}`}>
                        <DataTableCell>{l.cost_category}</DataTableCell>
                        <DataTableCell align="right" className="font-mono">{money(Number(l.budget_amount))}</DataTableCell>
                        <DataTableCell align="right" className="font-mono">{money(Number(l.actual_amount))}</DataTableCell>
                        <DataTableCell align="right" className="font-mono">{money(Number(l.variance))}</DataTableCell>
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>
          </div>

          {canManage && (
            <form onSubmit={postAllocation} className="mt-6 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" min="0.01" step="0.01" value={allocAmount} onChange={(e) => setAllocAmount(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <select className={SELECT_CLS} value={allocCategory} onChange={(e) => setAllocCategory(e.target.value)}>
                  {COST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Memo</Label>
                <Input value={allocMemo} onChange={(e) => setAllocMemo(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Cr source (expense)</Label>
                <select className={SELECT_CLS} value={allocSource} onChange={(e) => setAllocSource(e.target.value)} required>
                  <option value="">Select…</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Dr destination (project cost)</Label>
                <select className={SELECT_CLS} value={allocDest} onChange={(e) => setAllocDest(e.target.value)} required>
                  <option value="">Select…</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy}>{busy ? "Posting…" : "Allocate cost"}</Button>
              </div>
            </form>
          )}
        </ReportSection>
      )}
    </div>
  );
}

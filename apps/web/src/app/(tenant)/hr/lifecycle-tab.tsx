"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { TabBar } from "@/components/layout/tab-bar";
import { FormCard } from "@/components/layout/form-card";
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
import { SELECT_CLS } from "@/lib/ui-classes";
import { runHrMutation } from "@/lib/hr/mutations";
import type {
  ContractRenewalRow,
  EmploymentContractRow,
  OffboardingTaskRow,
  ProbationReviewRow,
} from "@/lib/hr/types";
import { Bell, CheckCircle2, LogOut, RefreshCw, UserCheck } from "lucide-react";

type LifeTab = "offboarding" | "probation" | "contracts";

export function LifecycleTab({
  organizationId,
  employees,
  offboardingTasks,
  offboardingTotal,
  probationReviews,
  probationTotal,
  contracts,
  contractTotal,
  contractsDue,
}: {
  organizationId: string;
  employees: { id: string; name: string }[];
  offboardingTasks: OffboardingTaskRow[];
  offboardingTotal: number;
  probationReviews: ProbationReviewRow[];
  probationTotal: number;
  contracts: EmploymentContractRow[];
  contractTotal: number;
  contractsDue: ContractRenewalRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<LifeTab>("offboarding");
  const [busy, setBusy] = useState(false);
  const [offboardEmployeeId, setOffboardEmployeeId] = useState(employees[0]?.id ?? "");
  const [lastWorkingDate, setLastWorkingDate] = useState("");
  const [probationEmployeeId, setProbationEmployeeId] = useState(employees[0]?.id ?? "");
  const [probationEnd, setProbationEnd] = useState("");
  const [contractEmployeeId, setContractEmployeeId] = useState(employees[0]?.id ?? "");
  const [contractEnd, setContractEnd] = useState("");
  const [contractTitle, setContractTitle] = useState("Fixed-term contract");
  const [renewDates, setRenewDates] = useState<Record<string, string>>({});
  const [extendDates, setExtendDates] = useState<Record<string, string>>({});

  async function startOffboarding(e: React.FormEvent) {
    e.preventDefault();
    if (!offboardEmployeeId) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("start_employee_offboarding", {
          p_employee_id: offboardEmployeeId,
          p_last_working_date: lastWorkingDate || null,
        });
        return { error };
      },
      { successTitle: "Offboarding started" }
    );
    setBusy(false);
    if (ok) router.refresh();
  }

  async function completeOffboardTask(id: string) {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("update_offboarding_task", {
          p_task_id: id,
          p_status: "completed",
        });
        return { error };
      },
      { successTitle: "Task completed" }
    );
    setBusy(false);
    router.refresh();
  }

  async function finalizeOffboarding(employeeId: string) {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("finalize_employee_offboarding", { p_employee_id: employeeId });
        return { error };
      },
      { successTitle: "Employee terminated" }
    );
    setBusy(false);
    router.refresh();
  }

  async function scheduleProbation(e: React.FormEvent) {
    e.preventDefault();
    if (!probationEmployeeId || !probationEnd) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("schedule_probation_review", {
          p_employee_id: probationEmployeeId,
          p_probation_end_date: probationEnd,
        });
        return { error };
      },
      { successTitle: "Probation review scheduled" }
    );
    setBusy(false);
    if (ok) router.refresh();
  }

  async function completeProbation(id: string, outcome: "passed" | "extended" | "failed") {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("complete_probation_review", {
          p_review_id: id,
          p_outcome: outcome,
          p_extended_until: outcome === "extended" ? extendDates[id] || null : null,
        });
        return { error };
      },
      { successTitle: `Probation ${outcome}` }
    );
    setBusy(false);
    router.refresh();
  }

  async function createContract(e: React.FormEvent) {
    e.preventDefault();
    if (!contractEmployeeId) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("create_employment_contract", {
          p_org_id: organizationId,
          p_employee_id: contractEmployeeId,
          p_title: contractTitle,
          p_end_date: contractEnd || null,
        });
        return { error };
      },
      { successTitle: "Contract created" }
    );
    setBusy(false);
    if (ok) router.refresh();
  }

  async function renewContract(id: string) {
    const newEnd = renewDates[id];
    if (!newEnd) return;
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("renew_employment_contract", {
          p_contract_id: id,
          p_new_end_date: newEnd,
        });
        return { error };
      },
      { successTitle: "Contract renewed" }
    );
    setBusy(false);
    router.refresh();
  }

  async function scanAlerts() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("scan_lifecycle_alerts", {
      p_org_id: organizationId,
      p_days_ahead: 14,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Scan failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Lifecycle scan complete", description: `${data ?? 0} alert(s) sent.` });
    router.refresh();
  }

  const offboardByEmployee = offboardingTasks.reduce<Record<string, OffboardingTaskRow[]>>((acc, t) => {
    (acc[t.employee_id] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabBar
          tabs={[
            { key: "offboarding" as const, label: "Offboarding" },
            { key: "probation" as const, label: "Probation" },
            { key: "contracts" as const, label: "Contracts" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void scanAlerts()}>
          <Bell className="h-4 w-4" />
          Scan alerts
        </Button>
      </div>

      {tab === "offboarding" && (
        <div className="space-y-6">
          <FormCard title="Start offboarding" onSubmit={startOffboarding}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Employee</Label>
                <select className={SELECT_CLS} value={offboardEmployeeId} onChange={(e) => setOffboardEmployeeId(e.target.value)}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Last working day</Label>
                <DatePicker value={lastWorkingDate} onChange={setLastWorkingDate} />
              </div>
            </div>
            <Button type="submit" disabled={busy || !offboardEmployeeId}>
              <LogOut className="h-4 w-4" />
              Start checklist
            </Button>
          </FormCard>

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Employee</DataTableHead>
                <DataTableHead>Task</DataTableHead>
                <DataTableHead>Due</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead align="right">Actions</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {offboardingTasks.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No offboarding tasks yet." />
                ) : (
                  offboardingTasks.map((t) => (
                    <DataTableRow key={t.id}>
                      <DataTableCell className="font-medium">{t.employee_name}</DataTableCell>
                      <DataTableCell>{t.title}</DataTableCell>
                      <DataTableCell>{t.due_date ?? "—"}</DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={t.status} />
                      </DataTableCell>
                      <DataTableCell align="right">
                        {t.status !== "completed" && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void completeOffboardTask(t.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Done
                          </Button>
                        )}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>

          {Object.entries(offboardByEmployee).map(([empId, tasks]) => {
            const allDone = tasks.every((t) => t.status === "completed" || t.status === "skipped");
            if (!allDone) return null;
            return (
              <div key={empId} className="flex items-center justify-between rounded-lg border p-3">
                <p className="text-sm">
                  All tasks complete for <span className="font-medium">{tasks[0]?.employee_name}</span>
                </p>
                <Button size="sm" disabled={busy} onClick={() => void finalizeOffboarding(empId)}>
                  Finalize termination
                </Button>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">{offboardingTotal} task(s) total</p>
        </div>
      )}

      {tab === "probation" && (
        <div className="space-y-6">
          <FormCard title="Schedule probation review" onSubmit={scheduleProbation}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Employee</Label>
                <select className={SELECT_CLS} value={probationEmployeeId} onChange={(e) => setProbationEmployeeId(e.target.value)}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Probation end date</Label>
                <DatePicker value={probationEnd} onChange={setProbationEnd} />
              </div>
            </div>
            <Button type="submit" disabled={busy || !probationEnd}>
              <UserCheck className="h-4 w-4" />
              Schedule
            </Button>
          </FormCard>

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Employee</DataTableHead>
                <DataTableHead>End date</DataTableHead>
                <DataTableHead>Reviewer</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead align="right">Outcome</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {probationReviews.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No probation reviews." />
                ) : (
                  probationReviews.map((r) => (
                    <DataTableRow key={r.id}>
                      <DataTableCell className="font-medium">{r.employee_name}</DataTableCell>
                      <DataTableCell>{r.probation_end_date}</DataTableCell>
                      <DataTableCell>{r.reviewer_name ?? "—"}</DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={r.status} />
                      </DataTableCell>
                      <DataTableCell align="right">
                        {r.status === "pending" && (
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" disabled={busy} onClick={() => void completeProbation(r.id, "passed")}>
                              Pass
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void completeProbation(r.id, "failed")}>
                              Fail
                            </Button>
                            <Input
                              type="date"
                              className="h-8 w-36"
                              value={extendDates[r.id] ?? ""}
                              onChange={(e) => setExtendDates((d) => ({ ...d, [r.id]: e.target.value }))}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || !extendDates[r.id]}
                              onClick={() => void completeProbation(r.id, "extended")}
                            >
                              Extend
                            </Button>
                          </div>
                        )}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
          <p className="text-xs text-muted-foreground">{probationTotal} review(s) total</p>
        </div>
      )}

      {tab === "contracts" && (
        <div className="space-y-6">
          <FormCard title="New contract" onSubmit={createContract}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label>Employee</Label>
                <select className={SELECT_CLS} value={contractEmployeeId} onChange={(e) => setContractEmployeeId(e.target.value)}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={contractTitle} onChange={(e) => setContractTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>End date</Label>
                <DatePicker value={contractEnd} onChange={setContractEnd} />
              </div>
            </div>
            <Button type="submit" disabled={busy}>
              Create contract
            </Button>
          </FormCard>

          {contractsDue.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="mb-3 text-sm font-medium">Contracts due for renewal</p>
              <div className="space-y-2">
                {contractsDue.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{c.employee_name}</span>
                    <span className="text-muted-foreground">
                      {c.contract_title} · ends {c.end_date} ({c.days_remaining}d)
                    </span>
                    <Input
                      type="date"
                      className="h-8 w-36"
                      value={renewDates[c.id] ?? ""}
                      onChange={(e) => setRenewDates((d) => ({ ...d, [c.id]: e.target.value }))}
                    />
                    <Button size="sm" variant="outline" disabled={busy || !renewDates[c.id]} onClick={() => void renewContract(c.id)}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Renew
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Employee</DataTableHead>
                <DataTableHead>Contract</DataTableHead>
                <DataTableHead>Start</DataTableHead>
                <DataTableHead>End</DataTableHead>
                <DataTableHead>Status</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {contracts.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No active contracts." />
                ) : (
                  contracts.map((c) => (
                    <DataTableRow key={c.id}>
                      <DataTableCell className="font-medium">{c.employee_name}</DataTableCell>
                      <DataTableCell>{c.contract_title}</DataTableCell>
                      <DataTableCell>{c.start_date}</DataTableCell>
                      <DataTableCell>{c.end_date ?? "—"}</DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={c.status} />
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
          <p className="text-xs text-muted-foreground">{contractTotal} contract(s) total</p>
        </div>
      )}
    </div>
  );
}

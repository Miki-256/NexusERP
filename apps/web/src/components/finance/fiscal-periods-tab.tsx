"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import { AlertTriangle, CheckCircle2, Lock, RefreshCw, Unlock } from "lucide-react";

export type FiscalPeriodRow = {
  id: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  closed_at: string | null;
  closing_entry_id: string | null;
  subledgers_locked?: boolean;
  subledgers_locked_at?: string | null;
  close_run_id?: string | null;
  close_run_status?: string | null;
  close_progress_pct?: number | null;
};

type CloseTask = {
  id: string;
  task_code: string;
  label: string;
  module: string;
  is_blocking: boolean;
  status: string;
  metric_value: number | null;
  metric_label: string | null;
  waive_note?: string | null;
};

type CloseStatus = {
  period_id: string;
  period_name: string;
  period_status: string;
  subledgers_locked: boolean;
  run: { id: string; status: string; progress_pct: number } | null;
  tasks: CloseTask[];
  blockers: { task_code: string; label: string; metric_value: number | null; metric_label: string | null }[];
};

function taskStatusForBadge(status: string): string {
  if (status === "passing" || status === "complete") return "completed";
  if (status === "blocked") return "rejected";
  return status;
}

function CloseChecklistPanel({
  periodId,
  periodName,
  canManage,
  initialRunId,
  initialProgress,
  subledgersLocked,
  onClosePeriod,
  closeBusy,
}: {
  periodId: string;
  periodName: string;
  canManage: boolean;
  initialRunId: string | null;
  initialProgress: number | null;
  subledgersLocked: boolean;
  onClosePeriod: () => void;
  closeBusy: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<CloseStatus | null>(null);
  const [expanded, setExpanded] = useState(!!initialRunId);

  const loadStatus = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_period_close_status", { p_period_id: periodId });
    if (error) throw error;
    setStatus(data as CloseStatus);
    return data as CloseStatus;
  }, [periodId]);

  async function runAction(
    key: string,
    rpcName: "start_period_close" | "run_period_close_preflight" | "lock_period_subledgers",
    args: Record<string, string | null>
  ) {
    if (!canManage) return;
    setBusy(key);
    const supabase = createClient();
    const { error } = await supabase.rpc(rpcName, args);
    setBusy("");
    if (error) {
      toast({ title: "Action failed", description: error.message, variant: "destructive" });
      return;
    }
    try {
      await loadStatus();
    } catch (e) {
      toast({
        title: "Refresh failed",
        description: e instanceof Error ? e.message : "Could not load close status",
        variant: "destructive",
      });
    }
    router.refresh();
  }

  async function waiveTask(runId: string, taskCode: string, note: string | null) {
    if (!canManage) return;
    setBusy(`waive-${taskCode}`);
    const supabase = createClient();
    const { error } = await supabase.rpc("waive_period_close_task", {
      p_run_id: runId,
      p_task_code: taskCode,
      p_note: note,
    });
    setBusy("");
    if (error) {
      toast({ title: "Waive failed", description: error.message, variant: "destructive" });
      return;
    }
    try {
      await loadStatus();
    } catch (e) {
      toast({
        title: "Refresh failed",
        description: e instanceof Error ? e.message : "Could not load close status",
        variant: "destructive",
      });
    }
    router.refresh();
  }

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && !status) {
      setBusy("load");
      try {
        await loadStatus();
      } catch (e) {
        toast({
          title: "Load failed",
          description: e instanceof Error ? e.message : "Could not load close checklist",
          variant: "destructive",
        });
      }
      setBusy("");
    }
  }

  const run = status?.run;
  const progress = run?.progress_pct ?? initialProgress ?? 0;
  const runStatus = run?.status ?? (initialRunId ? "in_progress" : null);
  const tasks = status?.tasks ?? [];
  const blockers = status?.blockers ?? [];
  const ready = runStatus === "ready";
  const locked = status?.subledgers_locked ?? subledgersLocked;

  return (
    <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="font-medium text-foreground hover:underline"
          onClick={toggleExpand}
        >
          Close checklist {expanded ? "▾" : "▸"}
        </button>
        {initialRunId && (
          <span className="text-xs text-muted-foreground">
            {progress}% complete
            {runStatus ? ` · ${runStatus.replace(/_/g, " ")}` : ""}
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {!initialRunId && !run && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => runAction("start", "start_period_close", { p_period_id: periodId })}
                >
                  Start close
                </Button>
              )}
              {(initialRunId || run) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() =>
                    runAction("preflight", "run_period_close_preflight", { p_period_id: periodId })
                  }
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  Run preflight
                </Button>
              )}
              {(initialRunId || run) && !locked && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() =>
                    runAction("lock", "lock_period_subledgers", { p_period_id: periodId })
                  }
                >
                  <Lock className="mr-1 h-3.5 w-3.5" />
                  Lock subledgers
                </Button>
              )}
              {ready && (
                <Button size="sm" disabled={closeBusy || !!busy} onClick={onClosePeriod}>
                  Close period
                </Button>
              )}
            </div>
          )}

          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>

          {locked && (
            <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <Lock className="h-3.5 w-3.5" />
              Subledgers locked for {periodName} — AR/AP/POS postings blocked in this date range.
            </p>
          )}

          {blockers.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">{blockers.length} blocking item(s)</p>
                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                  {blockers.map((b) => (
                    <li key={b.task_code}>
                      {b.label}
                      {b.metric_value != null && b.metric_value > 0
                        ? ` (${b.metric_value} ${b.metric_label ?? ""})`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {ready && blockers.length === 0 && (
            <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Checklist complete — ready to close {periodName}.
            </p>
          )}

          {tasks.length > 0 && (
            <ul className="divide-y divide-border/50 rounded-md border border-border/50">
              {tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <span className="font-medium">{t.label}</span>
                    <span className="ml-2 text-xs uppercase text-muted-foreground">{t.module}</span>
                    {t.metric_value != null && t.status === "blocked" && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t.metric_value} {t.metric_label}
                      </span>
                    )}
                    {t.waive_note && (
                      <p className="text-xs text-muted-foreground">Waived: {t.waive_note}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={taskStatusForBadge(t.status)} />
                    {canManage &&
                      t.is_blocking &&
                      t.status === "blocked" &&
                      !["trial_balance", "subledgers_lock"].includes(t.task_code) &&
                      run && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={!!busy}
                          onClick={() => {
                            const note = window.prompt(`Waive "${t.label}"? Optional note:`);
                            if (note === null) return;
                            waiveTask(run.id, t.task_code, note || null);
                          }}
                        >
                          Waive
                        </Button>
                      )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {tasks.length === 0 && !busy && (
            <p className="text-xs text-muted-foreground">
              Start the close checklist to scan blockers before locking the period.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function FiscalPeriodsTab({
  currency,
  canManage,
  fiscalYear,
  lockDate,
  periods,
}: {
  currency: string;
  canManage: boolean;
  fiscalYear: number;
  lockDate: string | null;
  periods: FiscalPeriodRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState("");

  const money = (n: number) => formatCurrency(n, currency);

  const closedCount = periods.filter((p) => p.status === "closed").length;
  const latestClosed = periods.filter((p) => p.status === "closed").sort((a, b) => b.period_no - a.period_no)[0];
  const inProgressClose = periods.filter(
    (p) => p.status === "open" && p.close_run_id && p.close_run_status !== "ready"
  ).length;

  async function closePeriod(id: string, hasChecklist: boolean, checklistReady: boolean) {
    if (!canManage) return;
    if (hasChecklist && !checklistReady) {
      toast({
        title: "Checklist incomplete",
        description: "Run preflight and resolve blockers before closing.",
        variant: "destructive",
      });
      return;
    }
    setBusy(id + "close");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("close_fiscal_period", { p_period_id: id });
    setBusy("");
    if (error) {
      toast({ title: "Close failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as { net_transferred?: number; lock_date?: string } | null;
    toast({
      title: "Period closed",
      description: result?.net_transferred
        ? `Transferred ${money(Number(result.net_transferred))} net to retained earnings.`
        : "Period locked with no P&L activity to transfer.",
    });
    router.refresh();
  }

  async function reopenPeriod(id: string) {
    if (!canManage) return;
    setBusy(id + "reopen");
    const supabase = createClient();
    const { error } = await supabase.rpc("reopen_fiscal_period", { p_period_id: id });
    setBusy("");
    if (error) {
      toast({ title: "Reopen failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Period reopened" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Fiscal year" value={String(fiscalYear)} sub="Calendar year" icon={Lock} />
        <StatCard
          label="Closed periods"
          value={String(closedCount)}
          sub={`${periods.length - closedCount} open`}
          icon={Lock}
        />
        <StatCard
          label="Lock date"
          value={lockDate ?? "None"}
          sub={
            inProgressClose > 0
              ? `${inProgressClose} close checklist(s) in progress`
              : "No posting on or before this date"
          }
          icon={Unlock}
        />
      </div>

      <ReportSection
        title="Fiscal periods"
        subtitle="Use the close checklist to scan blockers, lock subledgers, then close the period. P&L transfers to retained earnings (3900)."
      >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>#</DataTableHead>
              <DataTableHead>Period</DataTableHead>
              <DataTableHead>Start</DataTableHead>
              <DataTableHead>End</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead>Close</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {periods.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 7 : 6} message="No fiscal periods for this year." />
              ) : (
                periods.map((p) => {
                  const hasChecklist = !!p.close_run_id;
                  const checklistReady = p.close_run_status === "ready";
                  return (
                    <DataTableRow key={p.id}>
                      <DataTableCell className="font-mono text-xs">{p.period_no}</DataTableCell>
                      <DataTableCell>
                        <div>{p.name}</div>
                        {p.status === "open" && (
                          <CloseChecklistPanel
                            periodId={p.id}
                            periodName={p.name}
                            canManage={canManage}
                            initialRunId={p.close_run_id ?? null}
                            initialProgress={p.close_progress_pct ?? null}
                            subledgersLocked={!!p.subledgers_locked}
                            closeBusy={busy === p.id + "close"}
                            onClosePeriod={() => closePeriod(p.id, hasChecklist, checklistReady)}
                          />
                        )}
                      </DataTableCell>
                      <DataTableCell>{p.start_date}</DataTableCell>
                      <DataTableCell>{p.end_date}</DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={p.status === "closed" ? "completed" : "draft"} />
                        {p.subledgers_locked && p.status === "open" && (
                          <span className="ml-2 text-xs text-amber-600">subledgers locked</span>
                        )}
                      </DataTableCell>
                      <DataTableCell>
                        {p.close_run_id ? (
                          <span className="text-xs text-muted-foreground">
                            {p.close_progress_pct ?? 0}%
                            {p.close_run_status ? ` · ${p.close_run_status}` : ""}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </DataTableCell>
                      {canManage && (
                        <DataTableCell align="right" className="space-x-2">
                          {p.status === "open" && !hasChecklist && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!!busy}
                              onClick={() => closePeriod(p.id, false, true)}
                            >
                              Close period
                            </Button>
                          )}
                          {p.status === "closed" && latestClosed?.id === p.id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!!busy}
                              onClick={() => reopenPeriod(p.id)}
                            >
                              Reopen
                            </Button>
                          )}
                        </DataTableCell>
                      )}
                    </DataTableRow>
                  );
                })
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>
    </div>
  );
}

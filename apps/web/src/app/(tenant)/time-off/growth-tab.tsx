"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
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
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ResponsiveTableLayout } from "@/components/layout/responsive-table-layout";
import { runHrMutation } from "@/lib/hr/mutations";
import type {
  PerformanceGoalRow,
  PerformanceReviewRow,
  MyGoalRow,
  MyOffboardingTaskRow,
  MyTrainingRow,
} from "@/lib/hr/types";

export function GrowthTab({
  organizationId,
  goals,
  reviews,
  training,
  offboardingTasks,
}: {
  organizationId: string;
  goals: MyGoalRow[];
  reviews: PerformanceReviewRow[];
  training: MyTrainingRow[];
  offboardingTasks: MyOffboardingTaskRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [progressEdits, setProgressEdits] = useState<Record<string, string>>({});

  async function updateProgress(goalId: string) {
    const pct = Number(progressEdits[goalId]);
    if (Number.isNaN(pct)) return;
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("update_goal_progress", {
          p_goal_id: goalId,
          p_progress_pct: pct,
          p_status: pct >= 100 ? "completed" : null,
        });
        return { error };
      },
      { successTitle: "Progress updated" }
    );
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      {offboardingTasks.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-semibold">Exit checklist</h3>
          <p className="text-sm text-muted-foreground">Tasks to complete before your last working day.</p>
          {offboardingTasks.map((t) => (
            <div key={t.id} className="rounded-lg border p-4">
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="font-medium">{t.title}</p>
                <StatusBadge status={t.status} />
              </div>
              <p className="text-xs text-muted-foreground capitalize">
                {t.category}
                {t.due_date ? ` · due ${t.due_date}` : ""}
              </p>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="font-semibold">My goals</h3>
        {goals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active goals assigned yet.</p>
        ) : (
          goals.map((g) => (
            <div key={g.id} className="rounded-lg border p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="font-medium">{g.title}</p>
                <StatusBadge status={g.status} />
              </div>
              {g.description && <p className="mb-2 text-sm text-muted-foreground">{g.description}</p>}
              <p className="text-sm">
                Progress: <span className="font-semibold">{g.progress_pct}%</span>
                {g.target_date ? ` · due ${g.target_date}` : ""}
              </p>
              {g.status === "active" && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Update %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      className="h-9 w-24"
                      value={progressEdits[g.id] ?? String(g.progress_pct)}
                      onChange={(e) => setProgressEdits((p) => ({ ...p, [g.id]: e.target.value }))}
                    />
                  </div>
                  <Button size="sm" disabled={busy} onClick={() => void updateProgress(g.id)}>
                    Save
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">My reviews</h3>
        <ResponsiveTableLayout
          mobile={
            reviews.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No performance reviews yet.</p>
            ) : (
              reviews.map((r) => (
                <MobileRecordCard key={r.id}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="font-semibold">{r.cycle_name}</p>
                    <StatusBadge status={r.status} />
                  </div>
                  <MobileRecordCardRow label="Period">
                    {r.period_start} → {r.period_end}
                  </MobileRecordCardRow>
                  <MobileRecordCardRow label="Rating">{r.overall_rating ?? "—"}</MobileRecordCardRow>
                </MobileRecordCard>
              ))
            )
          }
        >
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Cycle</DataTableHead>
                <DataTableHead>Period</DataTableHead>
                <DataTableHead>Rating</DataTableHead>
                <DataTableHead>Status</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {reviews.length === 0 ? (
                  <DataTableEmpty colSpan={4} message="No performance reviews yet." />
                ) : (
                  reviews.map((r) => (
                    <DataTableRow key={r.id}>
                      <DataTableCell className="font-medium">{r.cycle_name}</DataTableCell>
                      <DataTableCell>
                        {r.period_start} → {r.period_end}
                      </DataTableCell>
                      <DataTableCell>{r.overall_rating ?? "—"}</DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={r.status} />
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ResponsiveTableLayout>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">My training</h3>
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Course</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead>Completed</DataTableHead>
              <DataTableHead align="right">Score</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {training.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No training records yet." />
              ) : (
                training.map((t) => (
                  <DataTableRow key={t.id}>
                    <DataTableCell className="font-medium">
                      {t.course_name}
                      {t.is_mandatory && <span className="ml-2 text-xs text-amber-600">Required</span>}
                    </DataTableCell>
                    <DataTableCell>
                      <StatusBadge status={t.status} />
                    </DataTableCell>
                    <DataTableCell>{t.completed_at ?? "—"}</DataTableCell>
                    <DataTableCell align="right">{t.score ?? "—"}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </section>
    </div>
  );
}

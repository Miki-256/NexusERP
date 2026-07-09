"use client";

import { useCallback, useEffect, useState } from "react";
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
  EmployeeTrainingRow,
  PerformanceGoalRow,
  PerformanceReviewDetail,
  PerformanceReviewRow,
  ReviewCycleRow,
  SkillRow,
  TrainingCourseRow,
} from "@/lib/hr/types";
import { Play, Plus, Target } from "lucide-react";

type PerfTab = "goals" | "reviews" | "skills" | "training";

export function PerformanceTab({
  organizationId,
  employees,
  cycles: initialCycles,
  goals: initialGoals,
  goalTotal,
  reviews: initialReviews,
  reviewTotal,
  skills: initialSkills,
  courses: initialCourses,
  training: initialTraining,
  trainingTotal,
}: {
  organizationId: string;
  employees: { id: string; name: string }[];
  cycles: ReviewCycleRow[];
  goals: PerformanceGoalRow[];
  goalTotal: number;
  reviews: PerformanceReviewRow[];
  reviewTotal: number;
  skills: SkillRow[];
  courses: TrainingCourseRow[];
  training: EmployeeTrainingRow[];
  trainingTotal: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<PerfTab>("goals");
  const [busy, setBusy] = useState(false);
  const [cycles, setCycles] = useState(initialCycles);
  const [goals, setGoals] = useState(initialGoals);
  const [reviews, setReviews] = useState(initialReviews);
  const [skills] = useState(initialSkills);
  const [courses] = useState(initialCourses);
  const [training, setTraining] = useState(initialTraining);
  const [selectedReview, setSelectedReview] = useState<PerformanceReviewDetail | null>(null);
  const [reviewDraft, setReviewDraft] = useState<Record<string, string>>({});

  const [goalEmployeeId, setGoalEmployeeId] = useState(employees[0]?.id ?? "");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [cycleName, setCycleName] = useState("");
  const [cycleStart, setCycleStart] = useState("");
  const [cycleEnd, setCycleEnd] = useState("");
  const [skillEmployeeId, setSkillEmployeeId] = useState(employees[0]?.id ?? "");
  const [skillId, setSkillId] = useState(skills[0]?.id ?? "");
  const [trainEmployeeId, setTrainEmployeeId] = useState(employees[0]?.id ?? "");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");

  const refresh = useCallback(() => router.refresh(), [router]);

  useEffect(() => {
    setCycles(initialCycles);
    setGoals(initialGoals);
    setReviews(initialReviews);
    setTraining(initialTraining);
  }, [initialCycles, initialGoals, initialReviews, initialTraining]);

  async function createGoal(e: React.FormEvent) {
    e.preventDefault();
    if (!goalEmployeeId || !goalTitle.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("create_performance_goal", {
          p_org_id: organizationId,
          p_employee_id: goalEmployeeId,
          p_title: goalTitle.trim(),
          p_target_date: goalTarget || null,
        });
        return { error };
      },
      { successTitle: "Goal created" }
    );
    setBusy(false);
    if (ok) {
      setGoalTitle("");
      setGoalTarget("");
      refresh();
    }
  }

  async function updateProgress(goalId: string, progress: number) {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("update_goal_progress", {
          p_goal_id: goalId,
          p_progress_pct: progress,
          p_status: progress >= 100 ? "completed" : null,
        });
        return { error };
      },
      { successTitle: "Progress updated" }
    );
    setBusy(false);
    refresh();
  }

  async function createCycle(e: React.FormEvent) {
    e.preventDefault();
    if (!cycleName.trim() || !cycleStart || !cycleEnd) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("create_review_cycle", {
          p_org_id: organizationId,
          p_name: cycleName.trim(),
          p_period_start: cycleStart,
          p_period_end: cycleEnd,
        });
        return { error };
      },
      { successTitle: "Review cycle created" }
    );
    setBusy(false);
    if (ok) {
      setCycleName("");
      refresh();
    }
  }

  async function activateCycle(cycleId: string) {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("activate_review_cycle", { p_cycle_id: cycleId });
    setBusy(false);
    if (error) {
      toast({ title: "Activation failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Cycle activated", description: `${data ?? 0} review(s) created.` });
    refresh();
  }

  async function openReview(reviewId: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_performance_review", { p_review_id: reviewId });
    if (error || !data) {
      toast({ title: "Could not load review", description: error?.message, variant: "destructive" });
      return;
    }
    const detail = data as PerformanceReviewDetail;
    setSelectedReview(detail);
    const draft: Record<string, string> = {};
    for (const r of detail.ratings) {
      draft[`self_${r.criteria_code}`] = r.self_rating != null ? String(r.self_rating) : "";
      draft[`mgr_${r.criteria_code}`] = r.manager_rating != null ? String(r.manager_rating) : "";
    }
    draft.self_comments = detail.review.self_comments ?? "";
    draft.manager_comments = detail.review.manager_comments ?? "";
    draft.overall_rating = detail.review.overall_rating != null ? String(detail.review.overall_rating) : "";
    setReviewDraft(draft);
  }

  async function saveReview(asManager: boolean) {
    if (!selectedReview) return;
    setBusy(true);
    const supabase = createClient();
    const ratings = selectedReview.ratings.map((r) => ({
      criteria_code: r.criteria_code,
      rating: Number(asManager ? reviewDraft[`mgr_${r.criteria_code}`] : reviewDraft[`self_${r.criteria_code}`]) || null,
    }));

    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        if (asManager) {
          const { error } = await supabase.rpc("save_performance_review_manager", {
            p_review_id: selectedReview.review.id,
            p_manager_comments: reviewDraft.manager_comments || null,
            p_overall_rating: reviewDraft.overall_rating ? Number(reviewDraft.overall_rating) : null,
            p_ratings: ratings,
          });
          return { error };
        }
        const { error } = await supabase.rpc("save_performance_review_self", {
          p_review_id: selectedReview.review.id,
          p_self_comments: reviewDraft.self_comments || null,
          p_ratings: ratings,
        });
        return { error };
      },
      { successTitle: "Review saved" }
    );
    setBusy(false);
    if (ok) void openReview(selectedReview.review.id);
  }

  async function submitReview(asManager: boolean) {
    if (!selectedReview) return;
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("submit_performance_review", {
          p_review_id: selectedReview.review.id,
          p_as_manager: asManager,
        });
        return { error };
      },
      { successTitle: asManager ? "Submitted for approval" : "Sent to manager" }
    );
    setBusy(false);
    refresh();
    void openReview(selectedReview.review.id);
  }

  async function approveReviewWorkflow() {
    if (!selectedReview) return;
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { data: wfData, error: wfError } = await supabase.rpc("approve_workflow_step", {
          p_entity_type: "performance_review",
          p_entity_id: selectedReview.review.id,
          p_approved: true,
        });
        if (wfError) return { error: wfError };
        const wf = wfData as { workflow?: boolean } | null;
        if (wf?.workflow) return { error: null };
        const { error } = await supabase.rpc("approve_performance_review", {
          p_review_id: selectedReview.review.id,
        });
        return { error };
      },
      { successTitle: "Review approved" }
    );
    setBusy(false);
    refresh();
    void openReview(selectedReview.review.id);
  }

  async function assignSkill(e: React.FormEvent) {
    e.preventDefault();
    if (!skillEmployeeId || !skillId) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("set_employee_skill", {
          p_org_id: organizationId,
          p_employee_id: skillEmployeeId,
          p_skill_id: skillId,
        });
        return { error };
      },
      { successTitle: "Skill recorded" }
    );
    setBusy(false);
    if (ok) refresh();
  }

  async function recordTraining(e: React.FormEvent) {
    e.preventDefault();
    if (!trainEmployeeId || !courseId) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("record_employee_training", {
          p_org_id: organizationId,
          p_employee_id: trainEmployeeId,
          p_course_id: courseId,
          p_status: "planned",
        });
        return { error };
      },
      { successTitle: "Training assigned" }
    );
    setBusy(false);
    if (ok) refresh();
  }

  return (
    <div className="space-y-6">
      <TabBar
        tabs={[
          { key: "goals" as const, label: "Goals" },
          { key: "reviews" as const, label: "Reviews" },
          { key: "skills" as const, label: "Skills" },
          { key: "training" as const, label: "Training" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "goals" && (
        <div className="space-y-6">
          <FormCard title="New goal" onSubmit={createGoal}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label>Employee</Label>
                <select className={SELECT_CLS} value={goalEmployeeId} onChange={(e) => setGoalEmployeeId(e.target.value)}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Title</Label>
                <Input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder="Increase sales by 10%" />
              </div>
              <div className="space-y-2">
                <Label>Target date</Label>
                <DatePicker value={goalTarget} onChange={setGoalTarget} />
              </div>
            </div>
            <Button type="submit" disabled={busy || !goalTitle.trim()}>
              <Plus className="h-4 w-4" />
              Add goal
            </Button>
          </FormCard>

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Employee</DataTableHead>
                <DataTableHead>Goal</DataTableHead>
                <DataTableHead>Target</DataTableHead>
                <DataTableHead>Progress</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead align="right">Update</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {goals.length === 0 ? (
                  <DataTableEmpty colSpan={6} message="No goals yet." />
                ) : (
                  goals.map((g) => (
                    <DataTableRow key={g.id}>
                      <DataTableCell className="font-medium">{g.employee_name}</DataTableCell>
                      <DataTableCell>{g.title}</DataTableCell>
                      <DataTableCell>{g.target_date ?? "—"}</DataTableCell>
                      <DataTableCell>{g.progress_pct}%</DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={g.status} />
                      </DataTableCell>
                      <DataTableCell align="right">
                        {g.status === "active" && (
                          <div className="flex justify-end gap-1">
                            {[25, 50, 75, 100].map((p) => (
                              <Button key={p} size="sm" variant="outline" disabled={busy} onClick={() => void updateProgress(g.id, p)}>
                                {p}%
                              </Button>
                            ))}
                          </div>
                        )}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
          <p className="text-xs text-muted-foreground">{goalTotal} goal(s) total</p>
        </div>
      )}

      {tab === "reviews" && (
        <div className="space-y-6">
          <FormCard title="Review cycle" onSubmit={createCycle}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Name</Label>
                <Input value={cycleName} onChange={(e) => setCycleName(e.target.value)} placeholder="H1 2026 review" />
              </div>
              <div className="space-y-2">
                <Label>Period start</Label>
                <DatePicker value={cycleStart} onChange={setCycleStart} max={cycleEnd || undefined} />
              </div>
              <div className="space-y-2">
                <Label>Period end</Label>
                <DatePicker value={cycleEnd} onChange={setCycleEnd} min={cycleStart || undefined} />
              </div>
            </div>
            <Button type="submit" disabled={busy || !cycleName.trim()}>
              <Target className="h-4 w-4" />
              Create cycle
            </Button>
          </FormCard>

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Cycle</DataTableHead>
                <DataTableHead>Period</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead>Reviews</DataTableHead>
                <DataTableHead align="right">Action</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {cycles.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No review cycles yet." />
                ) : (
                  cycles.map((c) => (
                    <DataTableRow key={c.id}>
                      <DataTableCell className="font-medium">{c.name}</DataTableCell>
                      <DataTableCell>
                        {c.period_start} → {c.period_end}
                      </DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={c.status} />
                      </DataTableCell>
                      <DataTableCell>{c.review_count}</DataTableCell>
                      <DataTableCell align="right">
                        {c.status === "draft" && (
                          <Button size="sm" disabled={busy} onClick={() => void activateCycle(c.id)}>
                            <Play className="h-4 w-4" />
                            Launch
                          </Button>
                        )}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>

          <div className="space-y-3">
            <h3 className="font-semibold">Reviews</h3>
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Employee</DataTableHead>
                  <DataTableHead>Cycle</DataTableHead>
                  <DataTableHead>Reviewer</DataTableHead>
                  <DataTableHead>Rating</DataTableHead>
                  <DataTableHead>Status</DataTableHead>
                  <DataTableHead align="right">Open</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {reviews.length === 0 ? (
                    <DataTableEmpty colSpan={6} message="No reviews yet. Launch a cycle first." />
                  ) : (
                    reviews.map((r) => (
                      <DataTableRow key={r.id}>
                        <DataTableCell className="font-medium">{r.employee_name}</DataTableCell>
                        <DataTableCell>{r.cycle_name}</DataTableCell>
                        <DataTableCell>{r.reviewer_name ?? "—"}</DataTableCell>
                        <DataTableCell>{r.overall_rating ?? "—"}</DataTableCell>
                        <DataTableCell>
                          <StatusBadge status={r.status} />
                        </DataTableCell>
                        <DataTableCell align="right">
                          <Button size="sm" variant="outline" onClick={() => void openReview(r.id)}>
                            View
                          </Button>
                        </DataTableCell>
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>
            <p className="text-xs text-muted-foreground">{reviewTotal} review(s) total</p>
          </div>

          {selectedReview && (
            <FormCard title="Review detail">
              <p className="mb-4 text-sm text-muted-foreground">
                Status: <StatusBadge status={selectedReview.review.status} />
              </p>
              <div className="space-y-4">
                {selectedReview.ratings.map((r) => (
                  <div key={r.criteria_code} className="grid gap-2 sm:grid-cols-3">
                    <p className="font-medium">{r.criteria_name}</p>
                    {(selectedReview.is_self || selectedReview.can_manage) && (
                      <div className="space-y-1">
                        <Label className="text-xs">Self (1–5)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={5}
                          step={0.5}
                          value={reviewDraft[`self_${r.criteria_code}`] ?? ""}
                          onChange={(e) =>
                            setReviewDraft((d) => ({ ...d, [`self_${r.criteria_code}`]: e.target.value }))
                          }
                        />
                      </div>
                    )}
                    {(selectedReview.is_manager || selectedReview.can_manage) && (
                      <div className="space-y-1">
                        <Label className="text-xs">Manager (1–5)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={5}
                          step={0.5}
                          value={reviewDraft[`mgr_${r.criteria_code}`] ?? ""}
                          onChange={(e) =>
                            setReviewDraft((d) => ({ ...d, [`mgr_${r.criteria_code}`]: e.target.value }))
                          }
                        />
                      </div>
                    )}
                  </div>
                ))}
                {(selectedReview.is_self || selectedReview.can_manage) && (
                  <div className="space-y-2">
                    <Label>Self comments</Label>
                    <Input
                      value={reviewDraft.self_comments ?? ""}
                      onChange={(e) => setReviewDraft((d) => ({ ...d, self_comments: e.target.value }))}
                    />
                  </div>
                )}
                {(selectedReview.is_manager || selectedReview.can_manage) && (
                  <>
                    <div className="space-y-2">
                      <Label>Manager comments</Label>
                      <Input
                        value={reviewDraft.manager_comments ?? ""}
                        onChange={(e) => setReviewDraft((d) => ({ ...d, manager_comments: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Overall rating</Label>
                      <Input
                        type="number"
                        min={1}
                        max={5}
                        step={0.5}
                        className="max-w-[120px]"
                        value={reviewDraft.overall_rating ?? ""}
                        onChange={(e) => setReviewDraft((d) => ({ ...d, overall_rating: e.target.value }))}
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(selectedReview.is_self || selectedReview.can_manage) && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => void saveReview(false)}>
                      Save self
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void submitReview(false)}>
                      Submit to manager
                    </Button>
                  </>
                )}
                {(selectedReview.is_manager || selectedReview.can_manage) && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => void saveReview(true)}>
                      Save manager
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void submitReview(true)}>
                      Submit for approval
                    </Button>
                  </>
                )}
                {selectedReview.can_manage && selectedReview.review.status === "submitted" && (
                  <Button size="sm" disabled={busy} onClick={() => void approveReviewWorkflow()}>
                    Approve
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelectedReview(null)}>
                  Close
                </Button>
              </div>
            </FormCard>
          )}
        </div>
      )}

      {tab === "skills" && (
        <div className="space-y-6">
          <FormCard title="Assign skill" onSubmit={assignSkill}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Employee</Label>
                <select className={SELECT_CLS} value={skillEmployeeId} onChange={(e) => setSkillEmployeeId(e.target.value)}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Skill</Label>
                <select className={SELECT_CLS} value={skillId} onChange={(e) => setSkillId(e.target.value)}>
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.category ? `(${s.category})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" disabled={busy || !skillId}>
              Assign
            </Button>
          </FormCard>
          <p className="text-sm text-muted-foreground">{skills.length} skill(s) in catalog</p>
        </div>
      )}

      {tab === "training" && (
        <div className="space-y-6">
          <FormCard title="Assign training" onSubmit={recordTraining}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Employee</Label>
                <select className={SELECT_CLS} value={trainEmployeeId} onChange={(e) => setTrainEmployeeId(e.target.value)}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Course</Label>
                <select className={SELECT_CLS} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.is_mandatory ? "(required)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" disabled={busy || !courseId}>
              Assign
            </Button>
          </FormCard>

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Employee</DataTableHead>
                <DataTableHead>Course</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead>Completed</DataTableHead>
                <DataTableHead align="right">Score</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {training.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No training records yet." />
                ) : (
                  training.map((t) => (
                    <DataTableRow key={t.id}>
                      <DataTableCell className="font-medium">{t.employee_name}</DataTableCell>
                      <DataTableCell>{t.course_name}</DataTableCell>
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
          <p className="text-xs text-muted-foreground">{trainingTotal} record(s) total</p>
        </div>
      )}
    </div>
  );
}

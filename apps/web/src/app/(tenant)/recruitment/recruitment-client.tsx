"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
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
import { relationName } from "@/lib/utils";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Pencil } from "lucide-react";
import type { JobRow, ApplicantRow } from "./page";

type JobFormMode = "closed" | "create" | "edit";

export function RecruitmentClient({
  organizationId,
  jobs,
  applicants,
}: {
  organizationId: string;
  jobs: JobRow[];
  applicants: ApplicantRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<"jobs" | "applicants">("jobs");
  const [jobFormMode, setJobFormMode] = useState<JobFormMode>("closed");
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dept, setDept] = useState("");
  const [positionId, setPositionId] = useState(jobs[0]?.id ?? "");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function addJob(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const supabase = createClient();
    if (jobFormMode === "edit" && editingJobId) {
      const { error } = await supabase
        .from("job_positions")
        .update({ title: title.trim(), department: dept || null })
        .eq("id", editingJobId);
      setBusy(false);
      if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
      toast({ title: "Job updated" });
    } else {
      const { error } = await supabase.from("job_positions").insert({
        organization_id: organizationId,
        title: title.trim(),
        department: dept || null,
      });
      setBusy(false);
      if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
      toast({ title: "Job posted" });
    }
    setTitle("");
    setDept("");
    setEditingJobId(null);
    setJobFormMode("closed");
    router.refresh();
  }

  function openEditJob(j: JobRow) {
    setEditingJobId(j.id);
    setTitle(j.title);
    setDept(j.department ?? "");
    setJobFormMode("edit");
  }

  function resetJobForm() {
    setTitle("");
    setDept("");
    setEditingJobId(null);
    setJobFormMode("closed");
  }

  async function addApplicant(e: React.FormEvent) {
    e.preventDefault();
    if (!positionId || !fullName.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("job_applicants").insert({
      organization_id: organizationId,
      position_id: positionId,
      full_name: fullName.trim(),
      email: email || null,
    });
    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Applicant added" });
    setFullName("");
    router.refresh();
  }

  async function setApplicantStatus(id: string, status: string) {
    const supabase = createClient();
    await supabase.from("job_applicants").update({ status }).eq("id", id);
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader title="Recruitment" description="Open positions and applicants" />
      <TabBar
        tabs={[
          { key: "jobs" as const, label: "Jobs" },
          { key: "applicants" as const, label: "Applicants" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "jobs" && jobFormMode !== "closed" && (
        <FormCard title={jobFormMode === "edit" ? "Edit job" : "New job"} onSubmit={addJob}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={dept} onChange={(e) => setDept(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {jobFormMode === "edit" ? "Save changes" : "Post job"}
            </Button>
            <Button type="button" variant="outline" onClick={resetJobForm}>
              Cancel
            </Button>
          </div>
        </FormCard>
      )}

      {tab === "jobs" && jobFormMode === "closed" && (
        <div className="mb-4">
          <Button onClick={() => setJobFormMode("create")}>New job</Button>
        </div>
      )}

      {tab === "applicants" && (
        <FormCard title="New applicant" onSubmit={addApplicant}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Position</Label>
              <select className={SELECT_CLS} value={positionId} onChange={(e) => setPositionId(e.target.value)}>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={busy}>Add applicant</Button>
        </FormCard>
      )}

      {tab === "jobs" ? (
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Title</DataTableHead>
              <DataTableHead>Department</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Actions</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {jobs.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No open jobs." />
              ) : (
                jobs.map((j) => (
                  <DataTableRow key={j.id}>
                    <DataTableCell className="font-medium">{j.title}</DataTableCell>
                    <DataTableCell>{j.department ?? "—"}</DataTableCell>
                    <DataTableCell><StatusBadge status={j.is_open ? "open" : "closed"} /></DataTableCell>
                    <DataTableCell align="right">
                      <Button size="sm" variant="outline" onClick={() => openEditJob(j)}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      ) : (
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead>Position</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Advance</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {applicants.length === 0 ? <DataTableEmpty colSpan={4} message="No applicants." /> : applicants.map((a) => (
                <DataTableRow key={a.id}>
                  <DataTableCell className="font-medium">{a.full_name}</DataTableCell>
                  <DataTableCell>
                    {Array.isArray(a.job_positions)
                      ? a.job_positions[0]?.title
                      : a.job_positions?.title ?? "—"}
                  </DataTableCell>
                  <DataTableCell><StatusBadge status={a.status} /></DataTableCell>
                  <DataTableCell align="right">
                    {a.status === "new" && <Button size="sm" variant="outline" onClick={() => setApplicantStatus(a.id, "interview")}>Interview</Button>}
                    {a.status === "interview" && <Button size="sm" onClick={() => setApplicantStatus(a.id, "offer")}>Offer</Button>}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </table>
        </DataTable>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ResponsiveTableLayout } from "@/components/layout/responsive-table-layout";
import { relationName } from "@/lib/utils";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { TablePagination, TableToolbar } from "@/components/layout/table-toolbar";
import { Pencil, ExternalLink } from "lucide-react";
import type { JobRow, ApplicantRow } from "./page";
import type { JobRequisitionRow, OnboardingTaskRow } from "@/lib/hr/types";
import { RequisitionsTab } from "./requisitions-tab";
import { OnboardingTab } from "./onboarding-tab";

type RecruitmentTab = "requisitions" | "jobs" | "applicants" | "onboarding";

type JobFormMode = "closed" | "create" | "edit";

export function RecruitmentClient({
  organizationId,
  canManage,
  jobs,
  jobsTotal,
  jobsPage,
  applicants,
  applicantsTotal,
  applicantsPage,
  jobsPageSize,
  applicantsPageSize,
  search,
  applicantStatusFilter,
  requisitions,
  requisitionsTotal,
  requisitionsPage,
  onboardingTasks,
  onboardingTotal,
  onboardingPage,
  orgUnits,
}: {
  organizationId: string;
  canManage: boolean;
  jobs: JobRow[];
  jobsTotal: number;
  jobsPage: number;
  applicants: ApplicantRow[];
  applicantsTotal: number;
  applicantsPage: number;
  jobsPageSize: number;
  applicantsPageSize: number;
  search: string;
  applicantStatusFilter: string | null;
  requisitions: JobRequisitionRow[];
  requisitionsTotal: number;
  requisitionsPage: number;
  onboardingTasks: OnboardingTaskRow[];
  onboardingTotal: number;
  onboardingPage: number;
  orgUnits: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [tab, setTab] = useState<RecruitmentTab>("jobs");
  const [jobFormMode, setJobFormMode] = useState<JobFormMode>("closed");
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dept, setDept] = useState("");
  const [positionId, setPositionId] = useState(jobs[0]?.id ?? "");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchInput, setSearchInput] = useState(search);
  const [applicantFilterOpen, setApplicantFilterOpen] = useState(false);

  function setQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    router.push(`/recruitment?${params.toString()}`);
  }

  const jobsTotalPages = Math.max(1, Math.ceil(jobsTotal / jobsPageSize));
  const applicantsTotalPages = Math.max(1, Math.ceil(applicantsTotal / applicantsPageSize));

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

  return (
    <div className={PAGE_SHELL}>
      <PageHeader title="Recruitment" description="Open positions and applicants" />
      <TabBar
        tabs={[
          ...(canManage ? [{ key: "requisitions" as const, label: "Requisitions" }] : []),
          { key: "jobs" as const, label: "Jobs" },
          { key: "applicants" as const, label: "Applicants" },
          { key: "onboarding" as const, label: "Onboarding" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "requisitions" && canManage && (
        <RequisitionsTab
          organizationId={organizationId}
          canManage={canManage}
          requisitions={requisitions}
          total={requisitionsTotal}
          page={requisitionsPage}
          pageSize={jobsPageSize}
          orgUnits={orgUnits}
          onPageChange={(p) => setQuery({ requisitionsPage: String(p) })}
          onChanged={() => router.refresh()}
        />
      )}

      {tab === "onboarding" && (
        <OnboardingTab
          organizationId={organizationId}
          canManage={canManage}
          tasks={onboardingTasks}
          total={onboardingTotal}
          page={onboardingPage}
          pageSize={applicantsPageSize}
          onPageChange={(p) => setQuery({ onboardingPage: String(p) })}
          onChanged={() => router.refresh()}
        />
      )}

      {tab === "jobs" && canManage && jobFormMode !== "closed" && (
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

      {tab === "jobs" && canManage && jobFormMode === "closed" && (
        <div className="mb-4">
          <Button onClick={() => setJobFormMode("create")}>New job</Button>
        </div>
      )}

      {tab === "jobs" && (
        <TableToolbar
          search={searchInput}
          placeholder="Search jobs…"
          onSearchChange={setSearchInput}
          onSearchSubmit={() => setQuery({ q: searchInput || null, jobsPage: "1" })}
        />
      )}

      {tab === "applicants" && canManage && (
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

      {tab === "applicants" && (
        <TableToolbar
          filterOpen={applicantFilterOpen}
          onFilterOpenChange={setApplicantFilterOpen}
          filterActive={!!applicantStatusFilter}
          filterContent={
            <select
              className={SELECT_CLS + " h-9 min-w-[140px]"}
              value={applicantStatusFilter ?? ""}
              onChange={(e) =>
                setQuery({ applicantStatus: e.target.value || null, applicantsPage: "1" })
              }
            >
              <option value="">All statuses</option>
              <option value="new">New</option>
              <option value="interview">Interview</option>
              <option value="offer">Offer</option>
              <option value="hired">Hired</option>
              <option value="refused">Refused</option>
            </select>
          }
        />
      )}

      {tab === "jobs" ? (
        <>
        <ResponsiveTableLayout
          mobile={
            jobs.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No open jobs.</p>
            ) : (
              jobs.map((j) => (
                <MobileRecordCard key={j.id}>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <p className="font-semibold">{j.title}</p>
                    <StatusBadge status={j.is_open ? "open" : "closed"} />
                  </div>
                  <MobileRecordCardRow label="Department">{j.department ?? "—"}</MobileRecordCardRow>
                  {canManage && (
                    <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => openEditJob(j)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                </MobileRecordCard>
              ))
            )
          }
        >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Title</DataTableHead>
              <DataTableHead>Department</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {jobs.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 4 : 3} message="No open jobs." />
              ) : (
                jobs.map((j) => (
                  <DataTableRow key={j.id}>
                    <DataTableCell className="font-medium">{j.title}</DataTableCell>
                    <DataTableCell>{j.department ?? "—"}</DataTableCell>
                    <DataTableCell><StatusBadge status={j.is_open ? "open" : "closed"} /></DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <Button size="sm" variant="outline" onClick={() => openEditJob(j)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
        </ResponsiveTableLayout>
        <TablePagination
          page={jobsPage}
          totalPages={jobsTotalPages}
          total={jobsTotal}
          onPageChange={(p) => setQuery({ jobsPage: String(p) })}
        />
        </>
      ) : (
        <>
        <ResponsiveTableLayout
          mobile={
            applicants.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No applicants.</p>
            ) : (
              applicants.map((a) => (
                <MobileRecordCard key={a.id}>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <p className="font-semibold">{a.full_name}</p>
                    <StatusBadge status={a.status} />
                  </div>
                  <MobileRecordCardRow label="Position">
                    {Array.isArray(a.job_positions) ? a.job_positions[0]?.title : a.job_positions?.title ?? "—"}
                  </MobileRecordCardRow>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" asChild>
                      <Link href={`/recruitment/applicants/${a.id}`}>
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Pipeline
                      </Link>
                    </Button>
                  </div>
                </MobileRecordCard>
              ))
            )
          }
        >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead>Position</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Advance</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {applicants.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 4 : 3} message="No applicants." />
              ) : (
                applicants.map((a) => (
                <DataTableRow key={a.id}>
                  <DataTableCell className="font-medium">
                    <Link href={`/recruitment/applicants/${a.id}`} className="hover:underline">
                      {a.full_name}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>
                    {Array.isArray(a.job_positions)
                      ? a.job_positions[0]?.title
                      : a.job_positions?.title ?? "—"}
                  </DataTableCell>
                  <DataTableCell><StatusBadge status={a.status} /></DataTableCell>
                  {canManage && (
                    <DataTableCell align="right">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/recruitment/applicants/${a.id}`}>
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          Pipeline
                        </Link>
                      </Button>
                    </DataTableCell>
                  )}
                </DataTableRow>
              )))}
            </DataTableBody>
          </table>
        </DataTable>
        </ResponsiveTableLayout>
        <TablePagination
          page={applicantsPage}
          totalPages={applicantsTotalPages}
          total={applicantsTotal}
          onPageChange={(p) => setQuery({ applicantsPage: String(p) })}
        />
        </>
      )}
    </div>
  );
}

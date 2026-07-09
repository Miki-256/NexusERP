import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { HR_JOBS_PAGE_SIZE, HR_RECRUITMENT_PAGE_SIZE } from "@/lib/hr/constants";
import { parsePaginatedRpc } from "@/lib/hr/mutations";
import type { ApplicantRow, JobRow, JobRequisitionRow, OnboardingTaskRow } from "@/lib/hr/types";
import { RecruitmentClient } from "./recruitment-client";

export type { JobRow, ApplicantRow };

export default async function RecruitmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    jobsPage?: string;
    applicantsPage?: string;
    applicantStatus?: string;
    requisitionsPage?: string;
    onboardingPage?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requireAppAccess("recruitment");
  const canManage = ctx.canManageApp("recruitment");

  const supabase = await createClient();
  const orgId = ctx.organization.id;
  const jobsPage = Math.max(1, Number(params.jobsPage) || 1);
  const applicantsPage = Math.max(1, Number(params.applicantsPage) || 1);
  const requisitionsPage = Math.max(1, Number(params.requisitionsPage) || 1);
  const onboardingPage = Math.max(1, Number(params.onboardingPage) || 1);
  const search = params.q?.trim() || null;
  const applicantStatus =
    params.applicantStatus === "new" ||
    params.applicantStatus === "interview" ||
    params.applicantStatus === "offer" ||
    params.applicantStatus === "hired" ||
    params.applicantStatus === "refused"
      ? params.applicantStatus
      : null;

  const [{ data: jobsPageData }, { data: applicantsPageData }, { data: requisitionsData }, { data: onboardingData }, { data: orgUnits }] =
    await Promise.all([
    supabase.rpc("list_job_positions", {
      p_org_id: orgId,
      p_search: search,
      p_limit: HR_JOBS_PAGE_SIZE,
      p_offset: (jobsPage - 1) * HR_JOBS_PAGE_SIZE,
    }),
    supabase.rpc("list_job_applicants", {
      p_org_id: orgId,
      p_status: applicantStatus,
      p_limit: HR_RECRUITMENT_PAGE_SIZE,
      p_offset: (applicantsPage - 1) * HR_RECRUITMENT_PAGE_SIZE,
    }),
    canManage
      ? supabase.rpc("list_job_requisitions", {
          p_org_id: orgId,
          p_limit: HR_RECRUITMENT_PAGE_SIZE,
          p_offset: (requisitionsPage - 1) * HR_RECRUITMENT_PAGE_SIZE,
        })
      : Promise.resolve({ data: null }),
    supabase.rpc("list_onboarding_tasks", {
      p_org_id: orgId,
      p_limit: HR_RECRUITMENT_PAGE_SIZE,
      p_offset: (onboardingPage - 1) * HR_RECRUITMENT_PAGE_SIZE,
    }),
    canManage
      ? supabase.rpc("list_org_units", { p_org_id: orgId })
      : Promise.resolve({ data: [] }),
  ]);

  const jobs = parsePaginatedRpc<JobRow>(jobsPageData);
  const applicants = parsePaginatedRpc<ApplicantRow>(applicantsPageData);
  const requisitions = parsePaginatedRpc<JobRequisitionRow>(requisitionsData);
  const onboarding = parsePaginatedRpc<OnboardingTaskRow>(onboardingData);

  return (
    <RecruitmentClient
      organizationId={orgId}
      canManage={canManage}
      jobs={jobs.items}
      jobsTotal={jobs.total_count}
      jobsPage={jobsPage}
      applicants={applicants.items}
      applicantsTotal={applicants.total_count}
      applicantsPage={applicantsPage}
      jobsPageSize={HR_JOBS_PAGE_SIZE}
      applicantsPageSize={HR_RECRUITMENT_PAGE_SIZE}
      search={search ?? ""}
      applicantStatusFilter={applicantStatus}
      requisitions={requisitions.items}
      requisitionsTotal={requisitions.total_count}
      requisitionsPage={requisitionsPage}
      onboardingTasks={onboarding.items}
      onboardingTotal={onboarding.total_count}
      onboardingPage={onboardingPage}
      orgUnits={(orgUnits as { id: string; name: string }[]) ?? []}
    />
  );
}

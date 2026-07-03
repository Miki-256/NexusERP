import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { RecruitmentClient } from "./recruitment-client";

export type JobRow = {
  id: string;
  title: string;
  department: string | null;
  is_open: boolean;
};

export type ApplicantRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  job_positions: { title: string } | { title: string }[] | null;
};

export default async function RecruitmentPage() {
  const ctx = await requireAppAccess("recruitment");

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: jobs }, { data: applicants }] = await Promise.all([
    supabase.from("job_positions").select("id, title, department, is_open").eq("organization_id", orgId).order("title"),
    supabase
      .from("job_applicants")
      .select("id, full_name, email, phone, status, job_positions(title)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  return (
    <RecruitmentClient
      organizationId={orgId}
      jobs={(jobs as JobRow[]) ?? []}
      applicants={(applicants as unknown as ApplicantRow[]) ?? []}
    />
  );
}

import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { ApplicantPipeline } from "@/lib/hr/types";
import { ApplicantPipelineClient } from "./applicant-pipeline-client";

export default async function ApplicantPipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAppAccess("recruitment");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_applicant_pipeline", { p_applicant_id: id });
  if (error || !data) notFound();

  const pipeline = data as ApplicantPipeline;

  const [{ data: employees }, { data: orgUnits }] = await Promise.all([
    supabase.rpc("list_hr_employees", { p_org_id: ctx.organization.id, p_limit: 500, p_offset: 0 }),
    supabase.rpc("list_org_units", { p_org_id: ctx.organization.id }),
  ]);

  const employeeList =
    ((employees as { items?: { id: string; name: string }[] } | null)?.items ?? []) as {
      id: string;
      name: string;
    }[];

  return (
    <ApplicantPipelineClient
      organizationId={ctx.organization.id}
      pipeline={pipeline}
      employees={employeeList}
      orgUnits={(orgUnits as { id: string; name: string }[]) ?? []}
    />
  );
}

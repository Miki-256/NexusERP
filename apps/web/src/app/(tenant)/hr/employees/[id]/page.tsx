import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import type { Employee360 } from "@/lib/hr/types";
import { EmployeeProfileClient } from "./employee-profile-client";

export default async function EmployeeProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAppAccess("hr");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_employee_360", { p_employee_id: id });
  if (error || !data) {
    if (error?.message?.includes("Access denied")) redirect("/hr");
    notFound();
  }

  const profile = data as Employee360;
  if (profile.employee.organization_id !== ctx.organization.id) notFound();

  const [{ data: orgUnits }, { data: employeeList }, { data: stores }] = await Promise.all([
    supabase.rpc("list_org_units", { p_org_id: ctx.organization.id }),
    supabase.rpc("list_hr_employees", {
      p_org_id: ctx.organization.id,
      p_limit: 500,
      p_offset: 0,
    }),
    supabase.from("stores").select("id, name").eq("organization_id", ctx.organization.id).order("name"),
  ]);

  const employees =
    ((employeeList as { items?: { id: string; name: string }[] } | null)?.items ?? []) as {
      id: string;
      name: string;
    }[];

  return (
    <EmployeeProfileClient
      organizationId={ctx.organization.id}
      currency={ctx.organization.currency}
      initial={profile}
      orgUnits={(orgUnits as { id: string; name: string }[]) ?? []}
      employees={employees}
      stores={(stores as { id: string; name: string }[]) ?? []}
    />
  );
}

import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { TimeOffClient } from "./time-off-client";

export type LeaveRow = {
  id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  employees: { name: string } | { name: string }[] | null;
};

export default async function TimeOffPage() {
  const ctx = await requireAppAccess("timeoff");

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: leaves }, { data: employees }] = await Promise.all([
    supabase
      .from("leave_requests")
      .select("id, start_date, end_date, reason, status, employees(name)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("employees").select("id, name").eq("organization_id", orgId).eq("status", "active").order("name"),
  ]);

  return (
    <TimeOffClient
      organizationId={orgId}
      canManage={ctx.canManageApp("timeoff")}
      leaves={(leaves as unknown as LeaveRow[]) ?? []}
      employees={(employees as { id: string; name: string }[]) ?? []}
    />
  );
}

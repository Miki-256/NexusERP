import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminClient } from "./admin-client";

export type AdminOrg = {
  id: string;
  name: string;
  status: "pending" | "active" | "suspended";
  plan: string;
  currency: string;
  member_count: number;
  created_at: string;
};

export type PlatformAdmin = { user_id: string; email: string; created_at: string };

type Stats = {
  org_count: number;
  orgs_active: number;
  orgs_pending: number;
  orgs_suspended: number;
  member_count: number;
  sales_count: number;
  sales_total: number;
  admin_count: number;
};

export default async function AdminHome() {
  const supabase = await createClient();

  const [{ data: stats }, { data: orgs }, { data: admins }] = await Promise.all([
    supabase.rpc("admin_platform_stats"),
    supabase.rpc("admin_list_organizations"),
    supabase.rpc("admin_list_platform_admins"),
  ]);

  const s = (stats ?? {}) as Partial<Stats>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Platform Overview</h1>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Organizations" value={s.org_count ?? 0} />
        <Stat label="Active" value={s.orgs_active ?? 0} />
        <Stat label="Pending Approval" value={s.orgs_pending ?? 0} highlight={(s.orgs_pending ?? 0) > 0} />
        <Stat label="Suspended" value={s.orgs_suspended ?? 0} />
        <Stat label="Total Members" value={s.member_count ?? 0} />
        <Stat label="Completed Sales" value={s.sales_count ?? 0} />
        <Stat label="Gross Sales Volume" value={Math.round(s.sales_total ?? 0).toLocaleString()} />
        <Stat label="Platform Admins" value={s.admin_count ?? 0} />
      </div>

      <AdminClient
        orgs={(orgs as AdminOrg[]) ?? []}
        admins={(admins as PlatformAdmin[]) ?? []}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={"text-2xl font-bold " + (highlight ? "text-amber-600" : "")}>{value}</p>
      </CardContent>
    </Card>
  );
}

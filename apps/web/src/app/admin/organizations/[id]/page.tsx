import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { OrgDetail, OrgPlanUsage, PlatformPlan } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { OrgDetailClient } from "./org-detail-client";

export default async function AdminOrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();

  const [{ data, error }, { data: planUsage }, { data: plans }] = await Promise.all([
    supabase.rpc("admin_get_organization_detail", { p_org_id: id }),
    supabase.rpc("admin_get_org_plan_usage", { p_org_id: id }),
    supabase.rpc("admin_list_plans"),
  ]);

  if (error || !data) {
    notFound();
  }

  return (
    <OrgDetailClient
      detail={data as OrgDetail}
      planUsage={(planUsage ?? null) as OrgPlanUsage | null}
      plans={(plans ?? []) as PlatformPlan[]}
      canWrite={!!ctx?.canWrite}
    />
  );
}

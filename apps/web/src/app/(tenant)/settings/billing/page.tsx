import { createClient } from "@/lib/supabase/server";
import { requireAppAccess } from "@/lib/require-app-access";
import type { OrgPlanUsage, PlatformPlan } from "@/lib/admin-types";
import { BillingClient } from "./billing-client";

export default async function BillingPage() {
  const ctx = await requireAppAccess("settings");
  const supabase = await createClient();

  const [{ data: usage, error: usageError }, { data: plans }, { data: requests }] = await Promise.all([
    supabase.rpc("get_my_org_plan_usage", {
      p_organization_id: ctx.organization.id,
    }),
    supabase.rpc("list_public_plans"),
    supabase.rpc("list_my_plan_change_requests", {
      p_organization_id: ctx.organization.id,
    }),
  ]);

  if (usageError || !usage) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Could not load plan usage. Ensure subscription migrations are applied (
        <code className="text-xs">00030</code>, <code className="text-xs">00031</code>).
      </div>
    );
  }

  return (
    <BillingClient
      organizationId={ctx.organization.id}
      usage={usage as OrgPlanUsage}
      plans={(plans ?? []) as PlatformPlan[]}
      requests={(requests ?? []) as import("./billing-client").PlanChangeRequest[]}
      canManage={ctx.canManageApp("settings")}
    />
  );
}

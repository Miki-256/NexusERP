import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { PlatformPlan } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { PlansClient } from "./plans-client";

export default async function AdminPlansPage() {
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();
  const [{ data }, { data: requests }] = await Promise.all([
    supabase.rpc("admin_list_plans"),
    supabase.rpc("admin_list_plan_change_requests", { p_status: "pending" }),
  ]);

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Plans & limits"
        description="Subscription tiers and usage limits per organization (manual assignment — no Stripe)."
      />
      <PlansClient
        plans={(data ?? []) as PlatformPlan[]}
        pendingRequests={(requests ?? []) as import("./plans-client").PlanChangeRequestRow[]}
        canWrite={!!ctx?.canWrite}
      />
    </div>
  );
}

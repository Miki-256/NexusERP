import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { PlatformHealth } from "@/lib/admin-types";
import { HealthClient } from "./health-client";

export default async function AdminHealthPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_get_platform_health");

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Platform health"
        description="Table counts, background queues, tenant activity, and inactive organization signals."
      />
      <HealthClient data={(data ?? {}) as PlatformHealth} />
    </div>
  );
}

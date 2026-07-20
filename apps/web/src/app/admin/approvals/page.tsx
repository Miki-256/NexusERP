import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { AdminApproval } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { ApprovalsClient } from "./approvals-client";

export default async function AdminApprovalsPage() {
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();
  const [{ data: pending }, { data: recent }] = await Promise.all([
    supabase.rpc("admin_list_approvals", { p_status: "pending", p_limit: 50 }),
    supabase.rpc("admin_list_approvals", { p_status: "all", p_limit: 30 }),
  ]);

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Approvals"
        description="Dual-control queue for suspend and org export. A second write admin must approve."
      />
      <ApprovalsClient
        pending={(pending ?? []) as AdminApproval[]}
        recent={(recent ?? []) as AdminApproval[]}
        canWrite={!!ctx?.canWrite}
      />
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { PlatformAdmin } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { AdminsClient } from "./admins-client";

export default async function AdminAdminsPage() {
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();
  const { data: admins } = await supabase.rpc("admin_list_platform_admins");

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Platform administrators"
        description="Manage who can access the super admin console and what they can do."
      />
      <AdminsClient
        admins={(admins as PlatformAdmin[]) ?? []}
        canManageAdmins={!!ctx?.canManageAdmins}
      />
    </div>
  );
}

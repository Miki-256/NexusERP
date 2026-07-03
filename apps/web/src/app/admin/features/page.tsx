import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { PlatformFeatureFlag } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { FeaturesClient } from "./features-client";

export default async function AdminFeaturesPage() {
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_feature_flags");

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Feature flags"
        description="Globally enable or disable ERP modules for all tenants."
      />
      <FeaturesClient
        flags={(data ?? []) as PlatformFeatureFlag[]}
        canManage={!!ctx?.canManageAdmins}
      />
    </div>
  );
}

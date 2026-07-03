import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { AdminOrg } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { ImportClient } from "./import-client";

export default async function ImportPage() {
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();
  const { data: orgs } = await supabase.rpc("admin_list_organizations");

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Data import"
        description="Migrate customers and products into any organization (Base44 CSV format)."
      />
      <ImportClient orgs={(orgs as AdminOrg[]) ?? []} canWrite={!!ctx?.canWrite} />
    </div>
  );
}

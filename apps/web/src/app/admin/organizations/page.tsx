import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { AdminOrg } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { OrganizationsClient } from "./organizations-client";

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();
  const { data: orgs } = await supabase.rpc("admin_list_organizations");

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Organizations"
        description="Browse all tenants, filter by status, and open detail pages for review."
      />
      <OrganizationsClient
        orgs={(orgs as AdminOrg[]) ?? []}
        canWrite={!!ctx?.canWrite}
        initialStatus={params.status}
      />
    </div>
  );
}

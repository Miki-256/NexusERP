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
  const { data: orgs, error } = await supabase.rpc("admin_list_organizations_health");

  let list: AdminOrg[] = [];
  if (!error && Array.isArray(orgs)) {
    list = orgs as AdminOrg[];
  } else {
    const { data: fallback } = await supabase.rpc("admin_list_organizations");
    list = (fallback as AdminOrg[]) ?? [];
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Organizations"
        description="Browse tenants with health scores. Open a detail page for ops, overrides, and offboarding."
      />
      <OrganizationsClient
        orgs={list}
        canWrite={!!ctx?.canWrite}
        initialStatus={params.status}
      />
    </div>
  );
}

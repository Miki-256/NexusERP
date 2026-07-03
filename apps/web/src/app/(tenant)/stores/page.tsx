import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { StoresClient } from "./stores-client";

export default async function StoresPage() {
  const ctx = await requireAppAccess("stores");

  const supabase = await createClient();
  const { data: stores } = await supabase
    .from("stores")
    .select("*, registers(*)")
    .eq("organization_id", ctx.organization.id)
    .order("name");

  return (
    <StoresClient
      stores={stores ?? []}
      organizationId={ctx.organization.id}
      canManage={ctx.canManageApp("stores")}
    />
  );
}

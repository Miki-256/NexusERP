import { getCurrentMembership, canManage } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { StoresClient } from "./stores-client";

export default async function StoresPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

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
      canManage={canManage(ctx.member.role)}
    />
  );
}

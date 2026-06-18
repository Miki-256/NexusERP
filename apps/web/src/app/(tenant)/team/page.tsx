import { getCurrentMembership, canManage } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");
  if (!canManage(ctx.member.role)) redirect("/dashboard");

  const supabase = await createClient();
  const { data: invites } = await supabase
    .from("staff_invites")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  const { data: members } = await supabase
    .from("organization_members")
    .select("id, role, is_active, user_id")
    .eq("organization_id", ctx.organization.id);

  return (
    <TeamClient
      organizationId={ctx.organization.id}
      invites={invites ?? []}
      members={members ?? []}
    />
  );
}

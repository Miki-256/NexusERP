import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const ctx = await requireAppAccess("team");
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

  const { data: posStaff } = await supabase
    .from("pos_staff")
    .select("id, display_name, role, is_active, created_at")
    .eq("organization_id", ctx.organization.id)
    .order("display_name");

  const { data: registers } = await supabase
    .from("registers")
    .select("id, name, stores(name)")
    .eq("organization_id", ctx.organization.id)
    .eq("is_active", true)
    .order("name");

  const { data: departmentRoles, error: rolesError } = await supabase
    .from("department_roles")
    .select("id, code, name, description, app_ids")
    .eq("organization_id", ctx.organization.id)
    .order("name");

  const memberIds = (members ?? []).map((m) => m.id);

  const { data: memberRoleLinks } = memberIds.length
    ? await supabase
        .from("organization_member_department_roles")
        .select("member_id, role_id")
        .in("member_id", memberIds)
    : { data: [] as { member_id: string; role_id: string }[] };

  const { data: memberOverrides } = memberIds.length
    ? await supabase
        .from("organization_member_app_overrides")
        .select("member_id, app_id, access")
        .in("member_id", memberIds)
    : { data: [] as { member_id: string; app_id: string; access: string }[] };

  const permissionsReady =
    !rolesError && (departmentRoles?.length ?? 0) > 0;

  const roleIdsByMember: Record<string, string[]> = {};
  for (const row of memberRoleLinks ?? []) {
    if (!roleIdsByMember[row.member_id]) roleIdsByMember[row.member_id] = [];
    roleIdsByMember[row.member_id].push(row.role_id);
  }

  const overridesByMember: Record<string, { app_id: string; access: "grant" | "deny" }[]> = {};
  for (const row of memberOverrides ?? []) {
    if (!overridesByMember[row.member_id]) overridesByMember[row.member_id] = [];
    overridesByMember[row.member_id].push({
      app_id: row.app_id,
      access: row.access as "grant" | "deny",
    });
  }

  return (
    <TeamClient
      organizationId={ctx.organization.id}
      invites={invites ?? []}
      members={members ?? []}
      posStaff={posStaff ?? []}
      registers={registers ?? []}
      departmentRoles={departmentRoles ?? []}
      roleIdsByMember={roleIdsByMember}
      overridesByMember={overridesByMember}
      permissionsReady={permissionsReady}
    />
  );
}

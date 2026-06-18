import { createClient } from "@/lib/supabase/server";

export async function getCurrentMembership() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: member } = await supabase
    .from("organization_members")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!member) return null;

  const { data: organization } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", member.organization_id)
    .single();

  if (!organization) return null;

  return { user, member, organization };
}

export function canManage(role: string) {
  return role === "owner" || role === "manager";
}

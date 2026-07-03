import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { UserProfileClient } from "./user-profile-client";

export default async function AdminUserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_user_profile", { p_user_id: id });

  if (error || !data) notFound();

  return (
    <UserProfileClient
      profile={data as UserProfile}
      canManageSecurity={!!ctx?.canManageAdmins}
      canWrite={!!ctx?.canWrite}
    />
  );
}

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PlatformAdminContext, PlatformAdminRole } from "@/lib/admin-types";

type AdminRolePayload = {
  is_admin: boolean;
  role?: PlatformAdminRole;
  can_write?: boolean;
  can_manage_admins?: boolean;
};

export const getPlatformAdminContext = cache(async function getPlatformAdminContext(): Promise<PlatformAdminContext | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_my_role");
  if (error || !data) return null;

  const payload = data as AdminRolePayload;
  if (!payload.is_admin || !payload.role) return null;

  return {
    isAdmin: true,
    role: payload.role,
    canWrite: !!payload.can_write,
    canManageAdmins: !!payload.can_manage_admins,
  };
});

export async function requirePlatformAdmin() {
  const ctx = await getPlatformAdminContext();
  if (!ctx) redirect("/dashboard");
  return ctx;
}

export async function requirePlatformAdminWrite() {
  const ctx = await requirePlatformAdmin();
  if (!ctx.canWrite) redirect("/admin");
  return ctx;
}

export async function requirePlatformAdminManageAdmins() {
  const ctx = await requirePlatformAdmin();
  if (!ctx.canManageAdmins) redirect("/admin/admins");
  return ctx;
}

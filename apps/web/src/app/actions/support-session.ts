"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { requirePlatformAdminWrite } from "@/lib/platform-admin";

export type SupportSessionPayload = {
  ok: boolean;
  session_id: string;
  organization_id: string;
  organization_name: string;
  expires_at: string;
  reason: string;
};

export async function startSupportSession(organizationId: string, reason: string) {
  await requirePlatformAdminWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_start_support_session", {
    p_org_id: organizationId,
    p_reason: reason.trim(),
    p_duration_minutes: 240,
  });
  if (error || !data) {
    throw new Error(error?.message ?? "Could not start support session");
  }

  const payload = data as SupportSessionPayload;
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, payload.organization_id, {
    path: "/",
    maxAge: 60 * 60 * 4,
    httpOnly: true,
    sameSite: "lax",
  });

  redirect("/dashboard");
}

export async function endSupportSession() {
  await requirePlatformAdminWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_end_support_session", {
    p_session_id: null,
  });
  if (error) {
    throw new Error(error.message);
  }

  const ended = data as { organization_id?: string; ended?: boolean } | null;
  const orgId = ended?.organization_id;
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORG_COOKIE);

  if (orgId) {
    redirect(`/admin/organizations/${orgId}`);
  }
  redirect("/admin/organizations");
}

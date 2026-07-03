"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";

async function verifyMembership(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_workspace", {
    p_organization_id: organizationId,
  });
  if (error || !data) return false;
  return true;
}

/** Persist active company without navigation (e.g. after accepting an invite). */
export async function setActiveOrganization(organizationId: string) {
  if (!(await verifyMembership(organizationId))) {
    throw new Error("You do not have access to that organization");
  }
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: "lax",
  });
}

/** Switch company and reload the dashboard. */
export async function switchOrganization(organizationId: string) {
  await setActiveOrganization(organizationId);
  redirect("/dashboard");
}

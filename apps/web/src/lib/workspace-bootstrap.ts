import type { SupabaseClient } from "@supabase/supabase-js";
import { getPendingOrganizations, resolveUserWorkspace } from "@/lib/workspace";

export type BootstrapDestination = {
  path: "/login" | "/dashboard" | "/onboarding" | "/pending-approval";
  /** When set, caller should persist the active-org cookie before redirecting. */
  orgCookie?: string;
};

/** Resolve where a signed-in user should land after auth. */
export async function resolveBootstrapDestination(
  supabase: SupabaseClient,
  activeOrgId?: string | null
): Promise<BootstrapDestination> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { path: "/login" };
  }

  const resolved = await resolveUserWorkspace(supabase, activeOrgId ?? null);

  if (resolved) {
    const needsCookie =
      !activeOrgId || activeOrgId !== resolved.activeOrganizationId;
    return {
      path: "/dashboard",
      orgCookie: needsCookie ? resolved.activeOrganizationId : undefined,
    };
  }

  const pending = await getPendingOrganizations(supabase);
  if (pending.length > 0) {
    return { path: "/pending-approval" };
  }

  return { path: "/onboarding" };
}

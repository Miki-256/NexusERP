import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE, type WorkspaceSummary } from "@/lib/active-org";
import {
  ALL_ERP_APP_IDS,
  CASHIER_DEFAULT_APP_IDS,
  type ErpAppId,
  type MemberPermissionsPayload,
  toAppSet,
} from "@/lib/app-permissions";
import { resolveUserWorkspace } from "@/lib/workspace";

export async function getActiveOrganizationId() {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;
}

export const listMyWorkspaces = cache(async function listMyWorkspaces() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_workspaces");
  if (error || !data) return [] as WorkspaceSummary[];
  return data as WorkspaceSummary[];
});

/** Deduped per request — safe to call from layout and page without double-fetching. */
export const getCurrentMembership = cache(async function getCurrentMembership() {
  const supabase = await createClient();
  const activeOrgId = await getActiveOrganizationId();
  const resolved = await resolveUserWorkspace(supabase, activeOrgId);
  if (!resolved) return null;

  return {
    user: resolved.user,
    member: resolved.workspace.member,
    organization: resolved.workspace.organization,
    activeOrganizationId: resolved.activeOrganizationId,
  };
});

function legacyPermissions(role: string) {
  const accessible =
    role === "owner" || role === "manager"
      ? new Set(ALL_ERP_APP_IDS)
      : new Set(CASHIER_DEFAULT_APP_IDS);
  const canManage =
    role === "owner" || role === "manager"
      ? new Set(ALL_ERP_APP_IDS)
      : new Set<ErpAppId>();
  return { accessible, canManage, usesCustomPermissions: false };
}

function permissionsFromPayload(payload: MemberPermissionsPayload, role: string) {
  const accessible = toAppSet(payload.accessible_apps ?? []);
  const canManage = toAppSet(payload.manage_apps ?? []);
  if (accessible.size === 0) return legacyPermissions(role);
  return {
    accessible,
    canManage,
    usesCustomPermissions: !!payload.uses_custom_permissions,
  };
}

export const getMemberPermissions = cache(async function getMemberPermissions() {
  const base = await getCurrentMembership();
  if (!base) return null;

  const supabase = await createClient();
  const orgId = base.activeOrganizationId;
  const rpcArgs = orgId ? { p_organization_id: orgId } : {};
  const role = base.member.role;

  const [
    { data, error },
    workspaces,
    { data: enabledAppIds, error: enabledAppsError },
  ] = await Promise.all([
    supabase.rpc("get_my_app_permissions", rpcArgs),
    listMyWorkspaces(),
    orgId
      ? supabase.rpc("get_org_enabled_app_ids", { p_org_id: orgId })
      : Promise.resolve({ data: null as string[] | null, error: null }),
  ]);

  const parsed = (data ?? null) as MemberPermissionsPayload | null;
  const perms =
    parsed && !error
      ? permissionsFromPayload(parsed, role)
      : legacyPermissions(role);

  if (!enabledAppsError && Array.isArray(enabledAppIds) && enabledAppIds.length > 0) {
    const enabled = new Set(enabledAppIds as string[]);
    for (const appId of [...perms.accessible]) {
      if (!enabled.has(appId)) perms.accessible.delete(appId);
    }
  }

  if (perms.accessible.size === 0) {
    perms.accessible.add("dashboard");
    perms.accessible.add("pos");
  }

  return {
    ...base,
    workspaces,
    accessibleApps: perms.accessible,
    manageApps: perms.canManage,
    usesCustomPermissions: perms.usesCustomPermissions,
    canAccessApp(appId: ErpAppId) {
      return perms.accessible.has(appId);
    },
    canManageApp(appId: ErpAppId) {
      return perms.canManage.has(appId);
    },
    canManageTeam: perms.accessible.has("team") && perms.canManage.has("team"),
    canManageCommunications:
      perms.canManage.has("communications") ||
      ((role === "owner" || role === "manager") && perms.accessible.has("communications")),
  };
});

/** @deprecated Prefer getMemberPermissions().canManageApp() */
export function canManage(role: string) {
  return role === "owner" || role === "manager";
}

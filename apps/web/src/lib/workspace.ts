import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { WorkspacePayload } from "@/lib/accept-pending-invite";

type RpcClient = Pick<SupabaseClient, "rpc" | "auth">;

/** Call get_my_workspace — omit param when resolving the default org. */
export async function loadWorkspaceFromRpc(
  supabase: RpcClient,
  organizationId?: string | null
): Promise<WorkspacePayload | null> {
  const rpcArgs =
    organizationId && organizationId.length > 0
      ? { p_organization_id: organizationId }
      : {};

  const { data, error } = await supabase.rpc("get_my_workspace", rpcArgs);
  if (error || !data) return null;

  const workspace = data as WorkspacePayload;
  if (!workspace.member?.id || !workspace.organization?.id) return null;
  return workspace;
}

export type ResolvedWorkspace = {
  user: User;
  workspace: WorkspacePayload;
  activeOrganizationId: string;
};

export type PendingOrganization = {
  organization_id: string;
  organization_name: string;
  role: string;
  status: "pending";
  created_at: string;
};

export const getPendingOrganizations = cache(async function getPendingOrganizations(
  supabase: RpcClient
): Promise<PendingOrganization[]> {
  const { data, error } = await supabase.rpc("get_my_pending_organizations");
  if (error || !data) return [];
  return data as PendingOrganization[];
});

/**
 * Single bootstrap path for home, onboarding, and org context.
 * Accepts pending invites, resolves default org, and falls back when the active-org cookie is stale.
 */
export const resolveUserWorkspace = cache(async function resolveUserWorkspace(
  supabase: RpcClient,
  activeOrgId?: string | null
): Promise<ResolvedWorkspace | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let workspace = await loadWorkspaceFromRpc(supabase, activeOrgId ?? null);
  let triedDefault = !activeOrgId;

  if (!workspace && activeOrgId) {
    workspace = await loadWorkspaceFromRpc(supabase, null);
    triedDefault = true;
  }

  if (!workspace) {
    const { data: joinedOrgId } = await supabase.rpc("accept_my_pending_staff_invite");
    if (joinedOrgId) {
      workspace = await loadWorkspaceFromRpc(supabase, joinedOrgId);
    }
  }

  if (!workspace && !triedDefault) {
    workspace = await loadWorkspaceFromRpc(supabase, null);
  }

  if (!workspace) return null;

  return {
    user,
    workspace,
    activeOrganizationId: workspace.organization.id,
  };
});

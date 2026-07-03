import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkspacePayload = {
  member: {
    id: string;
    organization_id: string;
    user_id: string;
    role: "owner" | "manager" | "cashier";
    store_ids: string[] | null;
    is_active: boolean;
    created_at: string;
  };
  organization: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    tax_rate: number;
    tax_inclusive: boolean;
    receipt_prefix: string;
    receipt_footer: string | null;
    address: string | null;
    tax_id: string | null;
    logo_url: string | null;
    created_at: string;
    updated_at: string;
  };
};

/** Load workspace via SECURITY DEFINER RPC — matches server layout checks. */
export async function fetchMyWorkspace(
  supabase: SupabaseClient,
  organizationId?: string | null
) {
  const rpcArgs =
    organizationId && organizationId.length > 0
      ? { p_organization_id: organizationId }
      : {};
  const { data, error } = await supabase.rpc("get_my_workspace", rpcArgs);
  if (error) {
    if (error.message.includes("does not exist") || error.message.includes("schema cache")) {
      return null;
    }
    throw error;
  }
  return (data ?? null) as WorkspacePayload | null;
}

/** Join the user's team if they have a pending staff invite matching their email. */
export async function acceptPendingStaffInvite(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("accept_my_pending_staff_invite");
  if (error) throw error;
  return data as string | null;
}

export async function fetchPendingStaffInviteId(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("get_my_pending_staff_invite");
  if (error) throw error;
  return data as string | null;
}

/** True when workspace RPC returns a member + organization. */
export async function hasOrganizationMembership(
  supabase: SupabaseClient,
  organizationId?: string | null
) {
  try {
    let workspace = await fetchMyWorkspace(supabase, organizationId);
    if (!workspace?.member?.id && organizationId) {
      workspace = await fetchMyWorkspace(supabase, null);
    }
    return !!workspace?.member?.id && !!workspace?.organization?.id;
  } catch {
    return false;
  }
}

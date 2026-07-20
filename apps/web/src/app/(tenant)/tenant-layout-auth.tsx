import { getMemberPermissions } from "@/lib/org-context";
import { redirectIfNoActiveWorkspace } from "@/lib/post-auth-redirect";
import { serializeNavApps } from "@/lib/apps-registry";
import { TenantShell } from "@/components/layout/tenant-shell";
import { createClient } from "@/lib/supabase/server";
import type { ActiveSupportSession } from "@/lib/admin-types";

export async function TenantLayoutAuth({ children }: { children: React.ReactNode }) {
  const ctx = await getMemberPermissions();

  if (!ctx) {
    await redirectIfNoActiveWorkspace();
    return null;
  }

  let supportSession: ActiveSupportSession | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("admin_get_active_support_session");
    if (data) {
      const session = data as ActiveSupportSession;
      if (session.organization_id === ctx.organization.id) {
        supportSession = session;
      }
    }
  } catch {
    supportSession = null;
  }

  return (
    <TenantShell
      orgName={ctx.organization.name ?? "Workspace"}
      activeOrganizationId={ctx.organization.id}
      workspaces={ctx.workspaces}
      userId={ctx.user.id}
      userEmail={ctx.user.email}
      userRole={ctx.member.role}
      canManageTeam={ctx.canManageTeam}
      accessibleAppIds={Array.from(ctx.accessibleApps)}
      navApps={serializeNavApps(ctx.accessibleApps)}
      supportSession={supportSession}
    >
      {children}
    </TenantShell>
  );
}

import { redirect } from "next/navigation";
import { getMemberPermissions } from "@/lib/org-context";
import { redirectIfNoActiveWorkspace } from "@/lib/post-auth-redirect";
import { serializeNavApps } from "@/lib/apps-registry";
import { TenantShell } from "@/components/layout/tenant-shell";

export async function TenantLayoutAuth({ children }: { children: React.ReactNode }) {
  const ctx = await getMemberPermissions();

  if (!ctx) {
    await redirectIfNoActiveWorkspace();
    return null;
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
    >
      {children}
    </TenantShell>
  );
}

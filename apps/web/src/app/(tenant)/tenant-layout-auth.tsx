import { getMemberPermissions } from "@/lib/org-context";
import { redirectIfNoActiveWorkspace } from "@/lib/post-auth-redirect";
import { serializeNavApps } from "@/lib/apps-registry";
import { TenantShell } from "@/components/layout/tenant-shell";
import {
  getCachedActiveSupportSession,
  getCachedOrgDefaultLocale,
} from "@/lib/layout-chrome-cache";
import type { ActiveSupportSession } from "@/lib/admin-types";

export async function TenantLayoutAuth({ children }: { children: React.ReactNode }) {
  const t0 = Date.now();
  const ctx = await getMemberPermissions();

  if (!ctx) {
    await redirectIfNoActiveWorkspace();
    return null;
  }

  let supportSession: ActiveSupportSession | null = null;
  let orgDefaultLocale: string | null = null;
  try {
    const [session, locale] = await Promise.all([
      getCachedActiveSupportSession(),
      getCachedOrgDefaultLocale(ctx.organization.id),
    ]);
    if (session && session.organization_id === ctx.organization.id) {
      supportSession = session;
    }
    orgDefaultLocale = locale;
  } catch {
    supportSession = null;
  }

  if (process.env.NODE_ENV === "development" || process.env.NEXUS_PERF === "1") {
    console.info(`[perf] nav.layout: ${Date.now() - t0}ms`);
  }

  return (
    <TenantShell
      orgName={ctx.organization.name ?? "Workspace"}
      activeOrganizationId={ctx.organization.id}
      orgDefaultLocale={orgDefaultLocale}
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

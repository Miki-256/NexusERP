import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/layout/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { PAGE_SHELL } from "@/lib/ui-classes";
import { Building2, ClipboardList, DollarSign, Shield, Users } from "lucide-react";
import type { PendingOrg, PlatformAuditLog, PlatformStats } from "@/lib/admin-types";
import { formatAuditAction } from "@/lib/admin-types";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { PendingQueue } from "./pending-queue";

export default async function AdminOverviewPage() {
  const ctx = await getPlatformAdminContext();
  const supabase = await createClient();

  const [{ data: stats }, { data: pending }, { data: auditPayload }] = await Promise.all([
    supabase.rpc("admin_platform_stats"),
    supabase.rpc("admin_list_pending_organizations"),
    supabase.rpc("admin_list_platform_audit_logs", { p_limit: 8, p_offset: 0 }),
  ]);

  const s = (stats ?? {}) as Partial<PlatformStats>;
  const recentLogs = ((auditPayload as { rows?: PlatformAuditLog[] } | null)?.rows ?? []) as PlatformAuditLog[];

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Platform overview"
        description="Monitor tenant health, pending approvals, and recent platform actions."
        action={
          (s.orgs_pending ?? 0) > 0 ? (
            <Button size="sm" asChild>
              <Link href="/admin/organizations?status=pending">Review pending ({s.orgs_pending})</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Organizations" value={s.org_count ?? 0} icon={Building2} />
        <StatCard label="Active" value={s.orgs_active ?? 0} highlight="positive" />
        <StatCard
          label="Pending approval"
          value={s.orgs_pending ?? 0}
          highlight={(s.orgs_pending ?? 0) > 0 ? "negative" : undefined}
        />
        <StatCard label="Suspended" value={s.orgs_suspended ?? 0} />
        <StatCard label="Members" value={s.member_count ?? 0} icon={Users} />
        <StatCard label="Completed sales" value={s.sales_count ?? 0} icon={DollarSign} />
        <StatCard label="Sales volume" value={Math.round(s.sales_total ?? 0).toLocaleString()} />
        <StatCard label="Platform admins" value={s.admin_count ?? 0} icon={Shield} />
      </div>

      <PendingQueue orgs={(pending as PendingOrg[]) ?? []} canWrite={!!ctx?.canWrite} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Recent platform actions</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/audit">
              <ClipboardList className="h-4 w-4" />
              Full audit log
            </Link>
          </Button>
        </div>
        <div className="rounded-lg border border-border">
          {recentLogs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No platform actions logged yet.</p>
          ) : (
            <ul className="divide-y">
              {recentLogs.map((log) => (
                <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div>
                    <span className="font-medium capitalize">{formatAuditAction(log.action)}</span>
                    <span className="text-muted-foreground"> · {log.actor_email ?? "system"}</span>
                  </div>
                  <time className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

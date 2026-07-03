"use client";

import Link from "next/link";
import { FormCard } from "@/components/layout/form-card";
import { StatCard } from "@/components/layout/stat-card";
import { StatusBadge } from "@/components/layout/status-badge";
import { formatAuditAction, type SecurityDashboard } from "@/lib/admin-types";
import { AlertTriangle, Ban, Lock, ShieldAlert, UserX } from "lucide-react";

export function SecurityDashboardClient({ data }: { data: SecurityDashboard }) {
  const stats = data.stats ?? {
    failed_logins_24h: 0,
    login_blocked_24h: 0,
    active_lockouts: 0,
    suspended_orgs: 0,
    pending_orgs: 0,
    disabled_users: 0,
    admin_actions_24h: 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <StatCard
          label="Failed logins (24h)"
          value={stats.failed_logins_24h}
          icon={ShieldAlert}
          highlight={stats.failed_logins_24h > 0 ? "negative" : undefined}
        />
        <StatCard
          label="Login lockouts (24h)"
          value={stats.login_blocked_24h ?? 0}
          icon={Lock}
          highlight={(stats.login_blocked_24h ?? 0) > 0 ? "negative" : undefined}
        />
        <StatCard
          label="Active lockouts"
          value={stats.active_lockouts ?? 0}
          icon={Lock}
          highlight={(stats.active_lockouts ?? 0) > 0 ? "negative" : undefined}
        />
        <StatCard label="Suspended orgs" value={stats.suspended_orgs} icon={Ban} />
        <StatCard label="Pending orgs" value={stats.pending_orgs} icon={AlertTriangle} />
        <StatCard label="Disabled users" value={stats.disabled_users} icon={UserX} />
        <StatCard label="Admin actions (24h)" value={stats.admin_actions_24h} />
      </div>

      <p className="text-sm">
        <Link href="/admin/security/throttle" className="text-primary hover:underline">
          Manage auth throttling, lockouts, and alerts →
        </Link>
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <FormCard title="Recent security events">
          {data.recent_security_events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No security events recorded yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {data.recent_security_events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div>
                    <span className="font-medium capitalize">{e.event_type.replace(/_/g, " ")}</span>
                    {e.email && <span className="text-muted-foreground"> · {e.email}</span>}
                    {e.ip_address && (
                      <span className="block text-xs text-muted-foreground">IP {e.ip_address}</span>
                    )}
                  </div>
                  <time className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/security/events" className="mt-3 inline-block text-sm text-primary hover:underline">
            View all events →
          </Link>
        </FormCard>

        <FormCard title="Recent admin actions">
          {data.recent_admin_actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No admin actions yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {data.recent_admin_actions.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div>
                    <span className="font-medium capitalize">{formatAuditAction(a.action)}</span>
                    <span className="text-muted-foreground"> · {a.actor_email ?? "unknown"}</span>
                  </div>
                  <time className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/audit" className="mt-3 inline-block text-sm text-primary hover:underline">
            Full audit log →
          </Link>
        </FormCard>
      </div>

      <FormCard title="Suspended organizations">
        {data.suspended_organizations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No suspended organizations.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {data.suspended_organizations.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <Link href={`/admin/organizations/${o.id}`} className="font-medium hover:underline">
                  {o.name}
                </Link>
                <StatusBadge status={o.status} />
              </li>
            ))}
          </ul>
        )}
      </FormCard>
    </div>
  );
}

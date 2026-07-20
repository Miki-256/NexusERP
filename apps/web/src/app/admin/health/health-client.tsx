"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FormCard } from "@/components/layout/form-card";
import { StatCard } from "@/components/layout/stat-card";
import { StatusBadge } from "@/components/layout/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import type { PlatformHealth } from "@/lib/admin-types";
import type { PlatformDependencyProbe } from "@/lib/ops/platform-deps";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  Activity,
  Building2,
  Database,
  Moon,
  AlertTriangle,
  Clock,
  RefreshCw,
  Radio,
  Undo2,
  CheckCircle2,
  Shield,
  Server,
} from "lucide-react";

function ageLabel(iso: string | null | undefined) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || t < 24 * 60 * 60 * 1000) return null; // treat epoch / unset as never
  const ms = Date.now() - t;
  if (ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function hasRealHeartbeat(iso: string | null | undefined) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t >= 24 * 60 * 60 * 1000;
}

export function HealthClient({
  data,
  canWrite,
  dependencies = [],
  securityPulse,
}: {
  data: PlatformHealth;
  canWrite: boolean;
  dependencies?: PlatformDependencyProbe[];
  securityPulse?: {
    security_events_24h: number;
    security_events_7d: number;
    platform_audit_24h: number;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const counts = data.table_counts ?? {};
  const countEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const ops = data.ops;
  const ledgerPending = ops?.ledger_queue_pending ?? 0;
  const ledgerFailed = ops?.ledger_queue_failed ?? 0;
  const webhookPending = ops?.payment_webhook_queue_pending ?? 0;
  const refundPending = ops?.refund_ledger_pending ?? 0;
  const refundFailed = ops?.refund_ledger_failed ?? 0;
  const notifPending = ops?.notification_deliveries_pending ?? 0;
  const notifFailed = ops?.notification_deliveries_failed ?? 0;
  const notifEvents = ops?.notification_events_unprocessed ?? 0;
  const hrPending = ops?.hr_webhook_pending ?? 0;
  const hrFailed = ops?.hr_webhook_failed ?? 0;
  const staleRollups = ops?.stale_rollup_orgs ?? 0;
  const unpostedSales = ops?.unposted_completed_sales ?? 0;
  const queueErrors = ops?.ledger_queue_errors ?? [];
  const orgBacklog = ops?.org_ledger_backlog ?? [];
  const orgUnposted = ops?.org_unposted_sales ?? [];
  const heartbeat = ops?.process_queue_heartbeat;

  const needsAttention = useMemo(
    () =>
      ledgerPending > 0 ||
      ledgerFailed > 0 ||
      webhookPending > 0 ||
      refundPending > 0 ||
      refundFailed > 0 ||
      notifPending > 0 ||
      hrPending > 0 ||
      hrFailed > 0 ||
      staleRollups > 0 ||
      unpostedSales > 0,
    [
      ledgerPending,
      ledgerFailed,
      webhookPending,
      refundPending,
      refundFailed,
      notifPending,
      hrPending,
      hrFailed,
      staleRollups,
      unpostedSales,
    ]
  );

  const cronAge = ageLabel(heartbeat?.last_success_at);
  const cronStale =
    !hasRealHeartbeat(heartbeat?.last_success_at) ||
    Date.now() - new Date(heartbeat!.last_success_at).getTime() > 15 * 60 * 1000;

  async function drainQueues() {
    setBusy("drain");
    try {
      const res = await fetch("/api/admin/health/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "drain" }),
      });
      const json = (await res.json()) as {
        error?: string;
        ok?: boolean;
        result?: { ledger_posts?: { posted?: number; failed?: number; pending?: number } };
      };
      if (!res.ok) {
        toast({ title: "Drain failed", description: json.error ?? res.statusText, variant: "destructive" });
        return;
      }
      const posted = json.result?.ledger_posts?.posted;
      toast({
        title: "Queues drained",
        description:
          posted != null
            ? `Ledger posted ${posted}. Refreshing health…`
            : "Background workers finished. Refreshing health…",
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function retryLedger(saleId: string) {
    setBusy(`retry-${saleId}`);
    try {
      const res = await fetch("/api/admin/health/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_ledger", sale_id: saleId }),
      });
      const json = (await res.json()) as {
        error?: string;
        result?: { ok?: boolean; error?: string };
      };
      if (!res.ok) {
        toast({ title: "Retry failed", description: json.error ?? res.statusText, variant: "destructive" });
        return;
      }
      if (json.result && json.result.ok === false) {
        toast({
          title: "Retry failed",
          description: json.result.error ?? "Could not post sale to ledger",
          variant: "destructive",
        });
      } else {
        toast({ title: "Sale posted to ledger" });
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function postUnpostedForOrg(orgId: string, orgName: string | null) {
    setBusy(`unposted-${orgId}`);
    try {
      const res = await fetch("/api/admin/health/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post_unposted", organization_id: orgId, limit: 100 }),
      });
      const json = (await res.json()) as {
        error?: string;
        result?: { posted?: number; skipped?: number; remaining?: number };
      };
      if (!res.ok) {
        toast({
          title: "Batch post failed",
          description: json.error ?? res.statusText,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: `Posted sales for ${orgName || "org"}`,
        description: `Posted ${json.result?.posted ?? 0}, skipped ${json.result?.skipped ?? 0}, remaining ${json.result?.remaining ?? "—"}`,
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Generated {data.generated_at ? new Date(data.generated_at).toLocaleString() : "—"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Process-queue last success:{" "}
            {hasRealHeartbeat(heartbeat?.last_success_at) ? (
              <span className={cronStale ? "font-medium text-amber-800" : "font-medium text-emerald-700"}>
                {new Date(heartbeat!.last_success_at).toLocaleString()}
                {cronAge ? ` (${cronAge})` : ""}
                {heartbeat?.last_ok === false ? " · last run had errors" : ""}
              </span>
            ) : (
              <span className="font-medium text-amber-800">never recorded — run Drain or wait for cron</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => router.refresh()}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {canWrite && (
            <Button type="button" size="sm" disabled={busy !== null} onClick={() => void drainQueues()}>
              <RefreshCw className={`h-4 w-4 ${busy === "drain" ? "animate-spin" : ""}`} />
              {busy === "drain" ? "Draining…" : "Drain queues now"}
            </Button>
          )}
        </div>
      </div>

      {(needsAttention || cronStale) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Background queues need attention
          </p>
          <p className="mt-1 text-amber-900/80">
            {cronStale
              ? "Process-queue heartbeat is missing or older than 15 minutes. Ensure the 5-minute cron is running, or use Drain queues now."
              : "One or more async queues have pending or failed work. Ledger posts are async after POS checkout."}
          </p>
          {!canWrite && (
            <p className="mt-2 text-xs text-amber-900/70">
              Ask a super_admin or support role to drain queues (security roles are read-only).
            </p>
          )}
        </div>
      )}

      {!needsAttention && !cronStale && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Queues healthy
          </p>
          <p className="mt-1 text-emerald-900/80">No pending ledger, webhook, refund, HR, or notification backlog.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Estimated rows" value={data.estimated_rows ?? 0} icon={Database} />
        <StatCard label="Active orgs" value={data.orgs_by_status?.active ?? 0} icon={Building2} />
        <StatCard label="Pending orgs" value={data.orgs_by_status?.pending ?? 0} icon={Activity} />
        <StatCard
          label="Inactive 30d"
          value={data.inactive_orgs_30d ?? 0}
          icon={Moon}
          highlight={data.inactive_orgs_30d > 0 ? "negative" : undefined}
        />
      </div>

      {ops && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Ledger queue"
            value={ledgerPending}
            sub={
              [
                ledgerFailed > 0 ? `${ledgerFailed} failed` : null,
                ageLabel(ops.ledger_queue_oldest_at) ? `oldest ${ageLabel(ops.ledger_queue_oldest_at)}` : null,
                "Pending GL posts",
              ]
                .filter(Boolean)
                .join(" · ")
            }
            icon={Clock}
            highlight={ledgerFailed > 0 ? "negative" : ledgerPending > 50 ? "negative" : undefined}
          />
          <StatCard
            label="Webhook queue"
            value={webhookPending}
            sub={
              ageLabel(ops.payment_webhook_oldest_at)
                ? `Oldest ${ageLabel(ops.payment_webhook_oldest_at)}`
                : "Unprocessed mobile-money"
            }
            icon={Activity}
            highlight={webhookPending > 0 ? "negative" : undefined}
          />
          <StatCard
            label="Refund ledger"
            value={refundPending}
            sub={refundFailed > 0 ? `${refundFailed} failed` : "Void/return GL queue"}
            icon={Undo2}
            highlight={refundFailed > 0 || refundPending > 0 ? "negative" : undefined}
          />
          <StatCard
            label="Notifications"
            value={notifPending}
            sub={`${notifFailed} failed · ${notifEvents} events`}
            icon={Radio}
            highlight={notifFailed > 0 || notifPending > 50 ? "negative" : undefined}
          />
          <StatCard
            label="HR webhooks"
            value={hrPending}
            sub={hrFailed > 0 ? `${hrFailed} failed` : "Pending deliveries"}
            icon={Radio}
            highlight={hrFailed > 0 || hrPending > 0 ? "negative" : undefined}
          />
          <StatCard
            label="Stale rollups"
            value={staleRollups}
            sub="Orgs lagging >2 days"
            icon={Database}
            highlight={staleRollups > 0 ? "negative" : undefined}
          />
          <StatCard
            label="Unposted sales"
            value={unpostedSales}
            sub="Completed, not on GL (eligible)"
            icon={Clock}
            highlight={unpostedSales > 0 ? "negative" : undefined}
          />
          <StatCard
            label="Security 24h"
            value={securityPulse?.security_events_24h ?? 0}
            sub={`${securityPulse?.security_events_7d ?? 0} in 7d · ${securityPulse?.platform_audit_24h ?? 0} audit`}
            icon={Shield}
            highlight={(securityPulse?.security_events_24h ?? 0) > 20 ? "negative" : undefined}
          />
        </div>
      )}

      {dependencies.length > 0 && (
        <FormCard title="Platform dependencies" description="Environment configuration for this deployment (Level 3).">
          <ul className="divide-y rounded-lg border text-sm">
            {dependencies.map((d) => (
              <li key={d.key} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="flex items-start gap-2">
                  <Server className={`mt-0.5 h-4 w-4 shrink-0 ${d.ok ? "text-emerald-600" : "text-amber-700"}`} />
                  <div>
                    <p className="font-medium">{d.label}</p>
                    <p className="text-xs text-muted-foreground">{d.detail}</p>
                  </div>
                </div>
                <span className={d.ok ? "text-emerald-700" : "text-amber-800"}>{d.ok ? "OK" : "Check"}</span>
              </li>
            ))}
          </ul>
        </FormCard>
      )}

      {orgBacklog.length > 0 && (
        <FormCard title="Org ledger backlog" description="Tenants with pending sale→GL queue items.">
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Organization</DataTableHead>
                <DataTableHead className="text-right">Pending</DataTableHead>
                <DataTableHead className="text-right">Failed</DataTableHead>
                <DataTableHead>Oldest</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {orgBacklog.map((row) => (
                  <DataTableRow key={row.organization_id}>
                    <DataTableCell>
                      <Link
                        href={`/admin/organizations/${row.organization_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.organization_name || row.organization_id.slice(0, 8)}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-right">{row.pending}</DataTableCell>
                    <DataTableCell className="text-right">{row.failed}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {row.oldest_enqueued_at ? new Date(row.oldest_enqueued_at).toLocaleString() : "—"}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </table>
          </DataTable>
        </FormCard>
      )}

      {orgUnposted.length > 0 && (
        <FormCard
          title="Unposted completed sales by org"
          description="Eligible sales with no journal entry (excludes pending mobile money). Auto-post on still means historical/queue gaps can remain."
        >
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Organization</DataTableHead>
                <DataTableHead className="text-right">Unposted</DataTableHead>
                <DataTableHead>Auto-post</DataTableHead>
                {canWrite && <DataTableHead align="right">Action</DataTableHead>}
              </DataTableHeader>
              <DataTableBody>
                {orgUnposted.map((row) => (
                  <DataTableRow key={row.organization_id}>
                    <DataTableCell>
                      <Link
                        href={`/admin/organizations/${row.organization_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.organization_name || row.organization_id.slice(0, 8)}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-right font-medium">{row.unposted}</DataTableCell>
                    <DataTableCell>
                      {row.auto_post_enabled ? (
                        <span className="text-emerald-700">On</span>
                      ) : (
                        <span className="text-amber-800">Off</span>
                      )}
                    </DataTableCell>
                    {canWrite && (
                      <DataTableCell align="right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void postUnpostedForOrg(row.organization_id, row.organization_name)}
                        >
                          {busy === `unposted-${row.organization_id}` ? "…" : "Post up to 100"}
                        </Button>
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))}
              </DataTableBody>
            </table>
          </DataTable>
        </FormCard>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <FormCard title="Table counts">
          {countEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data.</p>
          ) : (
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Table</DataTableHead>
                  <DataTableHead className="text-right">Rows</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {countEntries.map(([table, count]) => (
                    <DataTableRow key={table}>
                      <DataTableCell className="font-mono text-xs">{table}</DataTableCell>
                      <DataTableCell className="text-right">{count.toLocaleString()}</DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </table>
            </DataTable>
          )}
        </FormCard>

        <FormCard title="Organizations by plan">
          {Object.keys(data.orgs_by_plan ?? {}).length === 0 ? (
            <p className="text-sm text-muted-foreground">No organizations yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {Object.entries(data.orgs_by_plan).map(([plan, count]) => (
                <li key={plan} className="flex items-center justify-between px-4 py-2.5">
                  <span className="capitalize font-medium">{plan}</span>
                  <span className="text-muted-foreground">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </FormCard>
      </div>

      {queueErrors.length > 0 && (
        <FormCard title="Ledger queue errors" description="Failed or retried sale-to-GL posts (latest).">
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Org</DataTableHead>
                <DataTableHead>Sale</DataTableHead>
                <DataTableHead>Attempts</DataTableHead>
                <DataTableHead>Error</DataTableHead>
                <DataTableHead>Enqueued</DataTableHead>
                {canWrite && <DataTableHead align="right">Action</DataTableHead>}
              </DataTableHeader>
              <DataTableBody>
                {queueErrors.map((row) => (
                  <DataTableRow key={row.sale_id}>
                    <DataTableCell>
                      <Link
                        href={`/admin/organizations/${row.organization_id}`}
                        className="text-primary hover:underline"
                      >
                        {row.organization_name || row.organization_id.slice(0, 8)}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="font-mono text-xs">{row.sale_id.slice(0, 8)}…</DataTableCell>
                    <DataTableCell>{row.attempts}</DataTableCell>
                    <DataTableCell className="max-w-md truncate text-red-700">{row.last_error ?? "—"}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {new Date(row.enqueued_at).toLocaleString()}
                    </DataTableCell>
                    {canWrite && (
                      <DataTableCell align="right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void retryLedger(row.sale_id)}
                        >
                          {busy === `retry-${row.sale_id}` ? "…" : "Retry"}
                        </Button>
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))}
              </DataTableBody>
            </table>
          </DataTable>
        </FormCard>
      )}

      <FormCard title="Recent tenant activity" description="Last completed sale per organization (top 25).">
        {(data.recent_org_activity ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales activity recorded.</p>
        ) : (
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Organization</DataTableHead>
                <DataTableHead>Plan</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead>Sales</DataTableHead>
                <DataTableHead>Last sale</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {data.recent_org_activity.map((org) => (
                  <DataTableRow key={org.organization_id}>
                    <DataTableCell>
                      <Link
                        href={`/admin/organizations/${org.organization_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {org.organization_name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="capitalize">{org.plan}</DataTableCell>
                    <DataTableCell>
                      <StatusBadge status={org.status as "active" | "pending" | "suspended"} />
                    </DataTableCell>
                    <DataTableCell>{org.sales_count}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {org.last_sale_at ? new Date(org.last_sale_at).toLocaleString() : "—"}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </table>
          </DataTable>
        )}
      </FormCard>
    </div>
  );
}

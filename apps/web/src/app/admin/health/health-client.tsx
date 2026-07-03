"use client";

import Link from "next/link";
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
import { Activity, Building2, Database, Moon, AlertTriangle, Clock } from "lucide-react";

export function HealthClient({ data }: { data: PlatformHealth }) {
  const counts = data.table_counts ?? {};
  const countEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const ops = data.ops;
  const ledgerPending = ops?.ledger_queue_pending ?? 0;
  const ledgerFailed = ops?.ledger_queue_failed ?? 0;
  const webhookPending = ops?.payment_webhook_queue_pending ?? 0;
  const queueErrors = ops?.ledger_queue_errors ?? [];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Generated {data.generated_at ? new Date(data.generated_at).toLocaleString() : "—"}
      </p>

      {ops && (ledgerPending > 0 || ledgerFailed > 0 || webhookPending > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Background queues need attention
          </p>
          <p className="mt-1 text-amber-900/80">
            Ensure the process-queue cron is running. Ledger posts are async after POS checkout.
          </p>
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
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Ledger queue"
            value={ledgerPending}
            sub={ledgerFailed > 0 ? `${ledgerFailed} with errors` : "Pending GL posts"}
            icon={Clock}
            highlight={ledgerFailed > 0 ? "negative" : ledgerPending > 50 ? "negative" : undefined}
          />
          <StatCard
            label="Webhook queue"
            value={webhookPending}
            sub="Unprocessed mobile-money"
            icon={Activity}
            highlight={webhookPending > 0 ? "negative" : undefined}
          />
          <StatCard
            label="Public probe"
            value="GET /api/health"
            sub="Use for uptime monitors"
            icon={Database}
          />
        </div>
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
        <FormCard title="Ledger queue errors" description="Recent failed sale-to-GL posts (last 10).">
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Sale</DataTableHead>
                <DataTableHead>Attempts</DataTableHead>
                <DataTableHead>Error</DataTableHead>
                <DataTableHead>Enqueued</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {queueErrors.map((row) => (
                  <DataTableRow key={row.sale_id}>
                    <DataTableCell className="font-mono text-xs">{row.sale_id.slice(0, 8)}…</DataTableCell>
                    <DataTableCell>{row.attempts}</DataTableCell>
                    <DataTableCell className="max-w-md truncate text-red-700">{row.last_error ?? "—"}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {new Date(row.enqueued_at).toLocaleString()}
                    </DataTableCell>
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

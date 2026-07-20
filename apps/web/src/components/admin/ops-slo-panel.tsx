"use client";

import Link from "next/link";
import { FormCard } from "@/components/layout/form-card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import type { OpsSloStatus } from "@/lib/admin-types";

export function OpsSloPanel({ status }: { status: OpsSloStatus | null }) {
  if (!status) {
    return (
      <FormCard title="Ops SLOs" description="Threshold checks and webhook alerts.">
        <p className="text-sm text-muted-foreground">SLO status unavailable.</p>
      </FormCard>
    );
  }

  const breached = status.preview?.breached_count ?? 0;
  const checks = status.preview?.checks ?? [];
  const alerts = status.recent_alerts ?? [];

  return (
    <FormCard
      title="Ops SLOs"
      description={
        status.settings.enabled
          ? status.settings.webhook_configured
            ? `Alerts enabled · cooldown ${status.settings.cooldown_minutes}m · webhook configured`
            : `Alerts enabled · cooldown ${status.settings.cooldown_minutes}m · webhook not set`
          : "Alerts disabled — configure under Admin → Settings"
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          {breached === 0 ? (
            <span className="font-medium text-emerald-700">All thresholds within limits</span>
          ) : (
            <span className="font-medium text-amber-800">{breached} threshold(s) breached</span>
          )}
        </p>
        <Link href="/admin/settings" className="text-primary hover:underline">
          Configure SLOs
        </Link>
      </div>

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Check</DataTableHead>
            <DataTableHead className="text-right">Current</DataTableHead>
            <DataTableHead className="text-right">Threshold</DataTableHead>
            <DataTableHead>Status</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {checks.length === 0 ? (
              <DataTableEmpty colSpan={4} message="No checks." />
            ) : (
              checks.map((c) => (
                <DataTableRow key={c.key}>
                  <DataTableCell>{c.label ?? c.key}</DataTableCell>
                  <DataTableCell className="text-right tabular-nums">{c.current}</DataTableCell>
                  <DataTableCell className="text-right tabular-nums">{c.threshold}</DataTableCell>
                  <DataTableCell>
                    {c.breached ? (
                      <span className="text-amber-800">Breached</span>
                    ) : (
                      <span className="text-emerald-700">OK</span>
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>

      {alerts.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium">Recent alerts</h3>
          <ul className="divide-y rounded-lg border text-sm">
            {alerts.slice(0, 8).map((a) => (
              <li key={a.id} className="px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    [{a.severity}] {a.title}
                  </span>
                  <span className="text-xs capitalize text-muted-foreground">{a.status}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {a.detail} · {new Date(a.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </FormCard>
  );
}

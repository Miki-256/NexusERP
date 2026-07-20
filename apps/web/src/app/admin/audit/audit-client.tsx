"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { formatAuditAction, type PlatformAuditLog } from "@/lib/admin-types";

const PREFIX_FILTERS = [
  { id: "all", label: "All", prefix: "" },
  { id: "org", label: "Org", prefix: "org." },
  { id: "support", label: "Support", prefix: "support." },
  { id: "governance", label: "Governance", prefix: "governance." },
  { id: "settings", label: "Settings", prefix: "settings." },
  { id: "admin", label: "Admins", prefix: "admin." },
] as const;

export function AuditLogClient({
  logs,
  total,
  initialActor = "",
  initialPrefix = "",
  initialSince = "",
  initialUntil = "",
}: {
  logs: PlatformAuditLog[];
  total: number;
  initialActor?: string;
  initialPrefix?: string;
  initialSince?: string;
  initialUntil?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [actor, setActor] = useState(initialActor);
  const [since, setSince] = useState(initialSince);
  const [until, setUntil] = useState(initialUntil);
  const activePrefix = initialPrefix;

  function applyFilters(next?: { prefix?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const prefix = next?.prefix !== undefined ? next.prefix : activePrefix;
    if (prefix) params.set("prefix", prefix);
    else params.delete("prefix");
    if (actor.trim()) params.set("actor", actor.trim());
    else params.delete("actor");
    if (since) params.set("since", since);
    else params.delete("since");
    if (until) params.set("until", until);
    else params.delete("until");
    router.push(`/admin/audit?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Actor email…"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="w-48"
          />
          <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="w-40" />
          <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-40" />
          <Button size="sm" onClick={() => applyFilters()}>
            Apply
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {PREFIX_FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={activePrefix === f.prefix ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => applyFilters({ prefix: f.prefix })}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Showing {logs.length} of {total} platform actions (server-filtered).
      </p>

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>When</DataTableHead>
            <DataTableHead>Actor</DataTableHead>
            <DataTableHead>Action</DataTableHead>
            <DataTableHead>Entity</DataTableHead>
            <DataTableHead>Details</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {logs.length === 0 ? (
              <DataTableEmpty colSpan={5} message="No audit entries match your filters." />
            ) : (
              logs.map((log) => (
                <DataTableRow key={log.id}>
                  <DataTableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                  </DataTableCell>
                  <DataTableCell>{log.actor_email ?? "—"}</DataTableCell>
                  <DataTableCell className="font-medium capitalize">
                    {formatAuditAction(log.action)}
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {log.entity_type}
                    {log.organization_id ? (
                      <Link
                        href={`/admin/organizations/${log.organization_id}`}
                        className="block text-xs text-primary hover:underline"
                      >
                        {log.organization_id.slice(0, 8)}…
                      </Link>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell className="max-w-xs truncate text-xs text-muted-foreground">
                    {JSON.stringify(log.payload)}
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>

      <Button variant="outline" size="sm" onClick={() => router.refresh()}>
        Refresh
      </Button>
    </div>
  );
}

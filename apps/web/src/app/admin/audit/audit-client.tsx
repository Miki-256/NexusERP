"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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

const ACTION_FILTERS = [
  "all",
  "org.approve",
  "org.suspend",
  "admin.grant",
  "admin.revoke",
  "import.customers",
  "import.products",
] as const;

export function AuditLogClient({
  logs,
  total,
}: {
  logs: PlatformAuditLog[];
  total: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<(typeof ACTION_FILTERS)[number]>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((log) => {
      const matchesAction = action === "all" || log.action === action;
      const matchesQuery =
        !q ||
        log.action.toLowerCase().includes(q) ||
        (log.actor_email ?? "").toLowerCase().includes(q) ||
        (log.entity_type ?? "").toLowerCase().includes(q);
      return matchesAction && matchesQuery;
    });
  }, [logs, query, action]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Input
          placeholder="Search by actor, action…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex flex-wrap gap-1">
          {ACTION_FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={action === f ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setAction(f)}
            >
              {f === "all" ? "All" : formatAuditAction(f)}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Showing {filtered.length} of {total} platform actions (latest {logs.length} loaded).
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
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={5} message="No audit entries match your filters." />
            ) : (
              filtered.map((log) => (
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
                      <span className="block text-xs">{log.organization_id.slice(0, 8)}…</span>
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

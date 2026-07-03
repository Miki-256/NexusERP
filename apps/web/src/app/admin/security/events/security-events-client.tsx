"use client";

import { useRouter } from "next/navigation";
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
import type { SecurityEvent } from "@/lib/admin-types";

const FILTERS = ["all", "login_failed", "login_blocked", "login_success", "user_disabled", "user_enabled", "sessions_revoked", "admin_password_reset"] as const;

export function SecurityEventsClient({
  events,
  total,
}: {
  events: SecurityEvent[];
  total: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  const filtered =
    filter === "all" ? events : events.filter((e) => e.event_type === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            className="h-8 text-xs capitalize"
            onClick={() => setFilter(f)}
          >
            {f.replace(/_/g, " ")}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Showing {filtered.length} of {total} events (latest {events.length} loaded).
      </p>
      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>When</DataTableHead>
            <DataTableHead>Event</DataTableHead>
            <DataTableHead>Email</DataTableHead>
            <DataTableHead>IP</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={4} message="No events match this filter." />
            ) : (
              filtered.map((e) => (
                <DataTableRow key={e.id}>
                  <DataTableCell className="text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </DataTableCell>
                  <DataTableCell className="capitalize font-medium">
                    {e.event_type.replace(/_/g, " ")}
                  </DataTableCell>
                  <DataTableCell>{e.email ?? "—"}</DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {e.ip_address ?? "—"}
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

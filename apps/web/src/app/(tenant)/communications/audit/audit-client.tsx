"use client";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { CommunicationsSubNav } from "../communications-sub-nav";
import type { NotificationAuditLogRow } from "@/lib/notifications/types";

function formatAction(action: string) {
  return action.replace(/_/g, " ");
}

export function AuditClient({ rows }: { rows: NotificationAuditLogRow[] }) {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Communications"
        title="Audit log"
        description="Configuration changes, retries, and delivery cancellations."
      />
      <CommunicationsSubNav active="/communications/audit" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>When</DataTableHead>
                <DataTableHead>Action</DataTableHead>
                <DataTableHead>Entity</DataTableHead>
                <DataTableHead>User</DataTableHead>
                <DataTableHead>Details</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {rows.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No audit entries yet." />
                ) : (
                  rows.map((r) => (
                    <DataTableRow key={r.id}>
                      <DataTableCell className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </DataTableCell>
                      <DataTableCell>
                        <Badge variant="secondary">{formatAction(r.action)}</Badge>
                      </DataTableCell>
                      <DataTableCell className="text-xs">
                        {r.entity_type ?? "—"}
                        {r.entity_id ? (
                          <span className="mt-0.5 block font-mono text-2xs text-muted-foreground">
                            {r.entity_id.slice(0, 8)}…
                          </span>
                        ) : null}
                      </DataTableCell>
                      <DataTableCell className="text-xs">{r.user_email ?? "system"}</DataTableCell>
                      <DataTableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {Object.keys(r.details ?? {}).length > 0
                          ? JSON.stringify(r.details)
                          : "—"}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}

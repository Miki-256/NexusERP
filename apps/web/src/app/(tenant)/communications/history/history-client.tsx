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
import type { NotificationDeliveryHistoryRow } from "@/lib/notifications/types";

export function HistoryClient({ rows }: { rows: NotificationDeliveryHistoryRow[] }) {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Communications"
        title="Delivery history"
        description="Recent notification deliveries across email and in-app channels."
      />
      <CommunicationsSubNav active="/communications/history" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>When</DataTableHead>
                <DataTableHead>Channel</DataTableHead>
                <DataTableHead>Event</DataTableHead>
                <DataTableHead>Recipient</DataTableHead>
                <DataTableHead>Status</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {rows.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No deliveries yet." />
                ) : (
                  rows.map((r) => (
                    <DataTableRow key={r.id}>
                      <DataTableCell className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </DataTableCell>
                      <DataTableCell>{r.channel}</DataTableCell>
                      <DataTableCell className="font-mono text-xs">{r.event_type ?? "—"}</DataTableCell>
                      <DataTableCell className="max-w-[180px] truncate text-xs">{r.recipient_ref}</DataTableCell>
                      <DataTableCell>
                        <Badge variant={r.status === "sent" || r.status === "delivered" ? "default" : "secondary"}>
                          {r.status}
                        </Badge>
                        {r.last_error ? (
                          <p className="mt-1 text-xs text-destructive">{r.last_error}</p>
                        ) : null}
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

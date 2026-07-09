"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
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
import type { NotificationQueueRow } from "@/lib/notifications/types";

export function QueueClient({
  orgId,
  rows: initial,
  initialEventsPending = 0,
}: {
  orgId: string;
  rows: NotificationQueueRow[];
  initialEventsPending?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [eventsPending, setEventsPending] = useState(initialEventsPending);

  async function reload(status: string | null) {
    setFilter(status);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_notification_queue", {
      p_org_id: orgId,
      p_status: status,
      p_limit: 50,
    });
    if (error) {
      toast({ title: "Could not load queue", description: error.message, variant: "destructive" });
      return;
    }
    setRows(parseRpcJsonArray<NotificationQueueRow>(data));
  }

  async function processPending() {
    setBusy("process");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("process_notification_events_for_org", {
      p_org_id: orgId,
      p_limit: 50,
    });
    setBusy("");
    if (error) {
      toast({ title: "Processing failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = (data ?? {}) as { events_processed?: number; deliveries_created?: number };
    toast({
      title: "Events processed",
      description: `${result.events_processed ?? 0} event(s), ${result.deliveries_created ?? 0} delivery(ies) created.`,
    });
    setEventsPending(0);
    await reload(filter);
    router.refresh();
  }

  async function retry(id: string) {
    setBusy(id);
    const supabase = createClient();
    const { error } = await supabase.rpc("retry_notification_delivery", {
      p_org_id: orgId,
      p_delivery_id: id,
    });
    setBusy("");
    if (error) {
      toast({ title: "Retry failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Queued for retry", description: "Worker will pick it up on the next cron run." });
    await reload(filter);
    router.refresh();
  }

  const hasEventPending = rows.some((r) => r.status === "event_pending") || eventsPending > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Communications"
        title="Delivery queue"
        description="Pending and failed outbound messages. Retry failed deliveries after fixing channel config."
      />
      <CommunicationsSubNav active="/communications/queue" />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === null ? "default" : "outline"} onClick={() => reload(null)}>
          All
        </Button>
        <Button size="sm" variant={filter === "pending" ? "default" : "outline"} onClick={() => reload("pending")}>
          Pending
        </Button>
        <Button size="sm" variant={filter === "failed" ? "default" : "outline"} onClick={() => reload("failed")}>
          Failed
        </Button>
        {hasEventPending && (
          <Button size="sm" variant="secondary" disabled={busy === "process"} onClick={() => processPending()}>
            Process pending events
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead>Channel</DataTableHead>
                <DataTableHead>Event</DataTableHead>
                <DataTableHead>Recipient</DataTableHead>
                <DataTableHead align="right">Attempts</DataTableHead>
                <DataTableHead align="right">Action</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {rows.length === 0 ? (
                  <DataTableEmpty colSpan={6} message="Queue is empty." />
                ) : (
                  rows.map((r) => (
                    <DataTableRow key={`${r.row_kind ?? "delivery"}-${r.id}`}>
                      <DataTableCell>
                        <Badge
                          variant={
                            r.status === "failed" || r.status === "dead_letter"
                              ? "destructive"
                              : r.status === "event_pending"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {r.status === "event_pending" ? "event pending" : r.status}
                        </Badge>
                        {r.last_error ? (
                          <p className="mt-1 max-w-xs truncate text-xs text-destructive">{r.last_error}</p>
                        ) : null}
                      </DataTableCell>
                      <DataTableCell>{r.channel}</DataTableCell>
                      <DataTableCell className="font-mono text-xs">{r.event_type ?? "—"}</DataTableCell>
                      <DataTableCell className="max-w-[160px] truncate text-xs">{r.recipient_ref}</DataTableCell>
                      <DataTableCell align="right">
                        {r.status === "event_pending" ? "—" : `${r.attempts}/${r.max_attempts}`}
                      </DataTableCell>
                      <DataTableCell align="right">
                        {r.status === "event_pending" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === "process"}
                            onClick={() => processPending()}
                          >
                            Process
                          </Button>
                        ) : (r.status === "failed" || r.status === "dead_letter") ? (
                          <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => retry(r.id)}>
                            Retry
                          </Button>
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

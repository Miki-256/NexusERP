"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
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
import type { NotificationFailedRow } from "@/lib/notifications/types";
import { AlertTriangle, Ban, RefreshCw, Trash2 } from "lucide-react";

type DlqSummary = {
  failed: number;
  dead_letter: number;
  cancelled: number;
  oldest_failed_at: string | null;
};

type DeliveryDetail = {
  id: string;
  channel: string;
  recipient_ref: string;
  subject: string | null;
  body: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  provider_response: unknown;
  created_at: string;
  event_type: string | null;
  event_payload: Record<string, unknown> | null;
};

export function FailedClient({
  orgId,
  rows: initial,
  summary: initialSummary,
}: {
  orgId: string;
  rows: NotificationFailedRow[];
  summary: DlqSummary;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState(initial);
  const [summary, setSummary] = useState(initialSummary);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);

  async function reload(status: string | null = filter) {
    setFilter(status);
    const supabase = createClient();
    const [listRes, sumRes] = await Promise.all([
      supabase.rpc("list_notification_failed_deliveries", {
        p_org_id: orgId,
        p_limit: 50,
        p_status: status,
      }),
      supabase.rpc("notification_dlq_summary", { p_org_id: orgId }),
    ]);
    if (listRes.error) {
      toast({ title: "Could not load", description: listRes.error.message, variant: "destructive" });
      return;
    }
    setRows(parseRpcJsonArray<NotificationFailedRow>(listRes.data));
    if (sumRes.data && typeof sumRes.data === "object") {
      setSummary(sumRes.data as DlqSummary);
    }
  }

  async function retryOne(id: string) {
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
    toast({ title: "Queued for retry" });
    setDetail(null);
    await reload();
    router.refresh();
  }

  async function cancelOne(id: string) {
    setBusy(`cancel-${id}`);
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_notification_delivery", {
      p_org_id: orgId,
      p_delivery_id: id,
    });
    setBusy("");
    if (error) {
      toast({ title: "Cancel failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Delivery cancelled" });
    setDetail(null);
    await reload();
    router.refresh();
  }

  async function retryAll() {
    setBusy("all");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("retry_all_failed_notification_deliveries", {
      p_org_id: orgId,
      p_limit: 25,
    });
    setBusy("");
    if (error) {
      toast({ title: "Bulk retry failed", description: error.message, variant: "destructive" });
      return;
    }
    const retried = (data as { retried?: number })?.retried ?? 0;
    toast({ title: "Bulk retry queued", description: `${retried} delivery(ies) re-queued.` });
    await reload();
    router.refresh();
  }

  async function cancelAll() {
    if (!confirm("Cancel all visible failed / dead-letter deliveries? This cannot be undone.")) return;
    setBusy("cancel-all");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("cancel_failed_notification_deliveries", {
      p_org_id: orgId,
      p_limit: 50,
      p_status: filter,
    });
    setBusy("");
    if (error) {
      toast({ title: "Bulk cancel failed", description: error.message, variant: "destructive" });
      return;
    }
    const cancelled = (data as { cancelled?: number })?.cancelled ?? 0;
    toast({ title: "Cancelled", description: `${cancelled} delivery(ies).` });
    await reload();
    router.refresh();
  }

  async function purgeOld() {
    if (!confirm("Permanently delete dead-letter and cancelled rows older than 30 days?")) return;
    setBusy("purge");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("purge_notification_dead_letter", {
      p_org_id: orgId,
      p_older_than_days: 30,
      p_limit: 100,
    });
    setBusy("");
    if (error) {
      toast({ title: "Purge failed", description: error.message, variant: "destructive" });
      return;
    }
    const deleted = (data as { deleted?: number })?.deleted ?? 0;
    toast({ title: "DLQ purged", description: `${deleted} row(s) deleted.` });
    await reload();
    router.refresh();
  }

  async function inspect(id: string) {
    setBusy(`inspect-${id}`);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_notification_delivery_detail", {
      p_org_id: orgId,
      p_delivery_id: id,
    });
    setBusy("");
    if (error) {
      toast({ title: "Could not load detail", description: error.message, variant: "destructive" });
      return;
    }
    setDetail(data as DeliveryDetail);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Communications"
        title="Failed & dead-letter"
        description="Deliveries that exhausted retries or hit permanent errors. Inspect, retry, cancel, or purge old DLQ rows."
      />
      <CommunicationsSubNav active="/communications/failed" />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Failed (retryable)" value={String(summary.failed ?? 0)} icon={RefreshCw} />
        <StatCard label="Dead letter" value={String(summary.dead_letter ?? 0)} icon={AlertTriangle} />
        <StatCard label="Cancelled" value={String(summary.cancelled ?? 0)} icon={Ban} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={filter === null ? "default" : "outline"} onClick={() => reload(null)}>
          All
        </Button>
        <Button
          size="sm"
          variant={filter === "failed" ? "default" : "outline"}
          onClick={() => reload("failed")}
        >
          Failed
        </Button>
        <Button
          size="sm"
          variant={filter === "dead_letter" ? "default" : "outline"}
          onClick={() => reload("dead_letter")}
        >
          Dead letter
        </Button>
        <Button size="sm" variant="default" disabled={rows.length === 0 || busy === "all"} onClick={() => retryAll()}>
          Retry all (up to 25)
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length === 0 || busy === "cancel-all"}
          onClick={() => cancelAll()}
        >
          Cancel filtered
        </Button>
        <Button size="sm" variant="outline" disabled={busy === "purge"} onClick={() => purgeOld()}>
          <Trash2 className="h-4 w-4" />
          Purge 30d+
        </Button>
      </div>

      {detail && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Delivery detail</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => retryOne(detail.id)} disabled={busy === detail.id}>
                Retry
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancelOne(detail.id)}
                disabled={busy === `cancel-${detail.id}`}
              >
                Cancel
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDetail(null)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Status:</span> {detail.status} · {detail.channel} ·{" "}
              {detail.attempts}/{detail.max_attempts} attempts
            </p>
            <p>
              <span className="text-muted-foreground">Event:</span>{" "}
              <code className="text-xs">{detail.event_type ?? "—"}</code>
            </p>
            <p>
              <span className="text-muted-foreground">Recipient:</span> {detail.recipient_ref}
            </p>
            {detail.last_error ? <p className="text-destructive">{detail.last_error}</p> : null}
            {detail.subject ? (
              <p>
                <span className="text-muted-foreground">Subject:</span> {detail.subject}
              </p>
            ) : null}
            <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-2 text-xs whitespace-pre-wrap">
              {detail.body}
            </pre>
            {detail.event_payload ? (
              <pre className="max-h-32 overflow-auto rounded border bg-muted/40 p-2 text-xs">
                {JSON.stringify(detail.event_payload, null, 2)}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failed deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>When</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead>Channel</DataTableHead>
                <DataTableHead>Event</DataTableHead>
                <DataTableHead>Recipient</DataTableHead>
                <DataTableHead align="right">Attempts</DataTableHead>
                <DataTableHead align="right">Actions</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {rows.length === 0 ? (
                  <DataTableEmpty colSpan={7} message="No failed deliveries." />
                ) : (
                  rows.map((r) => (
                    <DataTableRow key={r.id}>
                      <DataTableCell className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </DataTableCell>
                      <DataTableCell>
                        <Badge variant="destructive">{r.status}</Badge>
                        {r.last_error ? (
                          <p className="mt-1 max-w-xs truncate text-xs text-destructive">{r.last_error}</p>
                        ) : null}
                      </DataTableCell>
                      <DataTableCell>{r.channel}</DataTableCell>
                      <DataTableCell className="font-mono text-xs">{r.event_type ?? "—"}</DataTableCell>
                      <DataTableCell className="max-w-[160px] truncate text-xs">{r.recipient_ref}</DataTableCell>
                      <DataTableCell align="right">
                        {r.attempts}/{r.max_attempts}
                      </DataTableCell>
                      <DataTableCell align="right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === `inspect-${r.id}`}
                            onClick={() => inspect(r.id)}
                          >
                            Inspect
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => retryOne(r.id)}>
                            Retry
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === `cancel-${r.id}`}
                            onClick={() => cancelOne(r.id)}
                          >
                            Cancel
                          </Button>
                        </div>
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { StatusBadge } from "@/components/layout/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { formatCurrency } from "@/lib/utils";
import { SELECT_CLS } from "@/lib/ui-classes";

export type CollectionsQueueRow = {
  id: string;
  invoice_no: string;
  customer_name: string | null;
  customer_email?: string | null;
  due_date: string | null;
  balance_due: number;
  days_overdue: number;
  collection_status: string;
  dunning_level: number;
  last_dunning_at?: string | null;
};

const COLLECTION_STATUSES = ["open", "promised", "dispute", "in_collections", "written_off"] as const;

export function ArCollectionsTab({
  orgId,
  currency,
  canManage,
  queue: initialQueue,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  queue: CollectionsQueueRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [queue, setQueue] = useState(initialQueue);
  const [busy, setBusy] = useState("");
  const money = (n: number) => formatCurrency(n, currency);

  async function refreshQueue() {
    const supabase = createClient();
    const { data } = await supabase.rpc("list_ar_collections_queue", { p_org_id: orgId });
    setQueue((data as CollectionsQueueRow[]) ?? []);
  }

  async function sendDunning(id: string) {
    setBusy(id + "dunning");
    const supabase = createClient();
    const { error } = await supabase.rpc("send_invoice_dunning", { p_invoice_id: id });
    setBusy("");
    if (error) {
      toast({ title: "Dunning failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Reminder sent" });
    await refreshQueue();
    router.refresh();
  }

  async function runBatch() {
    setBusy("batch");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("run_ar_dunning_batch", { p_org_id: orgId });
    setBusy("");
    if (error) {
      toast({ title: "Batch failed", description: error.message, variant: "destructive" });
      return;
    }
    const sent = (data as { sent?: number })?.sent ?? 0;
    toast({ title: `Dunning batch complete — ${sent} sent` });
    await refreshQueue();
    router.refresh();
  }

  async function setStatus(id: string, status: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("set_invoice_collection_status", {
      p_invoice_id: id,
      p_status: status,
    });
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    await refreshQueue();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <ReportSection
        title="Collections queue"
        subtitle="Overdue and disputed invoices — escalate dunning or update collection status"
        actions={
          canManage ? (
            <Button variant="outline" size="sm" disabled={busy === "batch"} onClick={() => void runBatch()}>
              {busy === "batch" ? "Running…" : "Run dunning batch"}
            </Button>
          ) : undefined
        }
      >
        <DataTable>
          <table className="w-full text-sm">
            <DataTableHeader>
              <DataTableHead>Invoice</DataTableHead>
              <DataTableHead>Customer</DataTableHead>
              <DataTableHead>Due</DataTableHead>
              <DataTableHead align="right">Balance</DataTableHead>
              <DataTableHead align="right">Days overdue</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Level</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {queue.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 8 : 7} message="No invoices in the collections queue." />
              ) : (
                queue.map((row) => (
                  <DataTableRow key={row.id}>
                    <DataTableCell className="font-mono text-xs">{row.invoice_no}</DataTableCell>
                    <DataTableCell>{row.customer_name || "—"}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">{row.due_date || "—"}</DataTableCell>
                    <DataTableCell align="right" className="font-mono font-semibold text-amber-700">
                      {money(Number(row.balance_due))}
                    </DataTableCell>
                    <DataTableCell align="right">{row.days_overdue}</DataTableCell>
                    <DataTableCell>
                      {canManage ? (
                        <select
                          className={SELECT_CLS + " h-8 text-xs"}
                          value={row.collection_status}
                          onChange={(e) => void setStatus(row.id, e.target.value)}
                        >
                          {COLLECTION_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge status={row.collection_status} />
                      )}
                    </DataTableCell>
                    <DataTableCell align="right">{row.dunning_level}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === row.id + "dunning"}
                          onClick={() => void sendDunning(row.id)}
                        >
                          {busy === row.id + "dunning" ? "Sending…" : "Send reminder"}
                        </Button>
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>
    </div>
  );
}

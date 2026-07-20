"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FormCard } from "@/components/layout/form-card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { OrgOpsDetail } from "@/lib/admin-types";
import { formatCurrency } from "@/lib/utils";
import { RefreshCw, X } from "lucide-react";

export function OrgOpsInspector({
  organizationId,
  organizationName,
  canWrite,
  onClose,
  embedded = false,
}: {
  organizationId: string;
  organizationName?: string | null;
  canWrite: boolean;
  onClose?: () => void;
  embedded?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<OrgOpsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const { data: detail, error } = await supabase.rpc("admin_get_org_ops_detail", {
      p_org_id: organizationId,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Could not load org ops", description: error.message, variant: "destructive" });
      return;
    }
    setData(detail as OrgOpsDetail);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when org changes
  }, [organizationId]);

  async function retryLedger(saleId: string) {
    setBusy(`retry-${saleId}`);
    try {
      const res = await fetch("/api/admin/health/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_ledger", sale_id: saleId }),
      });
      const json = (await res.json()) as { error?: string; result?: { ok?: boolean; error?: string } };
      if (!res.ok || json.result?.ok === false) {
        toast({
          title: "Retry failed",
          description: json.result?.error ?? json.error ?? res.statusText,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Sale posted to ledger" });
      await load();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function postUnposted() {
    setBusy("unposted");
    try {
      const res = await fetch("/api/admin/health/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "post_unposted",
          organization_id: organizationId,
          limit: 100,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        result?: { posted?: number; skipped?: number; remaining?: number };
      };
      if (!res.ok) {
        toast({ title: "Batch post failed", description: json.error ?? res.statusText, variant: "destructive" });
        return;
      }
      toast({
        title: "Batch post finished",
        description: `Posted ${json.result?.posted ?? 0}, skipped ${json.result?.skipped ?? 0}, remaining ${json.result?.remaining ?? "—"}`,
      });
      await load();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const title = `Ops · ${data?.organization_name ?? organizationName ?? "Organization"}`;
  const body = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : data
              ? `${data.counts.ledger_queue} ledger · ${data.counts.webhook_queue} webhooks · ${data.counts.unposted_sales} unposted`
              : "No data"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={loading || busy !== null} onClick={() => void load()}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {canWrite && (
            <Button type="button" size="sm" disabled={busy !== null} onClick={() => void postUnposted()}>
              {busy === "unposted" ? "…" : "Post up to 100"}
            </Button>
          )}
          {onClose && (
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
              Close
            </Button>
          )}
        </div>
      </div>

      {data && (
        <>
          <div>
            <h3 className="mb-2 text-sm font-medium">Ledger queue</h3>
            {data.ledger_queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Empty</p>
            ) : (
              <DataTable>
                <table className="w-full">
                  <DataTableHeader>
                    <DataTableHead>Receipt</DataTableHead>
                    <DataTableHead>Attempts</DataTableHead>
                    <DataTableHead>Error</DataTableHead>
                    {canWrite && <DataTableHead align="right">Action</DataTableHead>}
                  </DataTableHeader>
                  <DataTableBody>
                    {data.ledger_queue.map((row) => (
                      <DataTableRow key={row.sale_id}>
                        <DataTableCell className="font-mono text-xs">
                          {row.receipt_no ?? row.sale_id.slice(0, 8)}
                          {row.total != null ? ` · ${formatCurrency(Number(row.total))}` : ""}
                        </DataTableCell>
                        <DataTableCell>{row.attempts}</DataTableCell>
                        <DataTableCell className="max-w-xs truncate text-red-700">{row.last_error ?? "—"}</DataTableCell>
                        {canWrite && (
                          <DataTableCell align="right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => void retryLedger(row.sale_id)}
                            >
                              {busy === `retry-${row.sale_id}` ? "…" : "Retry"}
                            </Button>
                          </DataTableCell>
                        )}
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </table>
              </DataTable>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Unposted sales (sample)</h3>
            {data.unposted_sales.length === 0 ? (
              <p className="text-sm text-muted-foreground">None</p>
            ) : (
              <DataTable>
                <table className="w-full">
                  <DataTableHeader>
                    <DataTableHead>Receipt</DataTableHead>
                    <DataTableHead className="text-right">Total</DataTableHead>
                    <DataTableHead>Created</DataTableHead>
                  </DataTableHeader>
                  <DataTableBody>
                    {data.unposted_sales.map((row) => (
                      <DataTableRow key={row.sale_id}>
                        <DataTableCell className="font-mono text-xs">{row.receipt_no ?? row.sale_id.slice(0, 8)}</DataTableCell>
                        <DataTableCell className="text-right">{formatCurrency(Number(row.total ?? 0))}</DataTableCell>
                        <DataTableCell className="text-muted-foreground">
                          {new Date(row.created_at).toLocaleString()}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </table>
              </DataTable>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Pending payment webhooks</h3>
            {data.webhook_queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Empty</p>
            ) : (
              <DataTable>
                <table className="w-full">
                  <DataTableHeader>
                    <DataTableHead>Reference</DataTableHead>
                    <DataTableHead>Provider</DataTableHead>
                    <DataTableHead className="text-right">Amount</DataTableHead>
                    <DataTableHead>Created</DataTableHead>
                  </DataTableHeader>
                  <DataTableBody>
                    {data.webhook_queue.map((row) => (
                      <DataTableRow key={row.id}>
                        <DataTableCell className="font-mono text-xs">{row.reference}</DataTableCell>
                        <DataTableCell>{row.provider}</DataTableCell>
                        <DataTableCell className="text-right">
                          {row.amount != null ? formatCurrency(Number(row.amount)) : "—"}
                        </DataTableCell>
                        <DataTableCell className="text-muted-foreground">
                          {new Date(row.created_at).toLocaleString()}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </table>
              </DataTable>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Org page:{" "}
            <Link href={`/admin/organizations/${organizationId}`} className="text-primary hover:underline">
              Open organization
            </Link>
          </p>
        </>
      )}
    </div>
  );

  if (embedded) {
    return (
      <FormCard title={title} description="Per-tenant queue and unposted-sale inspector (Support L4).">
        {body}
      </FormCard>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-background p-4 shadow-lg">
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        {body}
      </div>
    </div>
  );
}

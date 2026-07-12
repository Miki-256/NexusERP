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

export type PaymentRunRow = {
  id: string;
  run_date: string;
  payment_method: string;
  status: string;
  total_amount: number;
  memo: string | null;
  line_count: number;
  dual_approval_required?: boolean;
  approval_count?: number;
};

export type OpenBillOption = {
  id: string;
  vendor_name: string | null;
  balance_due: number;
  due_date: string | null;
};

export function ApPaymentRunsTab({
  orgId,
  currency,
  canManage,
  runs: initialRuns,
  openBills,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  runs: PaymentRunRow[];
  openBills: OpenBillOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [runs, setRuns] = useState(initialRuns);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<"cash" | "mobile_money" | "bank_transfer">("bank_transfer");
  const [busy, setBusy] = useState("");

  const money = (n: number) => formatCurrency(n, currency);

  async function refreshRuns() {
    const supabase = createClient();
    const { data } = await supabase.rpc("list_payment_runs", { p_org_id: orgId });
    setRuns((data as PaymentRunRow[]) ?? []);
  }

  function toggleBill(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createRun() {
    if (selected.size === 0) return;
    setBusy("create");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_payment_run", {
      p_org_id: orgId,
      p_bill_ids: Array.from(selected),
      p_payment_method: method,
    });
    setBusy("");
    if (error) {
      toast({ title: "Could not create run", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Payment run created" });
    setSelected(new Set());
    await refreshRuns();
    router.refresh();
  }

  async function approveRun(id: string) {
    setBusy(id + "approve");
    const supabase = createClient();
    const { error } = await supabase.rpc("approve_payment_run", { p_run_id: id });
    setBusy("");
    if (error) {
      toast({ title: "Approve failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Payment run approved" });
    await refreshRuns();
    router.refresh();
  }

  async function executeRun(id: string) {
    setBusy(id + "execute");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("execute_payment_run", { p_run_id: id });
    setBusy("");
    if (error) {
      toast({ title: "Execute failed", description: error.message, variant: "destructive" });
      return;
    }
    const paid = (data as { paid?: number })?.paid ?? 0;
    toast({ title: `Payment run executed — ${paid} bill(s) paid` });
    await refreshRuns();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <ReportSection title="New payment run" subtitle="Select open bills to pay in batch">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Payment method</p>
              <select className={SELECT_CLS} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
              </select>
            </div>
            <Button disabled={busy === "create" || selected.size === 0} onClick={() => void createRun()}>
              {busy === "create" ? "Creating…" : `Create run (${selected.size})`}
            </Button>
          </div>
          <DataTable>
            <table className="w-full text-sm">
              <DataTableHeader>
                <DataTableHead>Select</DataTableHead>
                <DataTableHead>Vendor</DataTableHead>
                <DataTableHead>Due</DataTableHead>
                <DataTableHead align="right">Balance</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {openBills.length === 0 ? (
                  <DataTableEmpty colSpan={4} message="No open bills available." />
                ) : (
                  openBills.map((b) => (
                    <DataTableRow key={b.id}>
                      <DataTableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(b.id)}
                          onChange={() => toggleBill(b.id)}
                          className="h-4 w-4 rounded border-input"
                        />
                      </DataTableCell>
                      <DataTableCell>{b.vendor_name || "—"}</DataTableCell>
                      <DataTableCell className="text-muted-foreground">{b.due_date || "—"}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(b.balance_due))}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}

      <ReportSection title="Payment runs" subtitle="Draft → approve → execute">
        <DataTable>
          <table className="w-full text-sm">
            <DataTableHeader>
              <DataTableHead>Date</DataTableHead>
              <DataTableHead>Method</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Bills</DataTableHead>
              <DataTableHead align="right">Total</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {runs.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="No payment runs yet." />
              ) : (
                runs.map((r) => (
                  <DataTableRow key={r.id}>
                    <DataTableCell>{r.run_date}</DataTableCell>
                    <DataTableCell className="capitalize">{r.payment_method.replace(/_/g, " ")}</DataTableCell>
                    <DataTableCell><StatusBadge status={r.status} /></DataTableCell>
                    <DataTableCell align="right">{r.line_count}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(r.total_amount))}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right" className="space-x-2">
                        {r.status === "draft" && (
                          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void approveRun(r.id)}>
                            {r.dual_approval_required && (r.approval_count ?? 0) < 1
                              ? "First approval"
                              : "Approve"}
                          </Button>
                        )}
                        {r.status === "approved" && (
                          <Button size="sm" disabled={!!busy} onClick={() => void executeRun(r.id)}>
                            Execute
                          </Button>
                        )}
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

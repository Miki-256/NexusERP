"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
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
import { PAGE_SHELL } from "@/lib/ui-classes";
import { formatCurrency } from "@/lib/utils";
import { runHrMutation } from "@/lib/hr/mutations";
import type { PayrollRunDetail } from "@/lib/hr/types";
import { ArrowLeft, Check, Download, Send, X } from "lucide-react";

export function PayrollRunClient({
  organizationId,
  currency,
  detail,
  backHref = "/hr",
}: {
  organizationId: string;
  currency: string;
  detail: PayrollRunDetail;
  backHref?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { run, payslips, can_manage: canManage } = detail;
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("submit_payroll_run", { p_run_id: run.id });
        return { error };
      },
      { successTitle: "Submitted for approval" }
    );
    setBusy(false);
  }

  async function approve() {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { data: wfData, error: wfError } = await supabase.rpc("approve_workflow_step", {
          p_entity_type: "payroll_run",
          p_entity_id: run.id,
          p_approved: true,
        });
        if (wfError) return { error: wfError };
        const wf = wfData as { workflow?: boolean } | null;
        if (wf?.workflow) return { error: null };
        const { error } = await supabase.rpc("approve_payroll_run", { p_run_id: run.id });
        return { error };
      },
      { successTitle: "Payroll approved" }
    );
    setBusy(false);
  }

  async function post() {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("post_payroll_run", { p_run_id: run.id });
        return { error };
      },
      { successTitle: "Payroll posted to ledger" }
    );
    setBusy(false);
  }

  async function cancel() {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("cancel_payroll_run", { p_run_id: run.id });
        return { error };
      },
      { successTitle: "Payroll run cancelled" }
    );
    setBusy(false);
  }

  async function exportBank() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("export_payroll_bank_file", { p_run_id: run.id });
    if (error) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
      return;
    }
    const blob = new Blob([data as string], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-bank-${run.period_end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={PAGE_SHELL}>
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link href={backHref}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </Button>

      <PageHeader
        title={canManage ? `Payroll ${run.period_start} → ${run.period_end}` : `Payslip ${run.period_start} → ${run.period_end}`}
        description={
          canManage
            ? `Net ${formatCurrency(Number(run.total_net), currency)}`
            : payslips[0]
              ? `Net pay ${formatCurrency(payslips[0].net, currency)}`
              : undefined
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.status} />
            {canManage && run.status === "draft" && (
              <Button size="sm" disabled={busy} onClick={() => void submit()}>
                <Send className="h-4 w-4" />
                Submit
              </Button>
            )}
            {canManage && (run.status === "pending_approval" || run.status === "draft") && (
              <Button size="sm" disabled={busy} onClick={() => void approve()}>
                <Check className="h-4 w-4" />
                Approve
              </Button>
            )}
            {canManage && (run.status === "approved" || run.status === "draft") && (
              <Button size="sm" disabled={busy} onClick={() => void post()}>
                Post to ledger
              </Button>
            )}
            {canManage && run.status === "posted" && (
              <Button size="sm" variant="outline" onClick={() => void exportBank()}>
                <Download className="h-4 w-4" />
                Bank CSV
              </Button>
            )}
            {canManage && run.status !== "posted" && run.status !== "cancelled" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel()}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        }
      />

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Employee</DataTableHead>
            <DataTableHead align="right">Gross</DataTableHead>
            <DataTableHead align="right">Allowances</DataTableHead>
            <DataTableHead align="right">Deductions</DataTableHead>
            <DataTableHead align="right">Tax</DataTableHead>
            <DataTableHead align="right">Net</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {payslips.length === 0 ? (
              <DataTableEmpty colSpan={6} message="No payslips in this run." />
            ) : (
              payslips.map((p) => (
                <DataTableRow key={p.id}>
                  <DataTableCell>
                    <div>
                      <p className="font-medium">{p.employee_name}</p>
                      {p.lines.length > 0 && (
                        <ul className="mt-1 text-xs text-muted-foreground">
                          {p.lines.map((l, i) => (
                            <li key={i}>
                              {l.component_name}: {formatCurrency(l.amount, currency)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </DataTableCell>
                  <DataTableCell align="right" className="font-mono">
                    {formatCurrency(p.gross, currency)}
                  </DataTableCell>
                  <DataTableCell align="right" className="font-mono">
                    {formatCurrency(p.allowances, currency)}
                  </DataTableCell>
                  <DataTableCell align="right" className="font-mono">
                    {formatCurrency(p.deductions, currency)}
                  </DataTableCell>
                  <DataTableCell align="right" className="font-mono">
                    {formatCurrency(p.tax, currency)}
                  </DataTableCell>
                  <DataTableCell align="right" className="font-mono font-semibold">
                    {formatCurrency(p.net, currency)}
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>
    </div>
  );
}

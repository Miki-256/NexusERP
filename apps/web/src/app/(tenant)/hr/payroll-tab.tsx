"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
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
import { runHrMutation } from "@/lib/hr/mutations";
import type { PayrollPreviewLine, PayrollRunRow } from "@/lib/hr/types";
import { Calculator, Download, ExternalLink, Send } from "lucide-react";

type PayMethod = "cash" | "mobile_money" | "bank_transfer";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function monthStartIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function PayrollTab({
  organizationId,
  currency,
  runs,
  onChanged,
}: {
  organizationId: string;
  currency: string;
  runs: PayrollRunRow[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [periodStart, setPeriodStart] = useState(monthStartIso());
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [method, setMethod] = useState<PayMethod>("bank_transfer");
  const [preview, setPreview] = useState<PayrollPreviewLine[]>([]);
  const [busy, setBusy] = useState(false);

  const previewTotals = useMemo(() => {
    return preview.reduce(
      (acc, p) => ({
        gross: acc.gross + p.gross + p.allowances,
        net: acc.net + p.net,
      }),
      { gross: 0, net: 0 }
    );
  }, [preview]);

  async function calculatePreview() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("calculate_payroll_preview", { p_org_id: organizationId });
    setBusy(false);
    if (error) {
      toast({ title: "Calculation failed", description: error.message, variant: "destructive" });
      return;
    }
    setPreview((data as PayrollPreviewLine[]) ?? []);
    if (!data || (data as PayrollPreviewLine[]).length === 0) {
      toast({ title: "No active employees", description: "Add employees with base salary first." });
    }
  }

  async function createDraft() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_payroll_draft", {
      p_org_id: organizationId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_payment_method: method,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not create draft", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Payroll draft created" });
    router.push(`/hr/payroll/${data}`);
    onChanged();
  }

  async function exportBank(runId: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("export_payroll_bank_file", { p_run_id: runId });
    if (error) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
      return;
    }
    const blob = new Blob([data as string], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-bank-${runId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <FormCard title="Payroll calculation">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Period start</Label>
            <DatePicker value={periodStart} onChange={setPeriodStart} max={periodEnd || undefined} />
          </div>
          <div className="space-y-2">
            <Label>Period end</Label>
            <DatePicker value={periodEnd} onChange={setPeriodEnd} min={periodStart || undefined} />
          </div>
          <div className="space-y-2">
            <Label>Pay method</Label>
            <select className={SELECT_CLS} value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile money</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void calculatePreview()}>
            <Calculator className="h-4 w-4" />
            Calculate preview
          </Button>
          <Button type="button" disabled={busy || preview.length === 0} onClick={() => void createDraft()}>
            Create draft run
          </Button>
        </div>
      </FormCard>

      {preview.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2 text-left">Employee</th>
                <th className="p-2 text-right">Gross</th>
                <th className="p-2 text-right">Allowances</th>
                <th className="p-2 text-right">Deductions</th>
                <th className="p-2 text-right">Tax</th>
                <th className="p-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((p) => (
                <tr key={p.employee_id} className="border-b">
                  <td className="p-2 font-medium">{p.employee_name}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(p.gross, currency)}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(p.allowances, currency)}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(p.deductions, currency)}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(p.tax, currency)}</td>
                  <td className="p-2 text-right font-mono font-semibold">{formatCurrency(p.net, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="p-2">Totals</td>
                <td className="p-2 text-right font-mono" colSpan={4}>
                  {formatCurrency(previewTotals.gross, currency)}
                </td>
                <td className="p-2 text-right font-mono">{formatCurrency(previewTotals.net, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="font-semibold">Payroll history</h3>
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Period</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Net</DataTableHead>
              <DataTableHead align="right">Actions</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {runs.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No payroll runs yet." />
              ) : (
                runs.map((r) => (
                  <DataTableRow key={r.id}>
                    <DataTableCell>
                      {r.period_start} → {r.period_end}
                    </DataTableCell>
                    <DataTableCell>
                      <StatusBadge status={r.status} />
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono font-semibold">
                      {formatCurrency(Number(r.total_net), currency)}
                    </DataTableCell>
                    <DataTableCell align="right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/hr/payroll/${r.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                            View
                          </Link>
                        </Button>
                        {r.status === "posted" && (
                          <Button variant="outline" size="sm" onClick={() => void exportBank(r.id)}>
                            <Download className="h-3.5 w-3.5" />
                            Bank CSV
                          </Button>
                        )}
                      </div>
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { StatCard } from "@/components/layout/stat-card";
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
import { Percent } from "lucide-react";

export type TaxCodeRow = {
  id: string;
  code: string;
  name: string;
  rate: number;
  is_active: boolean;
};

export type TaxSummaryLine = {
  code: string;
  name: string;
  rate: number;
  taxable_base: number;
  tax_collected: number;
};

export function TaxTab({
  orgId,
  currency,
  canManage,
  from,
  to,
  taxCodes: initialCodes,
  taxSummary,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  from: string;
  to: string;
  taxCodes: TaxCodeRow[];
  taxSummary: { total_tax: number; lines: TaxSummaryLine[] };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);
  const [codes, setCodes] = useState(initialCodes);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);

  const summaryLines = taxSummary.lines ?? [];
  const totalTax = Number(taxSummary.total_tax ?? 0);

  const activeCount = useMemo(() => codes.filter((c) => c.is_active).length, [codes]);

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setRate("");
    setIsActive(true);
  }

  function startEdit(row: TaxCodeRow) {
    setEditingId(row.id);
    setCode(row.code);
    setName(row.name);
    setRate(String(row.rate));
    setIsActive(row.is_active);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const parsedRate = parseFloat(rate);
    if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      toast({ title: "Invalid rate", description: "Rate must be 0–100.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_tax_code", {
      p_org_id: orgId,
      p_tax_code_id: editingId,
      p_code: code.trim(),
      p_name: name.trim(),
      p_rate: parsedRate,
      p_is_active: isActive,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Tax code updated" : "Tax code created" });
    const { data: list } = await supabase.rpc("list_tax_codes", { p_org_id: orgId });
    setCodes((list as TaxCodeRow[]) ?? []);
    resetForm();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Tax codes" value={String(codes.length)} sub={`${activeCount} active`} icon={Percent} />
        <StatCard label="Tax collected" value={money(totalTax)} sub={`${from} → ${to}`} icon={Percent} />
        <StatCard
          label="Lines in report"
          value={String(summaryLines.length)}
          sub="Posted invoices & credit notes"
          icon={Percent}
        />
      </div>

      <ReportSection title="Tax summary" subtitle="Collected tax from posted invoices and credit notes in the selected period">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Code</DataTableHead>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead align="right">Rate</DataTableHead>
              <DataTableHead align="right">Taxable base</DataTableHead>
              <DataTableHead align="right">Tax</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {summaryLines.length === 0 ? (
                <DataTableEmpty colSpan={5} message="No posted invoice tax in this period." />
              ) : (
                summaryLines.map((row, i) => (
                  <DataTableRow key={`${row.code}-${i}`}>
                    <DataTableCell className="font-mono text-xs">{row.code}</DataTableCell>
                    <DataTableCell>{row.name}</DataTableCell>
                    <DataTableCell align="right">{Number(row.rate)}%</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.taxable_base))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.tax_collected))}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      <ReportSection title="Tax codes" subtitle="Assign per-line on invoices; STANDARD is seeded from org default rate">
        {canManage && (
          <form onSubmit={handleSave} className="mb-6 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="VAT15" disabled={!!editingId} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="VAT 15%" />
            </div>
            <div className="space-y-2">
              <Label>Rate %</Label>
              <Input type="number" min={0} max={100} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required />
            </div>
            <label className="flex items-center gap-2 text-sm sm:mt-8">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-input" />
              Active
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : editingId ? "Update code" : "Add code"}</Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
              )}
            </div>
          </form>
        )}

        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Code</DataTableHead>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead align="right">Rate</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {codes.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 5 : 4} message="No tax codes." />
              ) : (
                codes.map((row) => (
                  <DataTableRow key={row.id}>
                    <DataTableCell className="font-mono text-xs">{row.code}</DataTableCell>
                    <DataTableCell>{row.name}</DataTableCell>
                    <DataTableCell align="right">{Number(row.rate)}%</DataTableCell>
                    <DataTableCell>{row.is_active ? "Active" : "Inactive"}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(row)}>Edit</Button>
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

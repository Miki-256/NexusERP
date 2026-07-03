"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { ExportCsvButton } from "@/components/finance/export-csv-button";
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

export type ReportSnapshotRow = {
  id: string;
  name: string;
  report_type: string;
  params: Record<string, unknown>;
  created_at: string;
};

export function ReportsLibraryTab({
  orgId,
  currency,
  canManage,
  from,
  to,
  pnlMode,
  snapshots: initialSnapshots,
  currentPnl,
  currentBs,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  from: string;
  to: string;
  pnlMode: string;
  snapshots: ReportSnapshotRow[];
  currentPnl: Record<string, number | undefined>;
  currentBs: Record<string, number | undefined> | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number | undefined) => formatCurrency(n ?? 0, currency);
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [selected, setSelected] = useState<ReportSnapshotRow | null>(null);
  const [selectedResult, setSelectedResult] = useState<Record<string, unknown> | null>(null);
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveCurrentPnl() {
    if (!canManage || !saveName.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const params = { from, to, mode: pnlMode };
    const result = currentPnl;
    const { error } = await supabase.rpc("save_financial_report_snapshot", {
      p_org_id: orgId,
      p_name: saveName.trim(),
      p_report_type: "profit_and_loss",
      p_params: params,
      p_result: result,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "P&L snapshot saved" });
    setSaveName("");
    const { data } = await supabase.rpc("list_financial_report_snapshots", { p_org_id: orgId });
    setSnapshots((data as ReportSnapshotRow[]) ?? []);
    router.refresh();
  }

  async function saveCurrentBs() {
    if (!canManage || !saveName.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("save_financial_report_snapshot", {
      p_org_id: orgId,
      p_name: saveName.trim(),
      p_report_type: "balance_sheet",
      p_params: { as_of: to },
      p_result: currentBs ?? {},
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Balance sheet snapshot saved" });
    setSaveName("");
    const { data } = await supabase.rpc("list_financial_report_snapshots", { p_org_id: orgId });
    setSnapshots((data as ReportSnapshotRow[]) ?? []);
    router.refresh();
  }

  async function loadSnapshot(row: ReportSnapshotRow) {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_financial_report_snapshot", { p_snapshot_id: row.id });
    setBusy(false);
    if (error) {
      toast({ title: "Load failed", description: error.message, variant: "destructive" });
      return;
    }
    const payload = data as { result?: Record<string, unknown> };
    setSelected(row);
    setSelectedResult(payload.result ?? null);
  }

  async function deleteSnapshot(id: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("delete_financial_report_snapshot", { p_snapshot_id: id });
    setBusy(false);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
    if (selected?.id === id) {
      setSelected(null);
      setSelectedResult(null);
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <ReportSection title="Save current period" subtitle="Freeze report results for audit or comparison">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2 min-w-[12rem] flex-1">
              <Label>Snapshot name</Label>
              <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Q1 close P&L" />
            </div>
            <Button type="button" disabled={busy || !saveName.trim()} onClick={saveCurrentPnl}>
              Save P&amp;L
            </Button>
            <Button type="button" variant="outline" disabled={busy || !saveName.trim()} onClick={saveCurrentBs}>
              Save balance sheet
            </Button>
          </div>
        </ReportSection>
      )}

      <ReportSection title="Report library" subtitle={`${snapshots.length} saved snapshot${snapshots.length === 1 ? "" : "s"}`}>
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead>Saved</DataTableHead>
              <DataTableHead align="right">Actions</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {snapshots.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No saved reports yet." />
              ) : (
                snapshots.map((s) => (
                  <DataTableRow key={s.id}>
                    <DataTableCell>{s.name}</DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">{s.report_type}</DataTableCell>
                    <DataTableCell className="text-xs">{new Date(s.created_at).toLocaleString()}</DataTableCell>
                    <DataTableCell align="right" className="space-x-2">
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => loadSnapshot(s)}>View</Button>
                      {canManage && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => deleteSnapshot(s.id)}>Delete</Button>
                      )}
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      {selected && selectedResult && (
        <ReportSection
          title={selected.name}
          subtitle={selected.report_type}
          actions={
            selected.report_type === "profit_and_loss" ? (
              <ExportCsvButton
                filename={`snapshot-${selected.name}`}
                rows={[
                  { line: "Revenue", amount: selectedResult.revenue },
                  { line: "Net profit", amount: selectedResult.net_profit },
                ].map((r) => ({ line: String(r.line), amount: Number(r.amount ?? 0) }))}
                columns={[
                  { key: "line", label: "Line" },
                  { key: "amount", label: "Amount" },
                ]}
              />
            ) : undefined
          }
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(selectedResult).map(([k, v]) =>
              typeof v === "number" ? (
                <div key={k} className="flex justify-between border-b border-border/40 py-2">
                  <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
                  <dd className="font-mono">{money(v as number)}</dd>
                </div>
              ) : null
            )}
          </dl>
        </ReportSection>
      )}
    </div>
  );
}

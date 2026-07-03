"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { StatCard } from "@/components/layout/stat-card";
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
import { Building } from "lucide-react";

export type FixedAssetRow = {
  id: string;
  asset_no: string;
  name: string;
  acquisition_date: string;
  acquisition_cost: number;
  salvage_value: number;
  useful_life_months: number;
  monthly_depreciation: number;
  accumulated_depreciation: number;
  book_value: number;
  status: string;
};

export function FixedAssetsTab({
  orgId,
  currency,
  canManage,
  assets: initialAssets,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  assets: FixedAssetRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);
  const [assets, setAssets] = useState(initialAssets);
  const [busy, setBusy] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [acqDate, setAcqDate] = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState("");
  const [salvage, setSalvage] = useState("0");
  const [lifeMonths, setLifeMonths] = useState("60");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");

  const totalCost = assets.filter((a) => a.status !== "disposed").reduce((s, a) => s + Number(a.acquisition_cost), 0);
  const totalNbv = assets.filter((a) => a.status === "active").reduce((s, a) => s + Number(a.book_value), 0);

  async function refresh() {
    const supabase = createClient();
    const { data } = await supabase.rpc("list_fixed_assets", { p_org_id: orgId });
    setAssets((data as FixedAssetRow[]) ?? []);
    router.refresh();
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy("register");
    const supabase = createClient();
    const { error } = await supabase.rpc("register_fixed_asset", {
      p_org_id: orgId,
      p_name: name.trim(),
      p_acquisition_date: acqDate,
      p_cost: Number(cost),
      p_salvage: Number(salvage) || 0,
      p_useful_life_months: Number(lifeMonths) || 60,
      p_payment_method: paymentMethod,
    });
    setBusy("");
    if (error) {
      toast({ title: "Register failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Asset registered and posted to GL" });
    setShowForm(false);
    setName("");
    setCost("");
    await refresh();
  }

  async function runDepreciation() {
    setBusy("depr");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("run_depreciation_batch", { p_org_id: orgId });
    setBusy("");
    if (error) {
      toast({ title: "Depreciation failed", description: error.message, variant: "destructive" });
      return;
    }
    const posted = (data as { posted?: number })?.posted ?? 0;
    toast({ title: posted > 0 ? `Posted ${posted} depreciation entr${posted === 1 ? "y" : "ies"}` : "Nothing to depreciate" });
    await refresh();
  }

  async function dispose(id: string) {
    setBusy(id);
    const supabase = createClient();
    const { error } = await supabase.rpc("dispose_fixed_asset", {
      p_asset_id: id,
      p_proceeds: 0,
      p_payment_method: "bank_transfer",
    });
    setBusy("");
    if (error) {
      toast({ title: "Dispose failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Asset disposed" });
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active assets" value={String(assets.filter((a) => a.status === "active").length)} icon={Building} />
        <StatCard label="Total cost" value={money(totalCost)} icon={Building} />
        <StatCard label="Net book value" value={money(totalNbv)} icon={Building} />
      </div>

      <ReportSection title="Fixed asset register" subtitle="Straight-line depreciation · acquisition posts to account 1500">
        {canManage && (
          <div className="mb-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>Register asset</Button>
            <Button size="sm" onClick={runDepreciation} disabled={!!busy}>Run depreciation</Button>
          </div>
        )}

        {showForm && canManage && (
          <form onSubmit={register} className="mb-6 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Asset name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Delivery van" />
            </div>
            <div className="space-y-2">
              <Label>Acquisition date</Label>
              <DatePicker value={acqDate} onChange={setAcqDate} />
            </div>
            <div className="space-y-2">
              <Label>Cost</Label>
              <Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Salvage value</Label>
              <Input type="number" min="0" step="0.01" value={salvage} onChange={(e) => setSalvage(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Useful life (months)</Label>
              <Input type="number" min="1" value={lifeMonths} onChange={(e) => setLifeMonths(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Payment method</Label>
              <select className={SELECT_CLS} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="bank_transfer">Bank</option>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy === "register"}>Register &amp; post</Button>
            </div>
          </form>
        )}

        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Asset</DataTableHead>
              <DataTableHead>Acquired</DataTableHead>
              <DataTableHead align="right">Cost</DataTableHead>
              <DataTableHead align="right">NBV</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {assets.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="No fixed assets registered." />
              ) : (
                assets.map((a) => (
                  <DataTableRow key={a.id}>
                    <DataTableCell>
                      <span className="font-mono text-xs text-muted-foreground">{a.asset_no}</span>
                      <div>{a.name}</div>
                    </DataTableCell>
                    <DataTableCell>{a.acquisition_date}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(a.acquisition_cost))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(a.book_value))}</DataTableCell>
                    <DataTableCell>
                      <StatusBadge status={a.status === "active" ? "completed" : a.status === "disposed" ? "cancelled" : "draft"} />
                    </DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        {a.status === "active" && (
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => dispose(a.id)}>
                            Dispose
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

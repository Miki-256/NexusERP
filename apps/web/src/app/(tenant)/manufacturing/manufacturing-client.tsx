"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { TabBar } from "@/components/layout/tab-bar";
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
import { relationName } from "@/lib/utils";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import type { BomRow, MoRow, VariantOption } from "./page";

type CompLine = { variantId: string; quantity: string };

export function ManufacturingClient({
  organizationId,
  boms,
  orders,
  variants,
  stores,
}: {
  organizationId: string;
  boms: BomRow[];
  orders: MoRow[];
  variants: VariantOption[];
  stores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const variantLabel = (v: VariantOption) => {
    const p = relationName(v.products);
    return `${p}${v.name && v.name !== "Default" ? ` (${v.name})` : ""}`;
  };
  const [tab, setTab] = useState<"bom" | "orders">("bom");
  const [bomName, setBomName] = useState("");
  const [outputVariant, setOutputVariant] = useState(variants[0]?.id ?? "");
  const [compLines, setCompLines] = useState<CompLine[]>([{ variantId: "", quantity: "1" }]);
  const [moBom, setMoBom] = useState(boms[0]?.id ?? "");
  const [moStore, setMoStore] = useState(stores[0]?.id ?? "");
  const [moQty, setMoQty] = useState("1");
  const [busy, setBusy] = useState(false);

  async function createBom(e: React.FormEvent) {
    e.preventDefault();
    if (!bomName.trim() || !outputVariant) return;
    setBusy(true);
    const supabase = createClient();
    const { data: bom, error } = await supabase
      .from("boms")
      .insert({
        organization_id: organizationId,
        name: bomName.trim(),
        output_variant_id: outputVariant,
      })
      .select("id")
      .single();
    if (error || !bom) {
      setBusy(false);
      return toast({ title: "Failed", description: error?.message, variant: "destructive" });
    }
    const lines = compLines
      .filter((l) => l.variantId && Number(l.quantity) > 0)
      .map((l) => ({
        bom_id: bom.id,
        organization_id: organizationId,
        component_variant_id: l.variantId,
        quantity: Number(l.quantity),
      }));
    if (lines.length) await supabase.from("bom_lines").insert(lines);
    setBusy(false);
    toast({ title: "BOM created" });
    setBomName("");
    router.refresh();
  }

  async function createMo(e: React.FormEvent) {
    e.preventDefault();
    if (!moBom || !moStore) return;
    setBusy(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("manufacturing_orders").insert({
      organization_id: organizationId,
      bom_id: moBom,
      store_id: moStore,
      quantity: Number(moQty) || 1,
      created_by: user?.id ?? null,
    });
    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Manufacturing order created" });
    router.refresh();
  }

  async function completeMo(id: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("complete_manufacturing_order", { p_mo_id: id });
    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Production completed" });
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader title="Manufacturing" description="Bills of materials and production orders" />
      <TabBar
        tabs={[
          { key: "bom" as const, label: "BOMs" },
          { key: "orders" as const, label: "Orders" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "bom" && (
        <FormCard title="New BOM" onSubmit={createBom}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={bomName} onChange={(e) => setBomName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Output product</Label>
              <select className={SELECT_CLS} value={outputVariant} onChange={(e) => setOutputVariant(e.target.value)}>
                {variants.map((v) => <option key={v.id} value={v.id}>{variantLabel(v)}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Components</Label>
            {compLines.map((line, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <select
                  className={SELECT_CLS}
                  value={line.variantId}
                  onChange={(e) => setCompLines((p) => p.map((l, idx) => idx === i ? { ...l, variantId: e.target.value } : l))}
                >
                  <option value="">Component</option>
                  {variants.map((v) => <option key={v.id} value={v.id}>{variantLabel(v)}</option>)}
                </select>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="Qty"
                  value={line.quantity}
                  onChange={(e) => setCompLines((p) => p.map((l, idx) => idx === i ? { ...l, quantity: e.target.value } : l))}
                />
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setCompLines((p) => [...p, { variantId: "", quantity: "1" }])}>Add component</Button>
          </div>
          <Button type="submit" disabled={busy}>Save BOM</Button>
        </FormCard>
      )}

      {tab === "orders" && (
        <FormCard title="New manufacturing order" onSubmit={createMo}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>BOM</Label>
              <select className={SELECT_CLS} value={moBom} onChange={(e) => setMoBom(e.target.value)}>
                {boms.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Store</Label>
              <select className={SELECT_CLS} value={moStore} onChange={(e) => setMoStore(e.target.value)}>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" min="0.001" step="0.001" value={moQty} onChange={(e) => setMoQty(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={busy}>Create MO</Button>
        </FormCard>
      )}

      {tab === "bom" ? (
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>BOM</DataTableHead>
              <DataTableHead>Output</DataTableHead>
              <DataTableHead>Status</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {boms.length === 0 ? <DataTableEmpty colSpan={3} message="No BOMs." /> : boms.map((b) => (
                <DataTableRow key={b.id}>
                  <DataTableCell className="font-medium">{b.name}</DataTableCell>
                  <DataTableCell>
                    {b.product_variants
                      ? `${relationName(b.product_variants.products)} (${b.product_variants.name})`
                      : "—"}
                  </DataTableCell>
                  <DataTableCell><StatusBadge status={b.is_active ? "active" : "suspended"} /></DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </table>
        </DataTable>
      ) : (
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>BOM</DataTableHead>
              <DataTableHead>Store</DataTableHead>
              <DataTableHead>Qty</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Action</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {orders.length === 0 ? <DataTableEmpty colSpan={5} message="No orders." /> : orders.map((o) => (
                <DataTableRow key={o.id}>
                  <DataTableCell>{relationName(o.boms)}</DataTableCell>
                  <DataTableCell>{relationName(o.stores)}</DataTableCell>
                  <DataTableCell>{o.quantity}</DataTableCell>
                  <DataTableCell><StatusBadge status={o.status} /></DataTableCell>
                  <DataTableCell align="right">
                    {o.status !== "done" && (
                      <Button size="sm" disabled={busy} onClick={() => completeMo(o.id)}>Complete</Button>
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </table>
        </DataTable>
      )}
    </div>
  );
}

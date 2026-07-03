"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { FormCard } from "@/components/layout/form-card";
import { TabBar } from "@/components/layout/tab-bar";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { AlertTriangle, ArrowRightLeft, Boxes } from "lucide-react";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import type { InventoryRow } from "./page";

type Tab = "stock" | "transfers" | "alerts";

type LowStockItem = {
  store_id: string;
  store_name: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  quantity: number;
  reorder_point: number;
};

type VariantOption = {
  variant_id: string;
  label: string;
};

export function InventoryClient({
  organizationId,
  stores,
  initialInventory,
  canManage,
}: {
  organizationId: string;
  stores: { id: string; name: string }[];
  initialInventory: InventoryRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("stock");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [inventory, setInventory] = useState(initialInventory);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [lowStockLoaded, setLowStockLoaded] = useState(false);
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);
  const [adjustVariant, setAdjustVariant] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [fromStoreId, setFromStoreId] = useState(stores[0]?.id ?? "");
  const [toStoreId, setToStoreId] = useState(stores[1]?.id ?? stores[0]?.id ?? "");
  const [transferVariant, setTransferVariant] = useState("");
  const [transferQty, setTransferQty] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadInventory(sid: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("inventory_levels")
      .select("id, quantity, variant_id, product_variants(id, name, barcode, products(name, sell_price, reorder_point))")
      .eq("store_id", sid);
    setInventory((data as unknown as InventoryRow[]) ?? []);
  }

  async function loadVariants() {
    if (variantsLoaded) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("product_variants")
      .select("id, name, products(name)")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name")
      .limit(500);
    setVariantOptions(
      (data ?? []).map((v) => {
        const product = Array.isArray(v.products) ? v.products[0] : v.products;
        const productName = (product as { name?: string } | null)?.name ?? "Product";
        return {
          variant_id: v.id,
          label: v.name === "Default" ? productName : `${productName} (${v.name})`,
        };
      })
    );
    setVariantsLoaded(true);
  }

  async function loadLowStock(sid?: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_low_stock_items", {
      p_organization_id: organizationId,
      p_store_id: sid || null,
    });
    if (error) {
      toast({ title: "Could not load alerts", description: error.message, variant: "destructive" });
      return;
    }
    setLowStock((data ?? []) as LowStockItem[]);
    setLowStockLoaded(true);
  }

  async function handleTabChange(next: Tab) {
    setTab(next);
    if (next === "alerts" && !lowStockLoaded) void loadLowStock();
    if (next === "transfers" && !variantsLoaded) void loadVariants();
  }

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !adjustVariant) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("adjust_inventory", {
      p_store_id: storeId,
      p_variant_id: adjustVariant,
      p_delta: parseFloat(delta),
      p_reason: reason,
    });
    setLoading(false);
    if (error) return toast({ title: "Adjustment failed", description: error.message, variant: "destructive" });
    toast({ title: "Stock adjusted", description: `Delta ${delta} applied.` });
    setDelta("");
    setReason("");
    setAdjustVariant("");
    await loadInventory(storeId);
    await loadLowStock();
    router.refresh();
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !transferVariant) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("transfer_stock", {
      p_from_store_id: fromStoreId,
      p_to_store_id: toStoreId,
      p_variant_id: transferVariant,
      p_quantity: parseFloat(transferQty),
      p_note: transferNote.trim() || null,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Stock transferred", description: "Inventory moved between stores." });
    setTransferQty("");
    setTransferNote("");
    if (storeId === fromStoreId || storeId === toStoreId) await loadInventory(storeId);
    await loadLowStock();
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Inventory"
        description="Stock levels, transfers, and low-stock alerts"
        action={
          tab === "stock" ? (
            <select
              className={SELECT_CLS + " w-auto min-w-[180px]"}
              value={storeId}
              onChange={async (e) => {
                setStoreId(e.target.value);
                await loadInventory(e.target.value);
              }}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : undefined
        }
      />

      <TabBar
        tabs={[
          { key: "stock", label: "Stock levels" },
          { key: "transfers", label: "Transfers" },
          { key: "alerts", label: lowStockLoaded ? `Low stock${lowStock.length ? ` (${lowStock.length})` : ""}` : "Low stock" },
        ]}
        value={tab}
        onChange={(k) => void handleTabChange(k as Tab)}
        className="mb-6"
      />

      {tab === "stock" && canManage && (
        <FormCard title="Adjust stock">
          <form onSubmit={handleAdjust} className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Product</Label>
              <select className={SELECT_CLS} value={adjustVariant} onChange={(e) => setAdjustVariant(e.target.value)} required>
                <option value="">Select…</option>
                {inventory.map((row) => (
                  <option key={row.variant_id} value={row.variant_id}>{row.product_variants.products.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2"><Label>Delta (+/-)</Label><Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} required /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} required /></div>
            <Button type="submit" disabled={loading}>{loading ? "Applying…" : "Apply"}</Button>
          </form>
        </FormCard>
      )}

      {tab === "transfers" && canManage && stores.length >= 2 && (
        <FormCard title="Transfer between stores">
          <form onSubmit={handleTransfer} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>From store</Label>
              <select className={SELECT_CLS} value={fromStoreId} onChange={(e) => setFromStoreId(e.target.value)} required>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>To store</Label>
              <select className={SELECT_CLS} value={toStoreId} onChange={(e) => setToStoreId(e.target.value)} required>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Variant</Label>
              <select className={SELECT_CLS} value={transferVariant} onChange={(e) => setTransferVariant(e.target.value)} required>
                <option value="">Select…</option>
                {variantOptions.map((v) => (
                  <option key={v.variant_id} value={v.variant_id}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2"><Label>Quantity</Label><Input type="number" min="0.001" step="any" value={transferQty} onChange={(e) => setTransferQty(e.target.value)} required /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Note</Label><Input value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder="Optional" /></div>
            <Button type="submit" disabled={loading} className="sm:col-span-2 lg:col-span-3 w-fit">
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              {loading ? "Transferring…" : "Transfer stock"}
            </Button>
          </form>
        </FormCard>
      )}

      {tab === "transfers" && stores.length < 2 && (
        <FormCard title="Transfer between stores">
          <p className="text-sm text-muted-foreground">Add at least two stores to transfer stock.</p>
        </FormCard>
      )}

      {tab === "stock" && (
        <>
          <div className="space-y-3 lg:hidden">
            {inventory.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No inventory at this store.</p>
            ) : (
              inventory.map((row) => {
                const reorder = row.product_variants.products.reorder_point ?? 0;
                const low = reorder > 0 && row.quantity <= reorder;
                const label =
                  row.product_variants.products.name +
                  (row.product_variants.name !== "Default" ? ` (${row.product_variants.name})` : "");
                return (
                  <MobileRecordCard key={row.id}>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Boxes className="h-4 w-4" />
                      </div>
                      <p className="min-w-0 flex-1 font-semibold leading-snug">{label}</p>
                    </div>
                    <div className="space-y-1.5">
                      <MobileRecordCardRow label="Quantity">
                        <span className={low ? "text-amber-700" : undefined}>{row.quantity}</span>
                      </MobileRecordCardRow>
                      <MobileRecordCardRow label="Reorder at">{reorder > 0 ? reorder : "—"}</MobileRecordCardRow>
                    </div>
                  </MobileRecordCard>
                );
              })
            )}
          </div>

          <div className="hidden lg:block">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Product</DataTableHead>
              <DataTableHead align="right">Quantity</DataTableHead>
              <DataTableHead align="right">Reorder at</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {inventory.length === 0 ? (
                <DataTableEmpty colSpan={3} message="No inventory at this store." />
              ) : (
                inventory.map((row) => {
                  const reorder = row.product_variants.products.reorder_point ?? 0;
                  const low = reorder > 0 && row.quantity <= reorder;
                  return (
                    <DataTableRow key={row.id}>
                      <DataTableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Boxes className="h-4 w-4" />
                          </div>
                          <span className="font-medium">
                            {row.product_variants.products.name}
                            {row.product_variants.name !== "Default" && ` (${row.product_variants.name})`}
                          </span>
                        </div>
                      </DataTableCell>
                      <DataTableCell align="right" className={`font-mono text-base font-semibold ${low ? "text-amber-700" : ""}`}>
                        {row.quantity}
                      </DataTableCell>
                      <DataTableCell align="right" className="text-muted-foreground">
                        {reorder > 0 ? reorder : "—"}
                      </DataTableCell>
                    </DataTableRow>
                  );
                })
              )}
            </DataTableBody>
          </table>
        </DataTable>
          </div>
        </>
      )}

      {tab === "alerts" && (
        <>
          <div className="space-y-3 lg:hidden">
            {lowStock.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No low-stock items. Set reorder points on products to enable alerts.
              </p>
            ) : (
              lowStock.map((item) => (
                <MobileRecordCard key={`${item.store_id}-${item.variant_id}`}>
                  <div className="mb-2 flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                    {item.product_name}
                    {item.variant_name !== "Default" && ` (${item.variant_name})`}
                  </div>
                  <div className="space-y-1.5">
                    <MobileRecordCardRow label="Store">{item.store_name}</MobileRecordCardRow>
                    <MobileRecordCardRow label="On hand">
                      <span className="text-amber-700">{item.quantity}</span>
                    </MobileRecordCardRow>
                    <MobileRecordCardRow label="Reorder at">{item.reorder_point}</MobileRecordCardRow>
                  </div>
                </MobileRecordCard>
              ))
            )}
          </div>

          <div className="hidden lg:block">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Store</DataTableHead>
              <DataTableHead>Product</DataTableHead>
              <DataTableHead align="right">On hand</DataTableHead>
              <DataTableHead align="right">Reorder point</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {lowStock.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No low-stock items. Set reorder points on products to enable alerts." />
              ) : (
                lowStock.map((item) => (
                  <DataTableRow key={`${item.store_id}-${item.variant_id}`}>
                    <DataTableCell>{item.store_name}</DataTableCell>
                    <DataTableCell>
                      <span className="inline-flex items-center gap-2 font-medium">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        {item.product_name}
                        {item.variant_name !== "Default" && ` (${item.variant_name})`}
                      </span>
                    </DataTableCell>
                    <DataTableCell align="right" className="font-mono font-semibold text-amber-700">
                      {item.quantity}
                    </DataTableCell>
                    <DataTableCell align="right" className="text-muted-foreground">{item.reorder_point}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
          </div>
        </>
      )}
    </div>
  );
}

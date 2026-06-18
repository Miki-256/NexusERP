"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InventoryRow } from "./page";

export function InventoryClient({
  stores,
  initialInventory,
  canManage,
}: {
  stores: { id: string; name: string }[];
  initialInventory: InventoryRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [inventory, setInventory] = useState(initialInventory);
  const [adjustVariant, setAdjustVariant] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadInventory(sid: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("inventory_levels")
      .select(
        "id, quantity, variant_id, product_variants(id, name, barcode, products(name, sell_price))"
      )
      .eq("store_id", sid);
    setInventory((data as unknown as InventoryRow[]) ?? []);
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
    if (!error) {
      setDelta("");
      setReason("");
      setAdjustVariant("");
      await loadInventory(storeId);
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Inventory</h1>

      <div className="flex gap-4">
        <select
          className="h-10 rounded-md border px-3 text-sm"
          value={storeId}
          onChange={async (e) => {
            setStoreId(e.target.value);
            await loadInventory(e.target.value);
          }}
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Adjust stock</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdjust} className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2">
                <Label>Product</Label>
                <select
                  className="flex h-10 w-full rounded-md border px-3 text-sm"
                  value={adjustVariant}
                  onChange={(e) => setAdjustVariant(e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {inventory.map((row) => (
                    <option key={row.variant_id} value={row.variant_id}>
                      {row.product_variants.products.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Delta (+/-)</Label>
                <Input
                  type="number"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Reason</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={loading}>
                Apply
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left">Product</th>
                <th className="p-3 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="p-3">
                    {row.product_variants.products.name}
                    {row.product_variants.name !== "Default" &&
                      ` (${row.product_variants.name})`}
                  </td>
                  <td className="p-3 text-right font-mono">{row.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

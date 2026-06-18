"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  sell_price: number;
  cost_price: number;
  is_active: boolean;
  categories: { name: string } | null;
  product_variants: { id: string; name: string }[];
};

export function ProductsClient({
  products,
  categories,
  stores,
  organizationId,
  currency,
  canManage,
}: {
  products: Product[];
  categories: { id: string; name: string }[];
  stores: { id: string; name: string }[];
  organizationId: string;
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [barcode, setBarcode] = useState("");
  const [sku, setSku] = useState("");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [initialQty, setInitialQty] = useState("0");
  const [categoryId, setCategoryId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: fnError } = await supabase.rpc("create_product_with_variant", {
      p_organization_id: organizationId,
      p_name: name,
      p_category_id: categoryId || null,
      p_sku: sku || null,
      p_barcode: barcode || null,
      p_sell_price: parseFloat(sellPrice),
      p_cost_price: 0,
      p_tax_rate: null,
      p_store_id: storeId || null,
      p_initial_qty: parseFloat(initialQty) || 0,
    });
    setLoading(false);
    if (fnError) {
      setError(fnError.message);
      return;
    }
    setShowForm(false);
    setName("");
    setSellPrice("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Products</h1>
        {canManage && (
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "Add product"}
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <Card>
          <CardHeader>
            <CardTitle>New product</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Sell price</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Initial stock (store)</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  value={initialQty}
                  onChange={(e) => setInitialQty(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Barcode</Label>
                <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input value={sku} onChange={(e) => setSku(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">None</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {error && (
                <p className="text-sm text-destructive sm:col-span-2">{error}</p>
              )}
              <Button type="submit" disabled={loading} className="sm:col-span-2">
                {loading ? "Saving…" : "Save product"}
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
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">SKU</th>
                <th className="p-3 text-right">Price</th>
                <th className="p-3 text-left">Category</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 text-muted-foreground">{p.sku ?? "—"}</td>
                  <td className="p-3 text-right">
                    {formatCurrency(p.sell_price, currency)}
                  </td>
                  <td className="p-3">{p.categories?.name ?? "—"}</td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    No products yet. Add your first product to start selling.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

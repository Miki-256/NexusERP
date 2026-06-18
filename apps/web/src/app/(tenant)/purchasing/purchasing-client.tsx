"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, relationName } from "@/lib/utils";
import type { VendorRow, PORow, BillRow, VariantOption } from "./page";

type Tab = "orders" | "vendors" | "bills";
type DraftLine = { variantId: string; productName: string; quantity: string; unitCost: string };

export function PurchasingClient({
  organizationId,
  currency,
  canManage,
  vendors,
  stores,
  purchaseOrders,
  bills,
  variants,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  vendors: VendorRow[];
  stores: { id: string; name: string }[];
  purchaseOrders: PORow[];
  bills: BillRow[];
  variants: VariantOption[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("orders");
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");

  const money = (n: number) => formatCurrency(Number(n), currency);
  const variantLabel = (v: VariantOption) =>
    `${relationName(v.products)}${v.name && v.name !== "Default" ? ` (${v.name})` : ""}`;

  // --- Vendor form ---
  const [vName, setVName] = useState("");
  const [vPhone, setVPhone] = useState("");
  const [vEmail, setVEmail] = useState("");

  async function addVendor(e: React.FormEvent) {
    e.preventDefault();
    if (!vName.trim()) return;
    setBusy("vendor");
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.from("vendors").insert({
      organization_id: organizationId,
      name: vName.trim(),
      phone: vPhone || null,
      email: vEmail || null,
    });
    setBusy("");
    if (err) return setError(err.message);
    setVName("");
    setVPhone("");
    setVEmail("");
    router.refresh();
  }

  // --- PO form ---
  const [poVendor, setPoVendor] = useState("");
  const [poStore, setPoStore] = useState(stores[0]?.id ?? "");
  const [poExpected, setPoExpected] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { variantId: "", productName: "", quantity: "", unitCost: "" },
  ]);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function onPickVariant(i: number, variantId: string) {
    const v = variants.find((x) => x.id === variantId);
    updateLine(i, {
      variantId,
      productName: v ? variantLabel(v) : "",
      unitCost: v?.cost_price != null ? String(v.cost_price) : "",
    });
  }
  const poTotal = lines.reduce(
    (s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitCost) || 0),
    0
  );

  async function createPO(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const validLines = lines
      .filter((l) => l.variantId && parseFloat(l.quantity) > 0)
      .map((l) => ({
        variantId: l.variantId,
        productName: l.productName,
        quantity: parseFloat(l.quantity),
        unitCost: parseFloat(l.unitCost) || 0,
      }));
    if (!poVendor || !poStore || validLines.length === 0) {
      return setError("Pick a vendor, store, and at least one line");
    }
    setBusy("po");
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.rpc("create_purchase_order", {
      p_org_id: organizationId,
      p_vendor_id: poVendor,
      p_store_id: poStore,
      p_expected_date: poExpected || null,
      p_notes: null,
      p_lines: validLines,
    });
    setBusy("");
    if (err) return setError(err.message);
    setPoVendor("");
    setPoExpected("");
    setLines([{ variantId: "", productName: "", quantity: "", unitCost: "" }]);
    router.refresh();
  }

  async function receivePO(id: string) {
    setBusy(id);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.rpc("receive_purchase_order", { p_po_id: id });
    setBusy("");
    if (err) return setError(err.message);
    router.refresh();
  }

  async function payBill(id: string, method: "cash" | "mobile_money" | "bank_transfer") {
    setBusy(id);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.rpc("pay_vendor_bill", {
      p_bill_id: id,
      p_payment_method: method,
    });
    setBusy("");
    if (err) return setError(err.message);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Purchasing</h1>

      <div className="flex gap-2">
        {(["orders", "vendors", "bills"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "rounded-md px-3 py-1.5 text-sm capitalize " +
              (tab === t ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent")
            }
          >
            {t === "orders" ? "Purchase Orders" : t === "bills" ? "Vendor Bills" : "Vendors"}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {tab === "orders" && (
        <>
          {canManage && (
            <Card>
              <CardHeader>
                <CardTitle>New Purchase Order</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={createPO} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Vendor</Label>
                      <select
                        className="flex h-10 w-full rounded-md border px-3 text-sm"
                        value={poVendor}
                        onChange={(e) => setPoVendor(e.target.value)}
                        required
                      >
                        <option value="">Select…</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Receiving store</Label>
                      <select
                        className="flex h-10 w-full rounded-md border px-3 text-sm"
                        value={poStore}
                        onChange={(e) => setPoStore(e.target.value)}
                        required
                      >
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Expected date</Label>
                      <Input
                        type="date"
                        value={poExpected}
                        onChange={(e) => setPoExpected(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Lines</Label>
                    {lines.map((l, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                        <select
                          className="h-10 rounded-md border px-3 text-sm"
                          value={l.variantId}
                          onChange={(e) => onPickVariant(i, e.target.value)}
                        >
                          <option value="">Select product…</option>
                          {variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {variantLabel(v)}
                            </option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          placeholder="Qty"
                          value={l.quantity}
                          onChange={(e) => updateLine(i, { quantity: e.target.value })}
                        />
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Unit cost"
                          value={l.unitCost}
                          onChange={(e) => updateLine(i, { unitCost: e.target.value })}
                        />
                        <button
                          type="button"
                          className="text-sm text-muted-foreground hover:text-red-600"
                          onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setLines((prev) => [
                          ...prev,
                          { variantId: "", productName: "", quantity: "", unitCost: "" },
                        ])
                      }
                    >
                      + Add line
                    </Button>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Total: {money(poTotal)}</p>
                    <Button type="submit" disabled={busy === "po"}>
                      {busy === "po" ? "Creating…" : "Create PO"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Vendor</th>
                    <th className="p-3 text-left">Store</th>
                    <th className="p-3 text-left">Status</th>
                    <th className="p-3 text-right">Total</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-muted-foreground">
                        No purchase orders yet.
                      </td>
                    </tr>
                  ) : (
                    purchaseOrders.map((po) => (
                      <tr key={po.id} className="border-b">
                        <td className="p-3">{po.order_date}</td>
                        <td className="p-3">{relationName(po.vendors)}</td>
                        <td className="p-3">{relationName(po.stores)}</td>
                        <td className="p-3 capitalize">{po.status}</td>
                        <td className="p-3 text-right font-mono">{money(po.total)}</td>
                        <td className="p-3 text-right">
                          {canManage && po.status === "ordered" ? (
                            <Button size="sm" disabled={busy === po.id} onClick={() => receivePO(po.id)}>
                              {busy === po.id ? "…" : "Receive"}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {tab === "vendors" && (
        <>
          {canManage && (
            <Card>
              <CardHeader>
                <CardTitle>Add Vendor</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={addVendor} className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Name</Label>
                    <Input value={vName} onChange={(e) => setVName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input value={vPhone} onChange={(e) => setVPhone(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input type="email" value={vEmail} onChange={(e) => setVEmail(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={busy === "vendor"}>
                    Add
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
                    <th className="p-3 text-left">Phone</th>
                    <th className="p-3 text-left">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-muted-foreground">
                        No vendors yet.
                      </td>
                    </tr>
                  ) : (
                    vendors.map((v) => (
                      <tr key={v.id} className="border-b">
                        <td className="p-3">{v.name}</td>
                        <td className="p-3">{v.phone || "—"}</td>
                        <td className="p-3">{v.email || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {tab === "bills" && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Vendor</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {bills.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-muted-foreground">
                      No vendor bills yet.
                    </td>
                  </tr>
                ) : (
                  bills.map((b) => (
                    <tr key={b.id} className="border-b">
                      <td className="p-3">{b.bill_date}</td>
                      <td className="p-3">{relationName(b.vendors)}</td>
                      <td className="p-3 capitalize">{b.status}</td>
                      <td className="p-3 text-right font-mono">{money(b.amount)}</td>
                      <td className="p-3 text-right">
                        {canManage && b.status === "open" ? (
                          <Button size="sm" disabled={busy === b.id} onClick={() => payBill(b.id, "cash")}>
                            {busy === b.id ? "…" : "Pay (cash)"}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

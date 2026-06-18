"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, relationName } from "@/lib/utils";
import type { ExpenseRow } from "./page";

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "bank_transfer", label: "Bank Transfer" },
] as const;

export function ExpensesClient({
  organizationId,
  currency,
  canManage,
  initialExpenses,
  categories,
  stores,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  initialExpenses: ExpenseRow[];
  categories: { id: string; name: string }[];
  stores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]["value"]>("cash");
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const total = initialExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("record_expense", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
      p_category_id: categoryId || null,
      p_vendor_name: vendor || null,
      p_description: description || null,
      p_amount: value,
      p_payment_method: method,
      p_expense_date: date,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setAmount("");
    setVendor("");
    setDescription("");
    setCategoryId("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Expenses</h1>
        <p className="text-sm text-muted-foreground">
          {initialExpenses.length} records · {formatCurrency(total, currency)} total
        </p>
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Record Expense</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Amount ({currency})</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <select
                  className="flex h-10 w-full rounded-md border px-3 text-sm"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Payment</Label>
                <select
                  className="flex h-10 w-full rounded-md border px-3 text-sm"
                  value={method}
                  onChange={(e) =>
                    setMethod(e.target.value as (typeof PAYMENT_METHODS)[number]["value"])
                  }
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Vendor</Label>
                <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              {stores.length > 0 && (
                <div className="space-y-2">
                  <Label>Store (optional)</Label>
                  <select
                    className="flex h-10 w-full rounded-md border px-3 text-sm"
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                  >
                    <option value="">All / none</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label>Description</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving…" : "Add Expense"}
                </Button>
              </div>
              {error && (
                <p className="text-sm text-red-600 sm:col-span-3">{error}</p>
              )}
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
                <th className="p-3 text-left">Category</th>
                <th className="p-3 text-left">Vendor</th>
                <th className="p-3 text-left">Description</th>
                <th className="p-3 text-left">Payment</th>
                <th className="p-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {initialExpenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted-foreground">
                    No expenses recorded yet.
                  </td>
                </tr>
              ) : (
                initialExpenses.map((e) => (
                  <tr key={e.id} className="border-b">
                    <td className="p-3">{e.expense_date}</td>
                    <td className="p-3">{relationName(e.expense_categories) || "—"}</td>
                    <td className="p-3">{e.vendor_name || "—"}</td>
                    <td className="p-3">{e.description || "—"}</td>
                    <td className="p-3 capitalize">{e.payment_method.replace("_", " ")}</td>
                    <td className="p-3 text-right font-mono">
                      {formatCurrency(Number(e.amount), currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

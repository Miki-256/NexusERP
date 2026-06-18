"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { ContactSummary } from "./page";

export function CustomersClient({
  organizationId,
  currency,
  contacts,
}: {
  organizationId: string;
  currency: string;
  contacts: ContactSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase();
    return (
      !q ||
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q) ||
      (c.email ?? "").toLowerCase().includes(q)
    );
  });

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() && !phone.trim()) {
      return setError("Enter a name or phone");
    }
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.from("customers").insert({
      organization_id: organizationId,
      name: name.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setNotes("");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Customers</h1>
        <Button onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Add Customer"}</Button>
      </div>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>New Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addContact} className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Address</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
              <div>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Input
        placeholder="Search by name, phone, or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Phone</th>
                <th className="p-3 text-left">Email</th>
                <th className="p-3 text-right">Orders</th>
                <th className="p-3 text-right">Lifetime Spend</th>
                <th className="p-3 text-left">Last Order</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted-foreground">
                    No customers found.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.customer_id} className="border-b">
                    <td className="p-3">{c.name || "—"}</td>
                    <td className="p-3">{c.phone || "—"}</td>
                    <td className="p-3">{c.email || "—"}</td>
                    <td className="p-3 text-right">{c.order_count}</td>
                    <td className="p-3 text-right font-mono">
                      {formatCurrency(Number(c.total_spent), currency)}
                    </td>
                    <td className="p-3">
                      {c.last_order ? new Date(c.last_order).toLocaleDateString() : "—"}
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

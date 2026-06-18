"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type StoreRow = {
  id: string;
  name: string;
  address: string | null;
  registers: { id: string; name: string }[];
};

export function StoresClient({
  stores,
  organizationId,
  canManage,
}: {
  stores: StoreRow[];
  organizationId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [regName, setRegName] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [loading, setLoading] = useState(false);

  async function addStore(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const { data: store, error } = await supabase
      .from("stores")
      .insert({ organization_id: organizationId, name: storeName })
      .select()
      .single();
    if (store && !error) {
      await supabase.from("receipt_sequences").insert({
        store_id: store.id,
        organization_id: organizationId,
        last_number: 0,
      });
      await supabase.from("registers").insert({
        store_id: store.id,
        organization_id: organizationId,
        name: "Register 1",
      });
    }
    setLoading(false);
    setStoreName("");
    router.refresh();
  }

  async function addRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !selectedStore) return;
    setLoading(true);
    const supabase = createClient();
    await supabase.from("registers").insert({
      store_id: selectedStore,
      organization_id: organizationId,
      name: regName,
    });
    setLoading(false);
    setRegName("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Stores & Registers</h1>

      {canManage && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Add store</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={addStore} className="flex gap-2">
                <Input
                  placeholder="Store name"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  required
                />
                <Button type="submit" disabled={loading}>
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Add register</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={addRegister} className="space-y-2">
                <select
                  className="flex h-10 w-full rounded-md border px-3 text-sm"
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  required
                >
                  <option value="">Select store</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <Input
                    placeholder="Register name"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    required
                  />
                  <Button type="submit" disabled={loading}>
                    Add
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4">
        {stores.map((store) => (
          <Card key={store.id}>
            <CardHeader>
              <CardTitle>{store.name}</CardTitle>
              {store.address && (
                <p className="text-sm text-muted-foreground">{store.address}</p>
              )}
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {store.registers.map((r) => (
                  <li key={r.id} className="text-sm">
                    {r.name}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

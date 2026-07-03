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
import { Badge } from "@/components/ui/badge";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Pencil, Store, Trash2, X, Link2 } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { deleteBlockedMessage } from "@/lib/delete-errors";
import { parsePlanLimitError, planLimitToastDescription } from "@/lib/plan-errors";

type StoreRow = {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  registers: { id: string; name: string; is_active: boolean }[];
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
  const { toast } = useToast();
  const [storeName, setStoreName] = useState("");
  const [regName, setRegName] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editStoreName, setEditStoreName] = useState("");
  const [editStoreAddress, setEditStoreAddress] = useState("");
  const [editingRegisterId, setEditingRegisterId] = useState<string | null>(null);
  const [editRegisterName, setEditRegisterName] = useState("");
  const [confirmDeleteRegisterId, setConfirmDeleteRegisterId] = useState<string | null>(null);

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
      await supabase.from("receipt_sequences").insert({ store_id: store.id, organization_id: organizationId, last_number: 0 });
      await supabase.from("registers").insert({ store_id: store.id, organization_id: organizationId, name: "Register 1" });
    }
    setLoading(false);
    if (error) {
      const parsed = parsePlanLimitError(error);
      return toast({
        title: parsed.isPlanLimit ? parsed.title : "Could not add store",
        description: planLimitToastDescription(parsed),
        variant: "destructive",
      });
    }
    toast({ title: "Store created", description: storeName });
    setStoreName("");
    router.refresh();
  }

  async function addRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !selectedStore) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("registers").insert({ store_id: selectedStore, organization_id: organizationId, name: regName });
    setLoading(false);
    if (error) return toast({ title: "Could not add register", description: error.message, variant: "destructive" });
    toast({ title: "Register added", description: regName });
    setRegName("");
    router.refresh();
  }

  function startEditStore(store: StoreRow) {
    setEditingStoreId(store.id);
    setEditStoreName(store.name);
    setEditStoreAddress(store.address ?? "");
    setEditingRegisterId(null);
  }

  async function saveStore(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !editingStoreId) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("stores")
      .update({ name: editStoreName.trim(), address: editStoreAddress.trim() || null })
      .eq("id", editingStoreId)
      .eq("organization_id", organizationId);
    setLoading(false);
    if (error) return toast({ title: "Could not update store", description: error.message, variant: "destructive" });
    toast({ title: "Store updated" });
    setEditingStoreId(null);
    router.refresh();
  }

  function startEditRegister(register: { id: string; name: string }) {
    setEditingRegisterId(register.id);
    setEditRegisterName(register.name);
    setEditingStoreId(null);
  }

  async function saveRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !editingRegisterId) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("registers")
      .update({ name: editRegisterName.trim() })
      .eq("id", editingRegisterId)
      .eq("organization_id", organizationId);
    setLoading(false);
    if (error) return toast({ title: "Could not update register", description: error.message, variant: "destructive" });
    toast({ title: "Register updated" });
    setEditingRegisterId(null);
    router.refresh();
  }

  async function setStoreActive(storeId: string, active: boolean) {
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("stores")
      .update({ is_active: active })
      .eq("id", storeId)
      .eq("organization_id", organizationId);
    setLoading(false);
    if (error) return toast({ title: "Could not update store", description: error.message, variant: "destructive" });
    toast({ title: active ? "Store activated" : "Store deactivated" });
    router.refresh();
  }

  async function deleteStore(storeId: string, storeName: string) {
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("stores").delete().eq("id", storeId).eq("organization_id", organizationId);
    setLoading(false);
    if (error) {
      return toast({ title: "Could not delete store", description: deleteBlockedMessage(error), variant: "destructive" });
    }
    toast({ title: "Store deleted", description: storeName });
    if (editingStoreId === storeId) setEditingStoreId(null);
    router.refresh();
  }

  async function setRegisterActive(registerId: string, active: boolean) {
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("registers")
      .update({ is_active: active })
      .eq("id", registerId)
      .eq("organization_id", organizationId);
    setLoading(false);
    if (error) return toast({ title: "Could not update register", description: error.message, variant: "destructive" });
    toast({ title: active ? "Register activated" : "Register deactivated" });
    router.refresh();
  }

  async function deleteRegister(registerId: string, registerName: string) {
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("registers").delete().eq("id", registerId).eq("organization_id", organizationId);
    setLoading(false);
    if (error) {
      return toast({ title: "Could not delete register", description: deleteBlockedMessage(error), variant: "destructive" });
    }
    toast({ title: "Register deleted", description: registerName });
    if (editingRegisterId === registerId) setEditingRegisterId(null);
    router.refresh();
  }

  async function copyRegisterLink(registerId: string, registerName: string) {
    const url = `${window.location.origin}/pos/${registerId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Register link copied", description: `${registerName} — paste on the POS device.` });
    } catch {
      toast({
        title: "Could not copy",
        description: url,
        variant: "destructive",
      });
    }
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader title="Stores & Registers" description={`${stores.length} store${stores.length === 1 ? "" : "s"} configured`} />

      {canManage && (
        <div className="grid gap-4 md:grid-cols-2">
          <FormCard title="Add store">
            <form onSubmit={addStore} className="flex gap-2">
              <Input placeholder="Store name" value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
              <Button type="submit" disabled={loading} className="cursor-pointer">Add</Button>
            </form>
          </FormCard>
          <FormCard title="Add register">
            <form onSubmit={addRegister} className="space-y-2">
              <select className={SELECT_CLS} value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} required>
                <option value="">Select store</option>
                {stores.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
              <div className="flex gap-2">
                <Input placeholder="Register name" value={regName} onChange={(e) => setRegName(e.target.value)} required />
                <Button type="submit" disabled={loading} className="cursor-pointer">Add</Button>
              </div>
            </form>
          </FormCard>
        </div>
      )}

      {editingStoreId && canManage && (
        <FormCard title="Edit store">
          <form onSubmit={saveStore} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editStoreName} onChange={(e) => setEditStoreName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input value={editStoreAddress} onChange={(e) => setEditStoreAddress(e.target.value)} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={loading} className="cursor-pointer">Update store</Button>
              <Button type="button" variant="outline" onClick={() => setEditingStoreId(null)} className="cursor-pointer">
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          </form>
        </FormCard>
      )}

      {editingRegisterId && canManage && (
        <FormCard title="Edit register">
          <form onSubmit={saveRegister} className="flex gap-2">
            <Input value={editRegisterName} onChange={(e) => setEditRegisterName(e.target.value)} required />
            <Button type="submit" disabled={loading} className="cursor-pointer">Update</Button>
            <Button type="button" variant="outline" onClick={() => setEditingRegisterId(null)} className="cursor-pointer">Cancel</Button>
          </form>
        </FormCard>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {stores.map((store) => (
          <div key={store.id} className="rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Store className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{store.name}</h3>
                      {!store.is_active && <Badge variant="destructive">Inactive</Badge>}
                    </div>
                    {store.address && <p className="text-sm text-muted-foreground">{store.address}</p>}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => startEditStore(store)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="cursor-pointer"
                        onClick={() => setStoreActive(store.id, !store.is_active)}
                      >
                        {store.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      <ConfirmDeleteButton
                        message="Delete store permanently? Deactivate if it has sales history."
                        onConfirm={() => deleteStore(store.id, store.name)}
                      />
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {store.registers.map((r) => (
                    <div key={r.id} className="flex items-center gap-1 rounded-md border px-2 py-1">
                      <Badge variant={r.is_active ? "secondary" : "outline"}>{r.name}</Badge>
                      {!r.is_active && <span className="text-xs text-muted-foreground">off</span>}
                      <button
                        type="button"
                        onClick={() => void copyRegisterLink(r.id, r.name)}
                        className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
                        aria-label={`Copy POS link for ${r.name}`}
                        title="Copy POS register link"
                      >
                        <Link2 className="h-3 w-3" />
                      </button>
                      {canManage && (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditRegister(r)}
                            className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
                            aria-label={`Edit ${r.name}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRegisterActive(r.id, !r.is_active)}
                            className="cursor-pointer rounded p-0.5 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {r.is_active ? "off" : "on"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteRegisterId(r.id)}
                            className="cursor-pointer rounded p-0.5 text-destructive hover:text-destructive"
                            aria-label={`Delete ${r.name}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                          {confirmDeleteRegisterId === r.id && (
                            <span className="flex items-center gap-1 text-xs">
                              <button
                                type="button"
                                className="cursor-pointer font-medium text-destructive"
                                onClick={() => {
                                  deleteRegister(r.id, r.name);
                                  setConfirmDeleteRegisterId(null);
                                }}
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                className="cursor-pointer text-muted-foreground"
                                onClick={() => setConfirmDeleteRegisterId(null)}
                              >
                                Cancel
                              </button>
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  {store.registers.length === 0 && (
                    <span className="text-sm text-muted-foreground">No registers</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

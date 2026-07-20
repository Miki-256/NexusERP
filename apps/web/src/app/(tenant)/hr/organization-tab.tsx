"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import { SELECT_CLS } from "@/lib/ui-classes";
import { runHrMutation } from "@/lib/hr/mutations";
import type { OrgUnitRow, OrgUnitType } from "@/lib/hr/types";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight, Pencil, Plus, RefreshCw, X } from "lucide-react";

const UNIT_TYPES: OrgUnitType[] = [
  "company",
  "business_unit",
  "division",
  "region",
  "branch",
  "department",
  "team",
];

function buildTree(units: OrgUnitRow[]): (OrgUnitRow & { depth: number })[] {
  const ids = new Set(units.map((u) => u.id));
  const byParent = new Map<string | null, OrgUnitRow[]>();
  for (const u of units) {
    // Treat missing/inactive parents as roots so synced departments still render.
    const rawParent = u.parent_id ?? null;
    const key = rawParent && ids.has(rawParent) ? rawParent : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(u);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }
  const out: (OrgUnitRow & { depth: number })[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const u of byParent.get(parentId) ?? []) {
      out.push({ ...u, depth });
      walk(u.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

export function OrganizationTab({
  organizationId,
  canManage,
  employees,
}: {
  organizationId: string;
  canManage: boolean;
  employees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [units, setUnits] = useState<OrgUnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [unitType, setUnitType] = useState<OrgUnitType>("department");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [managerId, setManagerId] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [busy, setBusy] = useState(false);

  const loadUnits = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_org_units", { p_org_id: organizationId });
    if (error) {
      toast({ title: "Could not load org units", description: error.message, variant: "destructive" });
      setUnits([]);
    } else {
      setUnits(Array.isArray(data) ? (data as OrgUnitRow[]) : []);
    }
    setLoading(false);
  }, [organizationId, toast]);

  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

  const tree = useMemo(() => buildTree(units), [units]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setCode("");
    setUnitType("department");
    setParentId("");
    setDescription("");
    setManagerId("");
    setSortOrder("0");
    setFormOpen(false);
  }

  function openCreate() {
    resetForm();
    setFormOpen(true);
  }

  function openEdit(unit: OrgUnitRow) {
    setEditingId(unit.id);
    setName(unit.name);
    setCode(unit.code);
    setUnitType(unit.unit_type);
    setParentId(unit.parent_id ?? "");
    setDescription(unit.description ?? "");
    setManagerId(unit.manager_employee_id ?? "");
    setSortOrder(String(unit.sort_order));
    setFormOpen(true);
  }

  async function saveUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_org_unit", {
      p_org_id: organizationId,
      p_id: editingId,
      p_parent_id: parentId || null,
      p_unit_type: unitType,
      p_code: code.trim() || null,
      p_name: name.trim(),
      p_description: description.trim() || null,
      p_manager_employee_id: managerId || null,
      p_sort_order: Number(sortOrder) || 0,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Org unit updated" : "Org unit created" });
    resetForm();
    await loadUnits();
    router.refresh();
  }

  async function seedDefaults() {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("ensure_default_hr_org", { p_org_id: organizationId });
        return { error };
      },
      { successTitle: "Default org structure created" }
    );
    setBusy(false);
    await loadUnits();
  }

  async function syncDepartments() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("sync_analytic_departments_to_org", {
      p_org_id: organizationId,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Departments synced",
      description: `${data ?? 0} analytic department(s) linked to org units.`,
    });
    await loadUnits();
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void seedDefaults()}>
            <Building2 className="h-4 w-4" />
            Seed default
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void syncDepartments()}>
            <RefreshCw className="h-4 w-4" />
            Sync finance departments
          </Button>
          <Button size="sm" onClick={() => (formOpen ? resetForm() : openCreate())}>
            {formOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {formOpen ? "Close" : "Add unit"}
          </Button>
        </div>
      )}

      {formOpen && canManage && (
        <FormCard title={editingId ? "Edit org unit" : "New org unit"}>
          <form onSubmit={saveUnit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto-generated" />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select className={SELECT_CLS} value={unitType} onChange={(e) => setUnitType(e.target.value as OrgUnitType)}>
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Parent unit</Label>
              <select className={SELECT_CLS} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">— Root —</option>
                {units
                  .filter((u) => u.id !== editingId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Manager</Label>
              <select className={SELECT_CLS} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">— None —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Sort order</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-3">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </FormCard>
      )}

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-medium">Organization hierarchy</h3>
          <p className="text-sm text-muted-foreground">
            {units.length} unit{units.length === 1 ? "" : "s"} · headcount per unit
          </p>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : tree.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <p>No org units yet.</p>
            {canManage && (
              <Button variant="link" className="mt-2" onClick={() => void seedDefaults()}>
                Create default company structure
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {tree.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-2 px-4 py-3"
                style={{ paddingLeft: `${16 + u.depth * 20}px` }}
              >
                {u.depth > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {u.code} · {u.unit_type.replace("_", " ")} · {u.headcount} employee
                    {u.headcount === 1 ? "" : "s"}
                  </p>
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

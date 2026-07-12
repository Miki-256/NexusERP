"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { TableToolbar } from "@/components/layout/table-toolbar";
import { SELECT_CLS } from "@/lib/ui-classes";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
  is_postable?: boolean;
  parent_account_id?: string | null;
  sort_order?: number;
  depth?: number;
};

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

function buildTreeRows(accounts: AccountRow[]): (AccountRow & { depth: number })[] {
  const byParent = new Map<string | null, AccountRow[]>();
  for (const a of accounts) {
    const key = a.parent_account_id ?? null;
    const list = byParent.get(key) ?? [];
    list.push(a);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0) || x.code.localeCompare(y.code));
  }
  const out: (AccountRow & { depth: number })[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const a of byParent.get(parentId) ?? []) {
      out.push({ ...a, depth });
      walk(a.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

export function ChartOfAccountsTab({
  orgId,
  canManage,
  accounts: initialAccounts,
}: {
  orgId: string;
  canManage: boolean;
  accounts: AccountRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [search, setSearch] = useState("");
  const [treeView, setTreeView] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof ACCOUNT_TYPES)[number]>("expense");
  const [isActive, setIsActive] = useState(true);
  const [isPostable, setIsPostable] = useState(true);
  const [parentId, setParentId] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [busy, setBusy] = useState(false);

  const treeRows = useMemo(() => buildTreeRows(accounts), [accounts]);

  const filtered = useMemo(() => {
    const rows = treeView ? treeRows : accounts.map((a) => ({ ...a, depth: 0 }));
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }, [accounts, treeRows, treeView, search]);

  const parentOptions = useMemo(
    () => accounts.filter((a) => a.id !== editingId),
    [accounts, editingId]
  );

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setType("expense");
    setIsActive(true);
    setIsPostable(true);
    setParentId("");
    setSortOrder("0");
  }

  function startEdit(a: AccountRow) {
    setEditingId(a.id);
    setCode(a.code);
    setName(a.name);
    setType(a.type as (typeof ACCOUNT_TYPES)[number]);
    setIsActive(a.is_active);
    setIsPostable(a.is_postable !== false);
    setParentId(a.parent_account_id ?? "");
    setSortOrder(String(a.sort_order ?? 0));
  }

  async function refreshAccounts() {
    const supabase = createClient();
    const { data } = await supabase.rpc("list_accounts", { p_org_id: orgId });
    setAccounts((data as AccountRow[]) ?? []);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_account", {
      p_org_id: orgId,
      p_account_id: editingId,
      p_code: code.trim(),
      p_name: name.trim(),
      p_type: type,
      p_is_active: isActive,
      p_parent_account_id: parentId || null,
      p_is_postable: isPostable,
      p_sort_order: Number(sortOrder) || 0,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Account updated" : "Account created" });
    await refreshAccounts();
    resetForm();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <ReportSection
          title={editingId ? "Edit account" : "New account"}
          subtitle="Header accounts (non-postable) roll up child balances in reports"
        >
          <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6100" required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Office supplies" required />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select className={SELECT_CLS} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Parent account</Label>
              <select className={SELECT_CLS} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">None (top level)</option>
                {parentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Sort order</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            <div className="flex flex-col justify-end gap-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-input" />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isPostable} onChange={(e) => setIsPostable(e.target.checked)} className="rounded border-input" />
                Postable (allow journal lines)
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy}>
                  {busy ? "Saving…" : editingId ? "Update" : "Add account"}
                </Button>
                {editingId && (
                  <Button type="button" size="sm" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </form>
        </ReportSection>
      )}

      <ReportSection title="Chart of accounts" subtitle={`${accounts.length} accounts`}>
        <TableToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search code or name…"
          actions={
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={treeView} onChange={(e) => setTreeView(e.target.checked)} className="rounded border-input" />
              Tree view
            </label>
          }
        />
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Code</DataTableHead>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead>Posting</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {filtered.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="No accounts match your search." />
              ) : (
                filtered.map((a) => (
                  <DataTableRow key={a.id}>
                    <DataTableCell className="font-mono text-xs">
                      <span style={{ paddingLeft: `${(a.depth ?? 0) * 12}px` }} className={cn(a.depth ? "text-muted-foreground" : "")}>
                        {a.code}
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      <span style={{ paddingLeft: `${(a.depth ?? 0) * 8}px` }}>{a.name}</span>
                    </DataTableCell>
                    <DataTableCell className="capitalize text-muted-foreground">{a.type}</DataTableCell>
                    <DataTableCell>{a.is_postable === false ? "Header" : "Postable"}</DataTableCell>
                    <DataTableCell>{a.is_active ? "Active" : "Inactive"}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(a)}>
                          Edit
                        </Button>
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
        {canManage && !editingId && (
          <Button type="button" size="sm" variant="outline" className="mt-4" onClick={() => resetForm()}>
            <Plus className="mr-1.5 h-4 w-4" />
            New account
          </Button>
        )}
      </ReportSection>
    </div>
  );
}

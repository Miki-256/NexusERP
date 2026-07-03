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

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
};

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof ACCOUNT_TYPES)[number]>("expense");
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.toLowerCase();
    return accounts.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setType("expense");
    setIsActive(true);
  }

  function startEdit(a: AccountRow) {
    setEditingId(a.id);
    setCode(a.code);
    setName(a.name);
    setType(a.type as (typeof ACCOUNT_TYPES)[number]);
    setIsActive(a.is_active);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("upsert_account", {
      p_org_id: orgId,
      p_account_id: editingId,
      p_code: code.trim(),
      p_name: name.trim(),
      p_type: type,
      p_is_active: isActive,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Account updated" : "Account created" });
    const { data: list } = await supabase.rpc("list_accounts", { p_org_id: orgId });
    setAccounts((list as AccountRow[]) ?? []);
    resetForm();
    router.refresh();
    void data;
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <ReportSection
          title={editingId ? "Edit account" : "New account"}
          subtitle="Codes must be unique per organization"
        >
          <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-input"
                />
                Active
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
        <TableToolbar search={search} onSearchChange={setSearch} placeholder="Search code or name…" />
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Code</DataTableHead>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {filtered.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 5 : 4} message="No accounts match your search." />
              ) : (
                filtered.map((a) => (
                  <DataTableRow key={a.id}>
                    <DataTableCell className="font-mono text-xs">{a.code}</DataTableCell>
                    <DataTableCell>{a.name}</DataTableCell>
                    <DataTableCell className="capitalize text-muted-foreground">{a.type}</DataTableCell>
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

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { formatCurrency } from "@/lib/utils";
import { SELECT_CLS } from "@/lib/ui-classes";
import { Plus, Trash2 } from "lucide-react";
import type { AccountRow } from "@/components/finance/chart-of-accounts-tab";

type JournalOption = { id: string; code: string; name: string };

export type JournalDraft = {
  id: string;
  entry_date: string;
  memo: string | null;
  source_type: string | null;
  created_at: string;
  journal_code: string;
  total_debit: number;
  dual_approval_required?: boolean;
  approvals_received?: number;
  lines: { account_code: string; account_name: string; debit: number; credit: number; description: string | null }[];
};

type LineDraft = {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
  storeId: string;
  projectId: string;
  departmentId: string;
};

export function ManualJournalTab({
  orgId,
  currency,
  canManage,
  jeRequiresApproval,
  drafts: initialDrafts,
  accounts,
  journals,
  stores,
  projects,
  departments,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  jeRequiresApproval: boolean;
  drafts: JournalDraft[];
  accounts: AccountRow[];
  journals: JournalOption[];
  stores: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  departments: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [journalCode, setJournalCode] = useState(journals[0]?.code ?? "GEN");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { accountId: accounts[0]?.id ?? "", debit: "", credit: "", description: "", storeId: "", projectId: "", departmentId: "" },
    { accountId: accounts[1]?.id ?? accounts[0]?.id ?? "", debit: "", credit: "", description: "", storeId: "", projectId: "", departmentId: "" },
  ]);
  const [defaultStoreId, setDefaultStoreId] = useState("");
  const [defaultProjectId, setDefaultProjectId] = useState("");
  const [defaultDepartmentId, setDefaultDepartmentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState(initialDrafts);

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active && a.is_postable !== false),
    [accounts]
  );
  const money = (n: number) => formatCurrency(n, currency);

  const { totalDebit, totalCredit, balanced } = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const l of lines) {
      d += Number(l.debit) || 0;
      c += Number(l.credit) || 0;
    }
    return {
      totalDebit: d,
      totalCredit: c,
      balanced: Math.abs(d - c) < 0.01 && d > 0,
    };
  }, [lines]);

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        accountId: activeAccounts[0]?.id ?? "",
        debit: "",
        credit: "",
        description: "",
        storeId: defaultStoreId,
        projectId: defaultProjectId,
        departmentId: defaultDepartmentId,
      },
    ]);
  }

  function removeLine(i: number) {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !balanced) return;
    setBusy(true);
    const supabase = createClient();
    const payload = lines
      .filter((l) => l.accountId && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0))
      .map((l) => ({
        accountId: l.accountId,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        description: l.description || null,
        storeId: l.storeId || defaultStoreId || null,
        projectId: l.projectId || defaultProjectId || null,
        departmentId: l.departmentId || defaultDepartmentId || null,
      }));

    const { error } = await supabase.rpc("post_journal_entry", {
      p_org_id: orgId,
      p_journal_code: journalCode,
      p_date: entryDate,
      p_memo: memo.trim() || "Manual journal entry",
      p_source_type: "manual",
      p_source_id: crypto.randomUUID(),
      p_lines: payload,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Post failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: jeRequiresApproval ? "Submitted for approval" : "Journal entry posted",
      description: jeRequiresApproval
        ? "A manager can approve this draft from the queue below."
        : undefined,
    });
    setMemo("");
    setLines([
      { accountId: activeAccounts[0]?.id ?? "", debit: "", credit: "", description: "", storeId: "", projectId: "", departmentId: "" },
      { accountId: activeAccounts[1]?.id ?? activeAccounts[0]?.id ?? "", debit: "", credit: "", description: "", storeId: "", projectId: "", departmentId: "" },
    ]);
    router.refresh();
  }

  async function approveDraft(id: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("approve_journal_entry", { p_entry_id: id });
    setBusy(false);
    if (error) {
      toast({ title: "Approve failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Journal entry approved and posted" });
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    router.refresh();
  }

  async function rejectDraft(id: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("reject_journal_entry_draft", { p_entry_id: id });
    setBusy(false);
    if (error) {
      toast({ title: "Reject failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Draft rejected" });
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    router.refresh();
  }

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">You need accounting manager access to post manual entries.</p>
    );
  }

  return (
    <div className="space-y-6">
    <ReportSection
      title="Manual journal entry"
      subtitle={
        jeRequiresApproval
          ? "Entries are saved as drafts until approved. Locked periods cannot be posted."
          : "Balanced debits and credits required before posting"
      }
    >
      <form onSubmit={handlePost} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Journal</Label>
            <select className={SELECT_CLS} value={journalCode} onChange={(e) => setJournalCode(e.target.value)}>
              {journals.map((j) => (
                <option key={j.id} value={j.code}>
                  {j.code} — {j.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Entry date</Label>
            <DatePicker value={entryDate} onChange={setEntryDate} />
          </div>
          <div className="space-y-2 sm:col-span-1">
            <Label>Memo</Label>
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Adjustment description" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Default store</Label>
            <select className={SELECT_CLS} value={defaultStoreId} onChange={(e) => setDefaultStoreId(e.target.value)}>
              <option value="">None</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Default project</Label>
            <select className={SELECT_CLS} value={defaultProjectId} onChange={(e) => setDefaultProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Default department</Label>
            <select className={SELECT_CLS} value={defaultDepartmentId} onChange={(e) => setDefaultDepartmentId(e.target.value)}>
              <option value="">None</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Lines</Label>
          {lines.map((line, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border/60 bg-muted/10 p-3 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <select
                  className={SELECT_CLS}
                  value={line.accountId}
                  onChange={(e) => updateLine(i, { accountId: e.target.value })}
                >
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Debit"
                  value={line.debit}
                  onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Credit"
                  value={line.credit}
                  onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
                />
              </div>
              <div className="sm:col-span-3">
                <Input
                  placeholder="Line description"
                  value={line.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                />
              </div>
              <div className="flex items-center sm:col-span-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={lines.length <= 2}
                  onClick={() => removeLine(i)}
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={addLine}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add line
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Debits:</span>{" "}
            <span className="font-mono font-medium">{money(totalDebit)}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="text-muted-foreground">Credits:</span>{" "}
            <span className="font-mono font-medium">{money(totalCredit)}</span>
          </div>
          <Button type="submit" disabled={busy || !balanced}>
            {busy ? "Saving…" : jeRequiresApproval ? "Submit for approval" : "Post entry"}
          </Button>
        </div>
        {!balanced && totalDebit + totalCredit > 0 && (
          <p className="text-sm text-amber-700">Entry is out of balance — adjust debits and credits.</p>
        )}
      </form>
    </ReportSection>

    {jeRequiresApproval && drafts.length > 0 && (
      <ReportSection title="Pending approval" subtitle={`${drafts.length} draft entr${drafts.length === 1 ? "y" : "ies"}`}>
        <div className="space-y-3">
          {drafts.map((d) => (
            <div key={d.id} className="rounded-lg border border-border/60 bg-muted/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{d.memo || "Manual journal entry"}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.entry_date} · {d.journal_code} · {money(d.total_debit)}
                    {d.dual_approval_required && (
                      <> · {d.approvals_received ?? 0}/2 approvals</>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => approveDraft(d.id)}>
                    {d.dual_approval_required && (d.approvals_received ?? 0) < 1
                      ? "First approval"
                      : "Approve"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => rejectDraft(d.id)}>
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ReportSection>
    )}
    </div>
  );
}

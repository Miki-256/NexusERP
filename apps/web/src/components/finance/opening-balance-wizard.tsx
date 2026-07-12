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

type BalanceLine = {
  accountId: string;
  debit: string;
  credit: string;
};

export function OpeningBalanceWizard({
  orgId,
  currency,
  canManage,
  accounts,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  accounts: AccountRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("Opening balances");
  const [lines, setLines] = useState<BalanceLine[]>([
    { accountId: "", debit: "", credit: "" },
    { accountId: "", debit: "", credit: "" },
  ]);
  const [busy, setBusy] = useState(false);

  const postableAccounts = useMemo(
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
    return { totalDebit: d, totalCredit: c, balanced: Math.abs(d - c) < 0.01 && d > 0 };
  }, [lines]);

  function updateLine(i: number, patch: Partial<BalanceLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleImport(e: React.FormEvent) {
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
        description: "Opening balance",
      }));

    const { data, error } = await supabase.rpc("import_opening_balances", {
      p_org_id: orgId,
      p_date: entryDate,
      p_lines: payload,
      p_memo: memo.trim() || "Opening balances",
    });
    setBusy(false);
    if (error) {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Opening balances posted", description: `Journal entry ${String(data).slice(0, 8)}…` });
    setLines([
      { accountId: "", debit: "", credit: "" },
      { accountId: "", debit: "", credit: "" },
    ]);
    router.refresh();
  }

  if (!canManage) return null;

  return (
    <ReportSection
      title="Opening balance wizard"
      subtitle="Post beginning balances as a balanced journal entry (typically equity offset)"
    >
      <form onSubmit={handleImport} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>As-of date</Label>
            <DatePicker value={entryDate} onChange={setEntryDate} />
          </div>
          <div className="space-y-2">
            <Label>Memo</Label>
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>

        {lines.map((line, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-border/60 bg-muted/10 p-3 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <select
                className={SELECT_CLS}
                value={line.accountId}
                onChange={(e) => updateLine(i, { accountId: e.target.value })}
              >
                <option value="">Select account</option>
                {postableAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3">
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Debit"
                value={line.debit}
                onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
              />
            </div>
            <div className="sm:col-span-3">
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Credit"
                value={line.credit}
                onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
              />
            </div>
            <div className="flex items-center sm:col-span-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={lines.length <= 2}
                onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove line"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}

        <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, { accountId: "", debit: "", credit: "" }])}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add line
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Debits:</span>{" "}
            <span className="font-mono font-medium">{money(totalDebit)}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="text-muted-foreground">Credits:</span>{" "}
            <span className="font-mono font-medium">{money(totalCredit)}</span>
          </div>
          <Button type="submit" disabled={busy || !balanced}>
            {busy ? "Posting…" : "Post opening balances"}
          </Button>
        </div>
      </form>
    </ReportSection>
  );
}

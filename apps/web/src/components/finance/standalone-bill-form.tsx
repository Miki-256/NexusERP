"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import { Plus } from "lucide-react";
import { SELECT_CLS } from "@/lib/ui-classes";

type BillLine = { description: string; amount: string };

export function StandaloneBillForm({
  orgId,
  vendors,
}: {
  orgId: string;
  vendors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<BillLine[]>([{ description: "", amount: "" }]);
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId) return;
    const payload = lines
      .filter((l) => l.description.trim() && l.amount)
      .map((l) => ({ description: l.description.trim(), amount: Number(l.amount) }));
    if (payload.length === 0) {
      toast({ title: "Add at least one line", variant: "destructive" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_vendor_bill", {
      p_org_id: orgId,
      p_vendor_id: vendorId,
      p_bill_no: billNo || null,
      p_bill_date: billDate,
      p_due_date: dueDate || null,
      p_memo: memo || null,
      p_lines: payload,
    });
    if (error) {
      setBusy(false);
      toast({ title: "Could not create bill", description: error.message, variant: "destructive" });
      return;
    }
    const billId = data as string;
    const { error: postErr } = await supabase.rpc("post_vendor_bill", { p_bill_id: billId });
    setBusy(false);
    if (postErr) {
      toast({ title: "Draft created — post failed", description: postErr.message, variant: "destructive" });
    } else {
      toast({ title: "Vendor bill created and posted" });
      setLines([{ description: "", amount: "" }]);
      setBillNo("");
      setMemo("");
    }
    router.refresh();
  }

  return (
    <FormCard title="Standalone vendor bill" onSubmit={handleCreate}>
      <p className="mb-4 text-sm text-muted-foreground">
        Enter a bill without a purchase order. Duplicate vendor + date + amount is blocked.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label>Vendor</Label>
          <select className={SELECT_CLS} value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Bill number</Label>
          <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="Optional" />
        </div>
        <div className="space-y-2">
          <Label>Bill date</Label>
          <DatePicker value={billDate} onChange={setBillDate} />
        </div>
        <div className="space-y-2">
          <Label>Due date</Label>
          <DatePicker value={dueDate} onChange={setDueDate} />
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <Label>Lines</Label>
        {lines.map((line, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-3">
            <Input
              className="sm:col-span-2"
              placeholder="Description"
              value={line.description}
              onChange={(e) =>
                setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, description: e.target.value } : l)))
              }
            />
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount"
              value={line.amount}
              onChange={(e) =>
                setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, amount: e.target.value } : l)))
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLines((p) => [...p, { description: "", amount: "" }])}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add line
        </Button>
      </div>
      <div className="mt-4 space-y-2">
        <Label>Memo</Label>
        <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
      </div>
      <Button type="submit" disabled={busy} className="mt-4">
        {busy ? "Saving…" : "Create & post bill"}
      </Button>
    </FormCard>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ResponsiveTableLayout } from "@/components/layout/responsive-table-layout";
import { formatCurrency } from "@/lib/utils";
import { SELECT_CLS } from "@/lib/ui-classes";
import { Ticket } from "lucide-react";

export type GiftCardRow = {
  id: string;
  code: string;
  balance: number;
  initial_balance: number;
  status: string;
  expires_at: string | null;
  note: string | null;
  customer_name: string | null;
  created_at: string;
};

export function GiftCardsPanel({
  organizationId,
  currency,
  canManage,
  customers,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  customers: { id: string; name: string | null }[];
}) {
  const { toast } = useToast();
  const [cards, setCards] = useState<GiftCardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [note, setNote] = useState("");
  const money = (n: number) => formatCurrency(Number(n), currency);

  const loadCards = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_gift_cards", {
      p_org_id: organizationId,
      p_limit: 100,
      p_offset: 0,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Could not load gift cards", description: error.message, variant: "destructive" });
      return;
    }
    const row = data as { rows?: GiftCardRow[]; total?: number };
    setCards((row?.rows ?? []) as GiftCardRow[]);
    setTotal(row?.total ?? 0);
  }, [organizationId, toast]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  async function issueCard(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !amount) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("issue_gift_card", {
      p_org_id: organizationId,
      p_amount: Number(amount),
      p_code: code.trim() || null,
      p_customer_id: customerId || null,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Issue failed", description: error.message, variant: "destructive" });
      return;
    }
    const issued = data as { code?: string };
    toast({
      title: "Gift card issued",
      description: issued?.code ? `Code: ${issued.code}` : undefined,
    });
    setAmount("");
    setCode("");
    setNote("");
    void loadCards();
  }

  async function voidCard(id: string, cardCode: string) {
    if (!canManage) return;
    const reason = window.prompt(`Void gift card ${cardCode}? Optional reason:`);
    if (reason === null) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("void_gift_card", {
      p_gift_card_id: id,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Void failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Gift card voided" });
    void loadCards();
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <FormCard title="Issue gift card" onSubmit={issueCard}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Custom code (optional)</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Auto-generated" className="font-mono uppercase" />
            </div>
            <div className="space-y-2">
              <Label>Customer (optional)</Label>
              <select className={SELECT_CLS} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— None —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name ?? "Unnamed"}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Holiday promo…" />
            </div>
          </div>
          <Button type="submit" disabled={busy} className="mt-4 gap-2">
            <Ticket className="h-4 w-4" />
            {busy ? "Issuing…" : "Issue card"}
          </Button>
        </FormCard>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Gift cards ({total})</h3>
        <p className="text-xs text-muted-foreground">Prepaid cards redeemable at POS checkout</p>
      </div>
      <ResponsiveTableLayout
        mobile={
          <div className="space-y-3">
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!loading && cards.length === 0 && (
              <p className="text-sm text-muted-foreground">No gift cards yet</p>
            )}
            {cards.map((c) => (
              <MobileRecordCard key={c.id}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-mono text-sm font-semibold">{c.code}</p>
                  <p className="text-xs capitalize text-muted-foreground">{c.status}</p>
                </div>
                <MobileRecordCardRow label="Balance">{money(c.balance)}</MobileRecordCardRow>
                <MobileRecordCardRow label="Customer">{c.customer_name ?? "—"}</MobileRecordCardRow>
                <MobileRecordCardRow label="Issued">
                  {new Date(c.created_at).toLocaleDateString()}
                </MobileRecordCardRow>
                {canManage && c.status === "active" && (
                  <Button type="button" variant="outline" size="sm" className="mt-3 w-full" disabled={busy} onClick={() => void voidCard(c.id, c.code)}>
                    Void card
                  </Button>
                )}
              </MobileRecordCard>
            ))}
          </div>
        }
      >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead>Code</DataTableHead>
                <DataTableHead>Balance</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead>Customer</DataTableHead>
                <DataTableHead>Issued</DataTableHead>
                {canManage && <DataTableHead>Actions</DataTableHead>}
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {loading ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="Loading…" />
              ) : cards.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="No gift cards yet" />
              ) : (
                cards.map((c) => (
                  <DataTableRow key={c.id}>
                    <DataTableCell className="font-mono text-sm">{c.code}</DataTableCell>
                    <DataTableCell>{money(c.balance)}</DataTableCell>
                    <DataTableCell className="capitalize">{c.status}</DataTableCell>
                    <DataTableCell>{c.customer_name ?? "—"}</DataTableCell>
                    <DataTableCell>{new Date(c.created_at).toLocaleDateString()}</DataTableCell>
                    {canManage && (
                      <DataTableCell>
                        {c.status === "active" && (
                          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void voidCard(c.id, c.code)}>
                            Void
                          </Button>
                        )}
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ResponsiveTableLayout>
    </div>
  );
}

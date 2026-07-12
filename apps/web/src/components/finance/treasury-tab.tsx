"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { StatCard } from "@/components/layout/stat-card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { formatCurrency } from "@/lib/utils";
import { SELECT_CLS } from "@/lib/ui-classes";
import { ArrowLeftRight, Landmark, TrendingUp, Wallet } from "lucide-react";
import type { BankAccountRow } from "@/components/finance/banking-tab";

export type TreasuryCashPosition = {
  as_of: string;
  currency: string;
  cash_on_hand: number;
  mobile_money: number;
  bank_accounts_total: number;
  total_liquid: number;
  unreconciled_lines: number;
  open_receivables: number;
  pending_ap_payment_runs: number;
  bank_accounts?: {
    id: string;
    name: string;
    currency: string;
    account_type: string;
    gl_balance: number;
    below_minimum?: boolean;
    unreconciled_lines: number;
  }[];
};

export type TreasuryForecast = {
  starting_liquid: number;
  projected_ar_inflows: number;
  projected_ap_outflows: number;
  pending_payment_runs: number;
  projected_ending_liquid: number;
  horizon_days: number;
  weekly?: {
    week_start: string;
    week_end: string;
    projected_inflows: number;
    projected_outflows: number;
    net: number;
  }[];
};

export type TreasuryTransferRow = {
  id: string;
  transfer_date: string;
  amount: number;
  from_bank_account_name: string;
  to_bank_account_name: string;
  memo: string | null;
  status: string;
};

export function TreasuryTab({
  orgId,
  currency,
  canManage,
  asOf,
  bankAccounts,
  cashPosition: initialPosition,
  forecast: initialForecast,
  transfers: initialTransfers,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  asOf: string;
  bankAccounts: BankAccountRow[];
  cashPosition: TreasuryCashPosition | null;
  forecast: TreasuryForecast | null;
  transfers: TreasuryTransferRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [position, setPosition] = useState(initialPosition);
  const [forecast, setForecast] = useState(initialForecast);
  const [transfers, setTransfers] = useState(initialTransfers);
  const [busy, setBusy] = useState("");

  const [fromId, setFromId] = useState(bankAccounts[0]?.id ?? "");
  const [toId, setToId] = useState(bankAccounts[1]?.id ?? bankAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [transferDate, setTransferDate] = useState(asOf);
  const [memo, setMemo] = useState("");

  const money = (n: number | undefined) => formatCurrency(n ?? 0, position?.currency ?? currency);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const [posRes, fcRes, txRes] = await Promise.all([
      supabase.rpc("get_treasury_cash_position", { p_org_id: orgId, p_as_of: asOf }),
      supabase.rpc("get_treasury_liquidity_forecast", { p_org_id: orgId, p_days: 30, p_as_of: asOf }),
      supabase.rpc("list_treasury_transfers", { p_org_id: orgId, p_limit: 20 }),
    ]);
    if (posRes.data) setPosition(posRes.data as TreasuryCashPosition);
    if (fcRes.data) setForecast(fcRes.data as TreasuryForecast);
    if (txRes.data) setTransfers((txRes.data as TreasuryTransferRow[]) ?? []);
  }, [orgId, asOf]);

  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !fromId || !toId || fromId === toId) return;
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    setBusy("transfer");
    const supabase = createClient();
    const { error } = await supabase.rpc("create_treasury_transfer", {
      p_org_id: orgId,
      p_from_bank_account_id: fromId,
      p_to_bank_account_id: toId,
      p_amount: parsed,
      p_transfer_date: transferDate,
      p_memo: memo || null,
      p_reference: null,
    });
    setBusy("");
    if (error) {
      toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Transfer posted" });
    setAmount("");
    setMemo("");
    await reload();
    router.refresh();
  }

  const activeBanks = bankAccounts.filter((a) => a.is_active);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total liquid" value={money(position?.total_liquid)} sub={`As of ${asOf}`} icon={Wallet} />
        <StatCard label="Bank accounts" value={money(position?.bank_accounts_total)} icon={Landmark} />
        <StatCard label="Cash + mobile" value={money((position?.cash_on_hand ?? 0) + (position?.mobile_money ?? 0))} icon={Wallet} />
        <StatCard
          label="Projected (30d)"
          value={money(forecast?.projected_ending_liquid)}
          sub={`AR in ${money(forecast?.projected_ar_inflows)} · AP out ${money(forecast?.projected_ap_outflows)}`}
          icon={TrendingUp}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Open receivables" value={money(position?.open_receivables)} />
        <StatCard label="Pending AP runs" value={money(position?.pending_ap_payment_runs)} />
        <StatCard label="Unreconciled lines" value={String(position?.unreconciled_lines ?? 0)} />
      </div>

      <ReportSection title="Cash by account" subtitle="GL balances · minimum balance alerts">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Account</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead align="right">Balance</DataTableHead>
              <DataTableHead align="right">Unreconciled</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {(position?.bank_accounts ?? []).length === 0 ? (
                <DataTableEmpty colSpan={4} message="No active bank accounts." />
              ) : (
                (position?.bank_accounts ?? []).map((a) => (
                  <DataTableRow key={a.id}>
                    <DataTableCell>
                      {a.name}
                      {a.below_minimum && (
                        <span className="ml-2 text-xs text-destructive">Below minimum</span>
                      )}
                    </DataTableCell>
                    <DataTableCell className="capitalize">{a.account_type?.replace(/_/g, " ")}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(a.gl_balance))}</DataTableCell>
                    <DataTableCell align="right">{a.unreconciled_lines}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      {canManage && activeBanks.length >= 2 && (
        <ReportSection title="Internal transfer" subtitle="Move cash between bank GL accounts">
          <form onSubmit={submitTransfer} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2">
              <Label>From</Label>
              <select className={SELECT_CLS} value={fromId} onChange={(e) => setFromId(e.target.value)} required>
                {activeBanks.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <select className={SELECT_CLS} value={toId} onChange={(e) => setToId(e.target.value)} required>
                {activeBanks.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <DatePicker value={transferDate} onChange={setTransferDate} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Memo</Label>
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Operating to payroll" />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={busy === "transfer"}>
                <ArrowLeftRight className="mr-1.5 h-4 w-4" />
                Post transfer
              </Button>
            </div>
          </form>
        </ReportSection>
      )}

      <ReportSection title="Liquidity forecast" subtitle={`${forecast?.horizon_days ?? 30}-day horizon based on invoice/bill due dates`}>
        {(forecast?.weekly ?? []).length > 0 ? (
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Week</DataTableHead>
                <DataTableHead align="right">Inflows</DataTableHead>
                <DataTableHead align="right">Outflows</DataTableHead>
                <DataTableHead align="right">Net</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {(forecast?.weekly ?? []).map((w, i) => (
                  <DataTableRow key={i}>
                    <DataTableCell className="text-xs">{w.week_start} → {w.week_end}</DataTableCell>
                    <DataTableCell align="right" className="font-mono text-emerald-600">{money(w.projected_inflows)}</DataTableCell>
                    <DataTableCell align="right" className="font-mono text-destructive">{money(w.projected_outflows)}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(w.net)}</DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </table>
          </DataTable>
        ) : (
          <p className="text-sm text-muted-foreground">No forecast data for this period.</p>
        )}
      </ReportSection>

      <ReportSection title="Transfer history" subtitle="Posted internal treasury transfers">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Date</DataTableHead>
              <DataTableHead>From → To</DataTableHead>
              <DataTableHead align="right">Amount</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {transfers.length === 0 ? (
                <DataTableEmpty colSpan={3} message="No transfers yet." />
              ) : (
                transfers.map((t) => (
                  <DataTableRow key={t.id}>
                    <DataTableCell>{t.transfer_date}</DataTableCell>
                    <DataTableCell>{t.from_bank_account_name} → {t.to_bank_account_name}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(t.amount))}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>
    </div>
  );
}

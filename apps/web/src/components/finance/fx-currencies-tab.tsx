"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { StatCard } from "@/components/layout/stat-card";
import { StatusBadge } from "@/components/layout/status-badge";
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
import { ArrowLeftRight, RefreshCw, TrendingUp } from "lucide-react";

export type ExchangeRateRow = {
  id: string;
  currency_code: string;
  rate_date: string;
  rate: number;
  rate_type: string;
  source: string | null;
};

export type FxRevaluationRunRow = {
  id: string;
  as_of_date: string;
  status: string;
  total_gain: number;
  total_loss: number;
  memo: string | null;
  created_at: string;
  reversed_at: string | null;
};

type FxBalanceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  currency_code: string;
  foreign_balance: number;
  book_balance: number;
  closing_rate: number;
  translated_balance: number;
  unrealized_adjustment: number;
  source: string;
};

export function FxCurrenciesTab({
  orgId,
  currency,
  canManage,
  asOf,
  exchangeRates: initialRates,
  revaluationRuns: initialRuns,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  asOf: string;
  exchangeRates: ExchangeRateRow[];
  revaluationRuns: FxRevaluationRunRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);
  const fc = (n: number, code: string) => formatCurrency(n, code);

  const [rates, setRates] = useState(initialRates);
  const [runs, setRuns] = useState(initialRuns);
  const [previewDate, setPreviewDate] = useState(asOf);
  const [preview, setPreview] = useState<{
    accounts: FxBalanceRow[];
    total_gain: number;
    total_loss: number;
  } | null>(null);
  const [busy, setBusy] = useState("");

  const [rateCurrency, setRateCurrency] = useState("USD");
  const [rateDate, setRateDate] = useState(asOf);
  const [rateValue, setRateValue] = useState("");
  const [rateType, setRateType] = useState("spot");

  async function reloadRates() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_exchange_rates", { p_org_id: orgId });
    if (error) throw error;
    const payload = data as { rates?: ExchangeRateRow[] };
    setRates(payload.rates ?? []);
  }

  async function reloadRuns() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_fx_revaluation_runs", {
      p_org_id: orgId,
      p_limit: 20,
    });
    if (error) throw error;
    setRuns(Array.isArray(data) ? (data as FxRevaluationRunRow[]) : []);
  }

  async function handleAddRate(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const parsed = parseFloat(rateValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: "Invalid rate", description: "Enter a positive exchange rate.", variant: "destructive" });
      return;
    }
    setBusy("rate");
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_exchange_rate", {
      p_org_id: orgId,
      p_currency_code: rateCurrency.toUpperCase(),
      p_rate_date: rateDate,
      p_rate: parsed,
      p_rate_type: rateType,
      p_source: "manual",
    });
    setBusy("");
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Exchange rate saved" });
    setRateValue("");
    await reloadRates();
    router.refresh();
  }

  async function loadPreview() {
    setBusy("preview");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("preview_fx_revaluation", {
      p_org_id: orgId,
      p_as_of: previewDate,
    });
    setBusy("");
    if (error) {
      toast({ title: "Preview failed", description: error.message, variant: "destructive" });
      return;
    }
    const payload = data as {
      accounts?: FxBalanceRow[];
      total_gain?: number;
      total_loss?: number;
    };
    setPreview({
      accounts: payload.accounts ?? [],
      total_gain: Number(payload.total_gain ?? 0),
      total_loss: Number(payload.total_loss ?? 0),
    });
  }

  async function runRevaluation() {
    if (!canManage) return;
    setBusy("run");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("run_fx_revaluation", {
      p_org_id: orgId,
      p_as_of: previewDate,
      p_memo: null,
    });
    setBusy("");
    if (error) {
      toast({ title: "Revaluation failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as { posted?: boolean; message?: string; total_gain?: number; total_loss?: number };
    toast({
      title: result.posted ? "Revaluation posted" : "No adjustment",
      description: result.posted
        ? `Gain ${money(Number(result.total_gain ?? 0))} · Loss ${money(Number(result.total_loss ?? 0))}`
        : result.message ?? "Nothing to revalue.",
    });
    await reloadRuns();
    await loadPreview();
    router.refresh();
  }

  async function reverseRun(runId: string) {
    if (!canManage || !window.confirm("Reverse this FX revaluation journal?")) return;
    setBusy(`rev-${runId}`);
    const supabase = createClient();
    const { error } = await supabase.rpc("reverse_fx_revaluation", { p_run_id: runId });
    setBusy("");
    if (error) {
      toast({ title: "Reverse failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Revaluation reversed" });
    await reloadRuns();
    router.refresh();
  }

  const uniqueCurrencies = [...new Set(rates.map((r) => r.currency_code))];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Functional currency"
          value={currency}
          sub="All GL amounts in this currency"
          icon={ArrowLeftRight}
        />
        <StatCard
          label="Tracked currencies"
          value={String(uniqueCurrencies.length)}
          sub={`${rates.length} rate row(s)`}
          icon={TrendingUp}
        />
        <StatCard
          label="Revaluation runs"
          value={String(runs.filter((r) => r.status === "posted").length)}
          sub={`${runs.filter((r) => r.status === "reversed").length} reversed`}
          icon={RefreshCw}
        />
      </div>

      <ReportSection
        title="Exchange rates"
        subtitle={`1 unit of foreign currency = rate × ${currency}. Rates apply to FC journals and period-end revaluation.`}
      >
        {canManage && (
          <form onSubmit={handleAddRate} className="mb-4 grid gap-3 sm:grid-cols-5">
            <div>
              <Label htmlFor="fx-currency">Currency</Label>
              <Input
                id="fx-currency"
                value={rateCurrency}
                onChange={(e) => setRateCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                placeholder="USD"
                required
              />
            </div>
            <div>
              <Label>Rate date</Label>
              <DatePicker value={rateDate} onChange={setRateDate} />
            </div>
            <div>
              <Label htmlFor="fx-rate">Rate</Label>
              <Input
                id="fx-rate"
                type="number"
                step="0.0001"
                min="0"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
                placeholder={`Per 1 ${rateCurrency || "USD"}`}
                required
              />
            </div>
            <div>
              <Label htmlFor="fx-type">Type</Label>
              <select
                id="fx-type"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={rateType}
                onChange={(e) => setRateType(e.target.value)}
              >
                <option value="spot">Spot</option>
                <option value="month_end">Month end</option>
                <option value="average">Average</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={!!busy}>
                Save rate
              </Button>
            </div>
          </form>
        )}

        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Currency</DataTableHead>
              <DataTableHead>Date</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead align="right">Rate</DataTableHead>
              <DataTableHead>Source</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {rates.length === 0 ? (
                <DataTableEmpty colSpan={5} message="No exchange rates yet. Add a rate to enable FC operations." />
              ) : (
                rates.map((r) => (
                  <DataTableRow key={r.id}>
                    <DataTableCell className="font-mono">{r.currency_code}</DataTableCell>
                    <DataTableCell>{r.rate_date}</DataTableCell>
                    <DataTableCell>{r.rate_type.replace(/_/g, " ")}</DataTableCell>
                    <DataTableCell align="right">
                      {Number(r.rate).toLocaleString(undefined, { maximumFractionDigits: 6 })} {currency}
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">{r.source ?? "—"}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      <ReportSection
        title="FX revaluation"
        subtitle="Compare foreign balances at closing rates vs book balances. Posts unrealized gain (4910) / loss (4920)."
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <Label>As of</Label>
            <DatePicker value={previewDate} onChange={setPreviewDate} />
          </div>
          <Button variant="outline" disabled={!!busy} onClick={loadPreview}>
            Preview
          </Button>
          {canManage && (
            <Button disabled={!!busy} onClick={runRevaluation}>
              Run revaluation
            </Button>
          )}
        </div>

        {preview && (
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <StatCard label="Unrealized gain" value={money(preview.total_gain)} sub="Before posting" />
            <StatCard label="Unrealized loss" value={money(preview.total_loss)} sub="Before posting" />
          </div>
        )}

        {preview && preview.accounts.length > 0 && (
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Account</DataTableHead>
                <DataTableHead>FC</DataTableHead>
                <DataTableHead align="right">Foreign bal.</DataTableHead>
                <DataTableHead align="right">Book ({currency})</DataTableHead>
                <DataTableHead align="right">Rate</DataTableHead>
                <DataTableHead align="right">Adjustment</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {preview.accounts.map((a) => (
                  <DataTableRow key={a.account_id}>
                    <DataTableCell>
                      <span className="font-mono text-xs">{a.account_code}</span> {a.account_name}
                    </DataTableCell>
                    <DataTableCell>{a.currency_code}</DataTableCell>
                    <DataTableCell align="right">{fc(Number(a.foreign_balance), a.currency_code)}</DataTableCell>
                    <DataTableCell align="right">{money(Number(a.book_balance))}</DataTableCell>
                    <DataTableCell align="right">{Number(a.closing_rate).toFixed(4)}</DataTableCell>
                    <DataTableCell align="right" className={Number(a.unrealized_adjustment) >= 0 ? "text-emerald-600" : "text-destructive"}>
                      {money(Number(a.unrealized_adjustment))}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </table>
          </DataTable>
        )}

        {preview && preview.accounts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No foreign-currency monetary balances found. Create a bank account in a foreign currency or tag an account with a currency code.
          </p>
        )}
      </ReportSection>

      <ReportSection title="Revaluation history" subtitle="Posted period-end FX runs">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>As of</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Gain</DataTableHead>
              <DataTableHead align="right">Loss</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {runs.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 5 : 4} message="No revaluation runs yet." />
              ) : (
                runs.map((r) => (
                  <DataTableRow key={r.id}>
                    <DataTableCell>{r.as_of_date}</DataTableCell>
                    <DataTableCell>
                      <StatusBadge status={r.status === "posted" ? "posted" : "cancelled"} />
                    </DataTableCell>
                    <DataTableCell align="right">{money(Number(r.total_gain))}</DataTableCell>
                    <DataTableCell align="right">{money(Number(r.total_loss))}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        {r.status === "posted" && (
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => reverseRun(r.id)}>
                            Reverse
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
      </ReportSection>
    </div>
  );
}

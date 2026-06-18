import { getCurrentMembership } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PnL = {
  from: string;
  to: string;
  revenue: number;
  tax_collected: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number;
  operating_expenses: number;
  net_profit: number;
  net_margin_pct: number;
};

type TrialRow = {
  account_code: string;
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
  balance: number;
};

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(now) };
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const sp = await searchParams;
  const def = monthRange();
  const from = sp.from ?? def.from;
  const to = sp.to ?? def.to;
  const currency = ctx.organization.currency;

  const supabase = await createClient();
  const { data: pnlData } = await supabase.rpc("profit_and_loss", {
    p_org_id: ctx.organization.id,
    p_from: from,
    p_to: to,
  });
  const pnl = (pnlData ?? {}) as Partial<PnL>;

  const { data: trialData } = await supabase.rpc("trial_balance", {
    p_org_id: ctx.organization.id,
    p_to: to,
  });
  const trial = (trialData ?? []) as TrialRow[];

  const money = (n: number | undefined) => formatCurrency(n ?? 0, currency);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Financials</h1>
        <p className="text-sm text-muted-foreground">
          {from} → {to}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Revenue" value={money(pnl.revenue)} />
        <StatCard label="Gross Profit" value={money(pnl.gross_profit)} sub={`${pnl.gross_margin_pct ?? 0}% margin`} />
        <StatCard label="Operating Expenses" value={money(pnl.operating_expenses)} />
        <StatCard
          label="Net Profit"
          value={money(pnl.net_profit)}
          sub={`${pnl.net_margin_pct ?? 0}% margin`}
          highlight={(pnl.net_profit ?? 0) >= 0 ? "pos" : "neg"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profit &amp; Loss Statement</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              <Line label="Revenue" value={money(pnl.revenue)} bold />
              <Line label="Cost of Goods Sold" value={`(${money(pnl.cogs)})`} indent />
              <Line label="Gross Profit" value={money(pnl.gross_profit)} bold border />
              <Line label="Operating Expenses" value={`(${money(pnl.operating_expenses)})`} indent />
              <Line label="Net Profit" value={money(pnl.net_profit)} bold border />
              <tr>
                <td colSpan={2} className="pt-3 text-xs text-muted-foreground">
                  Tax collected (liability, not revenue): {money(pnl.tax_collected)}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trial Balance (as of {to})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left">Code</th>
                <th className="p-3 text-left">Account</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-right">Debit</th>
                <th className="p-3 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {trial.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-muted-foreground">
                    No ledger entries yet. Posted sales and expenses will appear here.
                  </td>
                </tr>
              ) : (
                trial.map((r) => (
                  <tr key={r.account_code} className="border-b">
                    <td className="p-3 font-mono">{r.account_code}</td>
                    <td className="p-3">{r.account_name}</td>
                    <td className="p-3 capitalize text-muted-foreground">{r.account_type}</td>
                    <td className="p-3 text-right font-mono">{r.debit ? money(r.debit) : "—"}</td>
                    <td className="p-3 text-right font-mono">{r.credit ? money(r.credit) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: "pos" | "neg";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={
            "text-xl font-bold " +
            (highlight === "pos" ? "text-emerald-600" : highlight === "neg" ? "text-red-600" : "")
          }
        >
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Line({
  label,
  value,
  bold,
  indent,
  border,
}: {
  label: string;
  value: string;
  bold?: boolean;
  indent?: boolean;
  border?: boolean;
}) {
  return (
    <tr className={border ? "border-t" : ""}>
      <td className={`py-2 ${indent ? "pl-6 text-muted-foreground" : ""} ${bold ? "font-semibold" : ""}`}>
        {label}
      </td>
      <td className={`py-2 text-right font-mono ${bold ? "font-semibold" : ""}`}>{value}</td>
    </tr>
  );
}

"use client";

import { ChartCard, FinanceBarChart, PnlWaterfallChart } from "@/components/charts/finance-charts";
import { formatCurrency } from "@/lib/utils";

type PnlSnapshot = {
  revenue?: number;
  cogs?: number;
  operating_expenses?: number;
  net_profit?: number;
  gross_margin_pct?: number;
  net_margin_pct?: number;
};

type CashFlowSnapshot = {
  inflows?: number;
  outflows?: number;
  net_change?: number;
};

export function DashboardFinancialCharts({
  currency,
  pnl,
  cf,
}: {
  currency: string;
  pnl: PnlSnapshot;
  cf: CashFlowSnapshot;
}) {
  const money = (n: number) => formatCurrency(n, currency);

  const cashData = [
    { name: "Inflows", value: cf.inflows ?? 0, fill: "hsl(142 45% 36%)" },
    { name: "Outflows", value: cf.outflows ?? 0, fill: "hsl(0 45% 45%)" },
    { name: "Net change", value: cf.net_change ?? 0, fill: (cf.net_change ?? 0) >= 0 ? "hsl(222 47% 31%)" : "hsl(0 45% 45%)" },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="P&L waterfall" subtitle="Month to date · accrual basis">
        <PnlWaterfallChart
          revenue={pnl.revenue ?? 0}
          cogs={pnl.cogs ?? 0}
          opex={pnl.operating_expenses ?? 0}
          netProfit={pnl.net_profit ?? 0}
          formatValue={money}
          height={220}
        />
      </ChartCard>
      <ChartCard title="Cash movement" subtitle={`${currency} · month to date`}>
        <FinanceBarChart data={cashData} formatValue={money} height={220} />
        <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3">
          <div>
            <p className="text-xs text-muted-foreground">Gross margin</p>
            <p className="text-lg font-semibold tabular-nums">{pnl.gross_margin_pct ?? 0}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Net margin</p>
            <p className="text-lg font-semibold tabular-nums">{pnl.net_margin_pct ?? 0}%</p>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}

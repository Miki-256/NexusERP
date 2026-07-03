"use client";

import { useMemo } from "react";
import { formatCurrency } from "@/lib/utils";
import {
  ChartCard,
  FinanceBarChart,
  FinanceDonutChart,
  TrendAreaChart,
} from "@/components/charts/finance-charts";
import type { SalesAnalytics } from "@/lib/sales-register";

export function SalesAnalyticsPanel({
  analytics,
  currency,
}: {
  analytics: SalesAnalytics;
  currency: string;
}) {
  const money = (n: number) => formatCurrency(n, currency);

  const dailyTrend = useMemo(
    () =>
      analytics.daily_trend.map((d) => ({
        label: new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: Number(d.revenue),
      })),
    [analytics.daily_trend]
  );

  const hourly = useMemo(
    () =>
      Array.from({ length: 24 }, (_, hour) => {
        const row = analytics.hourly.find((h) => h.hour === hour);
        return {
          name: `${hour.toString().padStart(2, "0")}:00`,
          value: row ? Number(row.revenue) : 0,
        };
      }),
    [analytics.hourly]
  );

  const topProducts = useMemo(
    () =>
      analytics.top_products.slice(0, 8).map((p) => ({
        name: p.name.length > 22 ? `${p.name.slice(0, 20)}…` : p.name,
        value: Number(p.revenue),
      })),
    [analytics.top_products]
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Avg ticket</p>
          <p className="mt-1 font-heading text-xl font-bold tabular-nums">{money(analytics.kpis.avg_ticket)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Discount rate</p>
          <p className="mt-1 font-heading text-xl font-bold tabular-nums">{analytics.kpis.discount_rate_pct}%</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Void rate</p>
          <p className="mt-1 font-heading text-xl font-bold tabular-nums">{analytics.kpis.void_rate_pct}%</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Revenue trend" subtitle="Daily completed sales">
          {dailyTrend.length > 0 ? (
            <TrendAreaChart data={dailyTrend} formatValue={money} height={220} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No data for this period.</p>
          )}
        </ChartCard>
        <ChartCard title="Hour of day" subtitle="When sales happen">
          {hourly.some((h) => h.value > 0) ? (
            <FinanceBarChart data={hourly} formatValue={money} height={220} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No hourly data.</p>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard title="By store" subtitle="Revenue share">
          {analytics.by_store.length > 0 ? (
            <FinanceDonutChart data={analytics.by_store} formatValue={money} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No store data.</p>
          )}
        </ChartCard>
        <ChartCard title="Top products" subtitle="By revenue">
          {topProducts.length > 0 ? (
            <FinanceBarChart data={topProducts} formatValue={money} height={240} layout="vertical" />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No product data.</p>
          )}
        </ChartCard>
        <ChartCard title="Top cashiers" subtitle="By revenue">
          {analytics.top_staff.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {analytics.top_staff.map((s) => (
                <li key={s.name} className="flex items-center justify-between px-3 py-2.5 text-sm">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {money(s.revenue)} · {s.count}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No staff data.</p>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

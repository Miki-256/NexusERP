"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/utils";
import {
  ChartCard,
  FinanceBarChart,
  FinanceDonutChart,
  TrendAreaChart,
} from "@/components/charts/finance-charts-lazy";
import type { SalesAnalytics } from "@/lib/sales-register";

export function SalesAnalyticsPanel({
  analytics,
  currency,
}: {
  analytics: SalesAnalytics;
  currency: string;
}) {
  const t = useTranslations("sales.analyticsPanel");
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
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">{t("avgTicket")}</p>
          <p className="mt-1 font-heading text-xl font-bold tabular-nums">{money(analytics.kpis.avg_ticket)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">{t("discountRate")}</p>
          <p className="mt-1 font-heading text-xl font-bold tabular-nums">{analytics.kpis.discount_rate_pct}%</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">{t("voidRate")}</p>
          <p className="mt-1 font-heading text-xl font-bold tabular-nums">{analytics.kpis.void_rate_pct}%</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={t("revenueTrend")} subtitle={t("dailyCompleted")}>
          {dailyTrend.length > 0 ? (
            <TrendAreaChart data={dailyTrend} formatValue={money} height={180} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("noData")}</p>
          )}
        </ChartCard>
        <ChartCard title={t("hourOfDay")} subtitle={t("whenSalesHappen")}>
          {hourly.some((h) => h.value > 0) ? (
            <FinanceBarChart data={hourly} formatValue={money} height={180} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("noHourly")}</p>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard title={t("byStore")} subtitle={t("revenueShare")}>
          {analytics.by_store.length > 0 ? (
            <FinanceDonutChart data={analytics.by_store} formatValue={money} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("noStore")}</p>
          )}
        </ChartCard>
        <ChartCard title={t("topProducts")} subtitle={t("byRevenue")}>
          {topProducts.length > 0 ? (
            <FinanceBarChart data={topProducts} formatValue={money} height={180} layout="vertical" />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("noProduct")}</p>
          )}
        </ChartCard>
        <ChartCard title={t("topCashiers")} subtitle={t("byRevenue")}>
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
            <p className="py-12 text-center text-sm text-muted-foreground">{t("noStaff")}</p>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

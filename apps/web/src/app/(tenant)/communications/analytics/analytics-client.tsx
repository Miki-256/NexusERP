"use client";

import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import {
  ChartCard,
  FinanceBarChart,
  FinanceDonutChart,
  TrendAreaChart,
} from "@/components/charts/finance-charts";
import { CommunicationsSubNav } from "../communications-sub-nav";
import type { NotificationCenterAnalytics } from "@/lib/notifications/types";
import { AlertTriangle, CheckCircle2, Send } from "lucide-react";

export function AnalyticsClient({ analytics }: { analytics: NotificationCenterAnalytics }) {
  const dailyTrend = analytics.daily.map((d) => ({
    label: d.date.slice(5),
    value: d.sent,
    secondary: d.failed,
  }));

  const channelBars = analytics.by_channel.map((c) => ({
    name: c.channel,
    value: c.sent,
  }));

  const channelDonut = analytics.by_channel.map((c) => ({
    name: c.channel,
    value: c.total,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Communications"
        title="Delivery analytics"
        description={`Last ${analytics.days} days — sent vs failed deliveries and channel mix.`}
      />
      <CommunicationsSubNav active="/communications/analytics" />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total sent"
          value={String(analytics.summary.total_sent)}
          icon={Send}
        />
        <StatCard
          label="Failed / DLQ"
          value={String(analytics.summary.total_failed)}
          icon={AlertTriangle}
        />
        <StatCard
          label="Delivery rate"
          value={`${analytics.summary.delivery_rate_pct}%`}
          icon={CheckCircle2}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Daily deliveries" subtitle="Sent (primary) vs failed">
          <TrendAreaChart
            data={dailyTrend}
            dataKey="value"
            secondaryKey="secondary"
            primaryLabel="Sent"
            secondaryLabel="Failed"
            height={260}
          />
        </ChartCard>
        <ChartCard title="Channel mix" subtitle="All deliveries in period">
          {channelDonut.length > 0 ? (
            <FinanceDonutChart data={channelDonut} height={260} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No deliveries in this period.</p>
          )}
        </ChartCard>
      </div>

      {channelBars.length > 0 && (
        <ChartCard title="Sent by channel" subtitle="Successful deliveries only">
          <FinanceBarChart data={channelBars} height={220} layout="vertical" />
        </ChartCard>
      )}
    </div>
  );
}

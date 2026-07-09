"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Clock,
  Mail,
  ScrollText,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartCard, FinanceDonutChart, TrendAreaChart } from "@/components/charts/finance-charts";
import { CommunicationsSubNav } from "./communications-sub-nav";
import type {
  NotificationCenterAnalytics,
  NotificationCenterDashboard,
} from "@/lib/notifications/types";

export function CommunicationsClient({
  stats,
  analytics,
  canManage,
}: {
  stats: NotificationCenterDashboard;
  analytics: NotificationCenterAnalytics | null;
  canManage: boolean;
}) {
  const channelDonut = (stats.channel_breakdown ?? []).map((c) => ({
    name: c.channel,
    value: c.count,
  }));

  const weekTrend = (analytics?.daily ?? []).slice(-7).map((d) => ({
    label: d.date.slice(5),
    value: d.sent,
    secondary: d.failed,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Platform"
        title="Communication & Notification Center"
        description="Email, in-app alerts, rules engine, and queued delivery. Configure channels, rules, and templates below."
      />

      <CommunicationsSubNav active="/communications" />

      {canManage ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Sent today" value={String(stats.sent_today ?? 0)} icon={Bell} />
            <StatCard label="Queued" value={String(stats.queued ?? 0)} icon={Clock} />
            <StatCard label="Failed" value={String(stats.failed ?? 0)} icon={AlertTriangle} />
            <StatCard
              label="Delivery rate"
              value={`${stats.delivery_rate_pct ?? 100}%`}
              sub={`${stats.events_pending ?? 0} events pending`}
              icon={Mail}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href="/communications/analytics">
                <BarChart3 className="h-4 w-4" />
                Full analytics
              </Link>
            </Button>
            {stats.failed > 0 && (
              <Button size="sm" variant="outline" asChild>
                <Link href="/communications/failed">
                  <AlertTriangle className="h-4 w-4" />
                  Review failed ({stats.failed})
                </Link>
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <Link href="/communications/audit">
                <ScrollText className="h-4 w-4" />
                Audit log
              </Link>
            </Button>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {weekTrend.length > 0 && (
              <ChartCard title="Last 7 days" subtitle="Sent vs failed">
                <TrendAreaChart
                  data={weekTrend}
                  dataKey="value"
                  secondaryKey="secondary"
                  primaryLabel="Sent"
                  secondaryLabel="Failed"
                  height={220}
                />
              </ChartCard>
            )}
            {channelDonut.length > 0 && (
              <ChartCard title="Today by channel" subtitle="All deliveries created today">
                <FinanceDonutChart data={channelDonut} height={220} />
              </ChartCard>
            )}
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Manager access is required to view delivery analytics. You still receive in-app notifications via the bell icon.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platform capabilities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>✓ Event queue with idempotent enqueue</p>
            <p>✓ In-app bell inbox with unread badge</p>
            <p>✓ Email, Telegram, WhatsApp channels</p>
            <p>✓ Rules engine — POS, inventory, AR, CRM, security</p>
            <p>✓ Scheduled reports — daily / weekly / monthly</p>
            <p>✓ Analytics, failed/DLQ retry, audit log</p>
            <p>✓ Module events — stock, payments, tickets, backlog</p>
            <p>✓ Hardening — rate limits, DLQ tools, audit</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick links</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button variant="outline" size="sm" className="justify-start" asChild>
              <Link href="/communications/queue">Delivery queue</Link>
            </Button>
            <Button variant="outline" size="sm" className="justify-start" asChild>
              <Link href="/communications/rules">Notification rules</Link>
            </Button>
            <Button variant="outline" size="sm" className="justify-start" asChild>
              <Link href="/communications/schedules">Scheduled reports</Link>
            </Button>
            <Button variant="outline" size="sm" className="justify-start" asChild>
              <Link href="/communications/settings">Channel settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

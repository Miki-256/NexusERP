"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { StatCard } from "@/components/layout/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { MetricBarChart } from "@/components/charts/metric-bar-chart";
import type { HrWorkforceDashboard } from "@/lib/hr/types";
import {
  Briefcase,
  CalendarOff,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

function monthStartIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function AnalyticsTab({
  organizationId,
  initialDashboard,
}: {
  organizationId: string;
  initialDashboard: HrWorkforceDashboard;
}) {
  const { toast } = useToast();
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [from, setFrom] = useState(dashboard.period.from);
  const [to, setTo] = useState(dashboard.period.to);
  const [busy, setBusy] = useState(false);

  const s = dashboard.summary;

  async function refresh() {
    if (!from || !to) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_hr_workforce_dashboard", {
      p_org_id: organizationId,
      p_from: from,
      p_to: to,
    });
    setBusy(false);
    if (error || !data) {
      toast({ title: "Could not load analytics", description: error?.message, variant: "destructive" });
      return;
    }
    setDashboard(data as HrWorkforceDashboard);
  }

  const trendData = dashboard.headcount_trend.map((t) => ({
    label: t.month,
    value: t.count,
    color: "bg-pink-500",
  }));

  const unitData = dashboard.headcount_by_org_unit.map((u) => ({
    label: u.label,
    value: u.value,
    color: "bg-violet-500",
  }));

  const leaveData = dashboard.leave_by_type.map((l) => ({
    label: l.label,
    value: l.days,
    color: "bg-amber-500",
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label>From</Label>
          <DatePicker value={from} onChange={setFrom} max={to || undefined} />
        </div>
        <div className="space-y-2">
          <Label>To</Label>
          <DatePicker value={to} onChange={setTo} min={from || undefined} />
        </div>
        <Button disabled={busy} onClick={() => void refresh()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active headcount" value={s.active_headcount} sub={`${s.on_leave} on leave`} icon={Users} />
        <StatCard
          label="New hires"
          value={s.new_hires}
          sub={`${dashboard.period.from} → ${dashboard.period.to}`}
          icon={UserPlus}
          highlight="positive"
        />
        <StatCard
          label="Departures"
          value={s.departures}
          sub={`Turnover ${s.turnover_rate_pct}%`}
          icon={UserMinus}
          highlight={s.departures > 0 ? "negative" : undefined}
        />
        <StatCard
          label="Avg tenure"
          value={`${s.avg_tenure_months} mo`}
          sub={`${s.open_requisitions} open req.`}
          icon={Briefcase}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Absence rate"
          value={`${s.absence_rate_pct}%`}
          sub={`${s.approved_leave_days} leave days`}
          icon={CalendarOff}
        />
        <StatCard
          label="Attendance coverage"
          value={`${s.attendance_coverage_pct}%`}
          sub="Employees with clock-ins"
          icon={TrendingUp}
        />
        <StatCard
          label="Pending leave"
          value={s.pending_leave_requests}
          icon={CalendarOff}
        />
        <StatCard label="Total roster" value={s.total_employees} sub={`${s.terminated_total} terminated`} icon={Users} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Headcount trend (12 months)</CardTitle>
          </CardHeader>
          <CardContent>
            {trendData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No trend data yet.</p>
            ) : (
              <MetricBarChart data={trendData} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Headcount by org unit</CardTitle>
          </CardHeader>
          <CardContent>
            {unitData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No org unit assignments yet.</p>
            ) : (
              <MetricBarChart data={unitData} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leave days by type</CardTitle>
          </CardHeader>
          <CardContent>
            {leaveData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No approved leave in this period.</p>
            ) : (
              <MetricBarChart data={leaveData} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Employment type mix</CardTitle>
          </CardHeader>
          <CardContent>
            <MetricBarChart
              data={dashboard.headcount_by_employment_type.map((e) => ({
                label: e.label,
                value: e.value,
                color: "bg-cyan-600",
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            Recent hires
          </h3>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead>Role</DataTableHead>
                <DataTableHead>Hired</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {dashboard.recent_hires.length === 0 ? (
                  <DataTableEmpty colSpan={3} message="No hires in this period." />
                ) : (
                  dashboard.recent_hires.map((h) => (
                    <DataTableRow key={h.id}>
                      <DataTableCell className="font-medium">{h.name}</DataTableCell>
                      <DataTableCell>{h.position ?? h.employment_type}</DataTableCell>
                      <DataTableCell>{h.hire_date}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </div>

        <div className="space-y-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <TrendingDown className="h-4 w-4 text-rose-600" />
            Recent departures
          </h3>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead>Role</DataTableHead>
                <DataTableHead>Left</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {dashboard.recent_departures.length === 0 ? (
                  <DataTableEmpty colSpan={3} message="No departures in this period." />
                ) : (
                  dashboard.recent_departures.map((d) => (
                    <DataTableRow key={d.id}>
                      <DataTableCell className="font-medium">{d.name}</DataTableCell>
                      <DataTableCell>{d.position ?? "—"}</DataTableCell>
                      <DataTableCell>{d.departure_date}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </div>
      </div>
    </div>
  );
}

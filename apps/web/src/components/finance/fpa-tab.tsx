"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { GitCompare, LineChart, TrendingUp } from "lucide-react";

export type FpaScenario = {
  id: string;
  name: string;
  scenario_type: string;
  is_baseline: boolean;
  revenue_adjustment_pct: number;
  expense_adjustment_pct: number;
  description?: string | null;
  is_active: boolean;
};

export type RollingForecastSummary = {
  id: string;
  name: string;
  as_of: string;
  horizon_months: number;
  status: string;
  scenario_id: string;
  scenario_name: string;
  scenario_type: string;
  total_net_profit: number;
  created_at: string;
};

export type FpaForecastPeriod = {
  period_month: string;
  is_actual: boolean;
  revenue: number;
  cogs: number;
  operating_expenses: number;
  net_profit: number;
};

export type RollingForecastDetail = {
  id: string;
  name: string;
  as_of: string;
  horizon_months: number;
  status: string;
  scenario: {
    id: string;
    name: string;
    scenario_type: string;
    revenue_adjustment_pct: number;
    expense_adjustment_pct: number;
  };
  periods: FpaForecastPeriod[];
  total_revenue: number;
  total_net_profit: number;
  forecast_revenue: number;
  forecast_net_profit: number;
};

export type FpaDashboard = {
  as_of: string;
  ytd: {
    from: string;
    to: string;
    revenue: number;
    net_profit: number;
    operating_expenses: number;
  };
  trailing_run_rate?: {
    revenue: number;
    cogs: number;
    operating_expenses: number;
    months_averaged: number;
  };
  baseline_forecast?: RollingForecastDetail | null;
  scenario_count: number;
  active_forecast_count: number;
};

export type ScenarioComparison = {
  scenario_id: string;
  scenario_name: string;
  scenario_type: string;
  revenue_adjustment_pct: number;
  expense_adjustment_pct: number;
  forecast_id?: string | null;
  forecast_name?: string | null;
  horizon_months?: number | null;
  total_revenue: number;
  total_net_profit: number;
  forecast_net_profit: number;
};

function monthLabel(d: string) {
  const dt = new Date(`${d}T12:00:00`);
  return dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function FpaTab({
  orgId,
  currency,
  canManage,
  asOf,
  scenarios: initialScenarios,
  forecasts: initialForecasts,
  dashboard: initialDashboard,
  scenarioComparison: initialComparison,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  asOf: string;
  scenarios: FpaScenario[];
  forecasts: RollingForecastSummary[];
  dashboard: FpaDashboard;
  scenarioComparison: ScenarioComparison[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);

  const [scenarios, setScenarios] = useState(initialScenarios);
  const [forecasts, setForecasts] = useState(initialForecasts);
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [comparison, setComparison] = useState(initialComparison);
  const [selectedForecastId, setSelectedForecastId] = useState(initialForecasts[0]?.id ?? "");
  const [forecastDetail, setForecastDetail] = useState<RollingForecastDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const [scenarioId, setScenarioId] = useState(initialScenarios[0]?.id ?? "");
  const [horizonMonths, setHorizonMonths] = useState("12");
  const [forecastName, setForecastName] = useState("");

  const [newScenarioName, setNewScenarioName] = useState("");
  const [newRevAdj, setNewRevAdj] = useState("0");
  const [newExpAdj, setNewExpAdj] = useState("0");

  const ytd = dashboard.ytd ?? { revenue: 0, net_profit: 0, operating_expenses: 0 };
  const runRate = dashboard.trailing_run_rate;

  const loadForecast = useCallback(async (forecastId: string) => {
    if (!forecastId) {
      setForecastDetail(null);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_rolling_forecast", { p_forecast_id: forecastId });
    if (error) {
      toast({ title: "Load forecast failed", description: error.message, variant: "destructive" });
      return;
    }
    setForecastDetail(data as RollingForecastDetail);
  }, [toast]);

  useEffect(() => {
    if (selectedForecastId) void loadForecast(selectedForecastId);
  }, [selectedForecastId, loadForecast]);

  const forecastPeriods = forecastDetail?.periods ?? [];
  const actualTotal = useMemo(
    () => forecastPeriods.filter((p) => p.is_actual).reduce((s, p) => s + Number(p.net_profit), 0),
    [forecastPeriods]
  );
  const projectedTotal = useMemo(
    () => forecastPeriods.filter((p) => !p.is_actual).reduce((s, p) => s + Number(p.net_profit), 0),
    [forecastPeriods]
  );

  async function refreshAll(selectForecastId?: string) {
    const supabase = createClient();
    const [{ data: sc }, { data: fc }, { data: dash }, { data: cmp }] = await Promise.all([
      supabase.rpc("list_fpa_scenarios", { p_org_id: orgId }),
      supabase.rpc("list_rolling_forecasts", { p_org_id: orgId, p_limit: 20 }),
      supabase.rpc("get_fpa_dashboard", { p_org_id: orgId, p_as_of: asOf }),
      supabase.rpc("compare_fpa_scenarios", { p_org_id: orgId, p_as_of: asOf }),
    ]);
    setScenarios((sc as FpaScenario[]) ?? []);
    const list = (fc as RollingForecastSummary[]) ?? [];
    setForecasts(list);
    setDashboard((dash as FpaDashboard) ?? dashboard);
    setComparison((cmp as ScenarioComparison[]) ?? []);
    const id = selectForecastId ?? selectedForecastId ?? list[0]?.id ?? "";
    if (id) {
      setSelectedForecastId(id);
      await loadForecast(id);
    }
    router.refresh();
  }

  async function generateForecast(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !scenarioId) return;
    const horizon = parseInt(horizonMonths, 10);
    if (!Number.isFinite(horizon) || horizon < 1 || horizon > 36) {
      toast({ title: "Horizon must be 1–36 months", variant: "destructive" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("generate_rolling_forecast", {
      p_org_id: orgId,
      p_scenario_id: scenarioId,
      p_horizon_months: horizon,
      p_as_of: asOf,
      p_name: forecastName.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Forecast failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Rolling forecast generated" });
    setForecastName("");
    await refreshAll(data as string);
  }

  async function addScenario(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const revAdj = parseFloat(newRevAdj);
    const expAdj = parseFloat(newExpAdj);
    if (!newScenarioName.trim()) {
      toast({ title: "Scenario name required", variant: "destructive" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_fpa_scenario", {
      p_org_id: orgId,
      p_scenario_id: null,
      p_name: newScenarioName.trim(),
      p_scenario_type: "custom",
      p_revenue_adjustment_pct: revAdj,
      p_expense_adjustment_pct: expAdj,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Scenario save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Scenario created" });
    setNewScenarioName("");
    setNewRevAdj("0");
    setNewExpAdj("0");
    await refreshAll();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="YTD revenue" value={money(Number(ytd.revenue))} sub={`Through ${asOf}`} icon={TrendingUp} />
        <StatCard label="YTD net profit" value={money(Number(ytd.net_profit))} icon={LineChart} />
        <StatCard
          label="Run-rate revenue"
          value={runRate ? money(Number(runRate.revenue)) : "—"}
          sub={runRate ? `${runRate.months_averaged}-month avg` : "Generate forecast"}
          icon={TrendingUp}
        />
        <StatCard
          label="Active forecasts"
          value={String(dashboard.active_forecast_count ?? 0)}
          sub={`${dashboard.scenario_count ?? 0} scenarios`}
          icon={GitCompare}
        />
      </div>

      <ReportSection title="Planning scenarios" subtitle="Baseline, optimistic, and pessimistic revenue/expense adjustments">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Scenario</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead align="right">Rev adj</DataTableHead>
              <DataTableHead align="right">Exp adj</DataTableHead>
              <DataTableHead>Description</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {scenarios.length === 0 ? (
                <DataTableEmpty colSpan={5} message="No scenarios — defaults seed on first load." />
              ) : (
                scenarios.map((s) => (
                  <DataTableRow key={s.id}>
                    <DataTableCell className="font-medium">
                      {s.name}
                      {s.is_baseline && <span className="ml-2 text-xs text-muted-foreground">(baseline)</span>}
                    </DataTableCell>
                    <DataTableCell>{s.scenario_type}</DataTableCell>
                    <DataTableCell align="right">{Number(s.revenue_adjustment_pct)}%</DataTableCell>
                    <DataTableCell align="right">{Number(s.expense_adjustment_pct)}%</DataTableCell>
                    <DataTableCell className="text-sm text-muted-foreground">{s.description ?? "—"}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>

        {canManage && (
          <form onSubmit={addScenario} className="mt-4 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-4">
            <div className="space-y-2 sm:col-span-2">
              <Label>Custom scenario name</Label>
              <Input value={newScenarioName} onChange={(e) => setNewScenarioName(e.target.value)} placeholder="High growth" />
            </div>
            <div className="space-y-2">
              <Label>Revenue adj %</Label>
              <Input type="number" step="0.1" value={newRevAdj} onChange={(e) => setNewRevAdj(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Expense adj %</Label>
              <Input type="number" step="0.1" value={newExpAdj} onChange={(e) => setNewExpAdj(e.target.value)} />
            </div>
            <div className="sm:col-span-4">
              <Button type="submit" size="sm" disabled={busy}>Add scenario</Button>
            </div>
          </form>
        )}
      </ReportSection>

      {canManage && (
        <ReportSection title="Generate rolling forecast" subtitle="Actuals for elapsed months; trailing run-rate with scenario adjustments for future months">
          <form onSubmit={generateForecast} className="grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Scenario</Label>
              <select className={SELECT_CLS} value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} required>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Horizon (months)</Label>
              <Input type="number" min={1} max={36} value={horizonMonths} onChange={(e) => setHorizonMonths(e.target.value)} required />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label>Forecast name (optional)</Label>
              <Input value={forecastName} onChange={(e) => setForecastName(e.target.value)} placeholder="Q3 rolling plan" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={busy}>{busy ? "Generating…" : "Generate forecast"}</Button>
            </div>
          </form>
        </ReportSection>
      )}

      <ReportSection
        title="Scenario comparison"
        subtitle="Latest active forecast per scenario (generate forecasts to populate)"
      >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Scenario</DataTableHead>
              <DataTableHead align="right">Horizon</DataTableHead>
              <DataTableHead align="right">Total net</DataTableHead>
              <DataTableHead align="right">Projected net</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {comparison.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No scenarios." />
              ) : (
                comparison.map((row) => (
                  <DataTableRow key={row.scenario_id}>
                    <DataTableCell>
                      {row.scenario_name}
                      {!row.forecast_id && (
                        <span className="ml-2 text-xs text-muted-foreground">(no forecast)</span>
                      )}
                    </DataTableCell>
                    <DataTableCell align="right">{row.horizon_months ?? "—"}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.total_net_profit))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.forecast_net_profit))}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      <ReportSection title="Rolling forecast detail" subtitle="Monthly actual vs projected buckets">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            className={SELECT_CLS}
            value={selectedForecastId}
            onChange={(e) => setSelectedForecastId(e.target.value)}
          >
            {forecasts.length === 0 && <option value="">No forecasts</option>}
            {forecasts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.scenario_name})
              </option>
            ))}
          </select>
          {forecastDetail && (
            <span className="text-xs text-muted-foreground">
              As of {forecastDetail.as_of} · {forecastDetail.horizon_months} months
            </span>
          )}
        </div>

        {forecastDetail && (
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <StatCard label="Actual net (MTD/complete)" value={money(actualTotal)} icon={LineChart} />
            <StatCard label="Projected net" value={money(projectedTotal)} icon={TrendingUp} />
            <StatCard label="Total horizon net" value={money(Number(forecastDetail.total_net_profit))} icon={GitCompare} />
          </div>
        )}

        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Month</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead align="right">Revenue</DataTableHead>
              <DataTableHead align="right">COGS</DataTableHead>
              <DataTableHead align="right">OpEx</DataTableHead>
              <DataTableHead align="right">Net</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {forecastPeriods.length === 0 ? (
                <DataTableEmpty colSpan={6} message="Select or generate a forecast." />
              ) : (
                forecastPeriods.map((p) => (
                  <DataTableRow key={p.period_month}>
                    <DataTableCell>{monthLabel(p.period_month)}</DataTableCell>
                    <DataTableCell>{p.is_actual ? "Actual" : "Forecast"}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(p.revenue))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(p.cogs))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(p.operating_expenses))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(p.net_profit))}</DataTableCell>
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

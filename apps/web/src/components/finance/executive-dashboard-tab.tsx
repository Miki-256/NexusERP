"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
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
import { ChartCard, TrendAreaChart } from "@/components/charts/finance-charts";
import { formatCurrency } from "@/lib/utils";
import { SELECT_CLS } from "@/lib/ui-classes";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Building2,
  CircleDollarSign,
  Landmark,
  LineChart,
  Receipt,
  Scale,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ExecutiveKpi = {
  key: string;
  label: string;
  value: number;
  prior_value?: number | null;
  variance_pct?: number | null;
  target_value?: number | null;
  target_variance?: number | null;
  drill_key: string;
};

export type ExecutiveTrendMonth = {
  month: string;
  label: string;
  revenue: number;
  net_profit: number;
};

export type ExecutiveKpiTarget = {
  id: string;
  kpi_key: string;
  period_from: string;
  period_to: string;
  target_value: number;
  notes?: string | null;
};

export type ExecutiveDashboardLayout = {
  id: string;
  name: string;
  widgets: { key: string; visible?: boolean }[];
};

export type ExecutiveDashboard = {
  from: string;
  to: string;
  prior_from?: string;
  prior_to?: string;
  kpis: ExecutiveKpi[];
  monthly_trends: ExecutiveTrendMonth[];
  targets?: ExecutiveKpiTarget[];
  layout?: ExecutiveDashboardLayout | null;
};

export type ExecutiveDrillRow = {
  type: string;
  reference: string;
  date: string;
  party: string;
  amount: number;
  status: string;
  link?: string;
};

export type ExecutiveDrilldown = {
  kpi_key: string;
  title: string;
  from: string;
  to: string;
  financials_tab?: string;
  rows: ExecutiveDrillRow[];
};

const KPI_KEYS = [
  "revenue",
  "gross_profit",
  "net_profit",
  "cash",
  "liquid",
  "ar",
  "ap",
  "tax_payable",
] as const;

const KPI_ICONS: Record<string, LucideIcon> = {
  revenue: TrendingUp,
  gross_profit: CircleDollarSign,
  net_profit: LineChart,
  cash: Wallet,
  liquid: Banknote,
  ar: Receipt,
  ap: Building2,
  tax_payable: Scale,
};

function varianceTrend(pct: number | null | undefined) {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  const positive = pct >= 0;
  return {
    value: `${positive ? "+" : ""}${pct.toFixed(1)}% vs prior`,
    positive,
  };
}

export function ExecutiveDashboardTab({
  orgId,
  currency,
  canManage,
  from,
  to,
  dashboard: initialDashboard,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  from: string;
  to: string;
  dashboard: ExecutiveDashboard;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);

  const [dashboard, setDashboard] = useState(initialDashboard);
  const [selectedKpi, setSelectedKpi] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<ExecutiveDrilldown | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [targetKpi, setTargetKpi] = useState<string>("revenue");
  const [targetValue, setTargetValue] = useState("");
  const [targetNotes, setTargetNotes] = useState("");

  const visibleKeys = useMemo(() => {
    const widgets = dashboard.layout?.widgets ?? [];
    if (widgets.length === 0) return new Set<string>(KPI_KEYS);
    return new Set(
      widgets.filter((w) => w.visible !== false).map((w) => w.key)
    );
  }, [dashboard.layout?.widgets]);

  const kpis = useMemo(
    () => dashboard.kpis.filter((k) => visibleKeys.has(k.key)),
    [dashboard.kpis, visibleKeys]
  );

  const trendData = useMemo(
    () =>
      (dashboard.monthly_trends ?? []).map((m) => ({
        label: m.label,
        value: Number(m.revenue),
        secondary: Number(m.net_profit),
      })),
    [dashboard.monthly_trends]
  );

  const refreshDashboard = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_executive_financial_dashboard", {
      p_org_id: orgId,
      p_from: from,
      p_to: to,
    });
    if (error) {
      toast({ title: "Refresh failed", description: error.message, variant: "destructive" });
      return;
    }
    setDashboard(data as ExecutiveDashboard);
    router.refresh();
  }, [from, orgId, router, to, toast]);

  const loadDrilldown = useCallback(
    async (kpiKey: string) => {
      setSelectedKpi(kpiKey);
      setDrillLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_executive_kpi_drilldown", {
        p_org_id: orgId,
        p_kpi_key: kpiKey,
        p_from: from,
        p_to: to,
        p_limit: 25,
      });
      setDrillLoading(false);
      if (error) {
        toast({ title: "Drill-down failed", description: error.message, variant: "destructive" });
        setDrilldown(null);
        return;
      }
      setDrilldown(data as ExecutiveDrilldown);
    },
    [from, orgId, to, toast]
  );

  async function saveTarget(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const value = parseFloat(targetValue);
    if (!Number.isFinite(value)) {
      toast({ title: "Enter a valid target amount", variant: "destructive" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_executive_kpi_target", {
      p_org_id: orgId,
      p_kpi_key: targetKpi,
      p_period_from: from,
      p_period_to: to,
      p_target_value: value,
      p_notes: targetNotes.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Target save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "KPI target saved" });
    setTargetValue("");
    setTargetNotes("");
    await refreshDashboard();
  }

  const selectedKpiMeta = kpis.find((k) => k.key === selectedKpi);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = KPI_ICONS[kpi.key] ?? Landmark;
          const targetSub =
            kpi.target_value != null
              ? `Target ${money(kpi.target_value)} · ${kpi.target_variance != null && kpi.target_variance >= 0 ? "+" : ""}${money(kpi.target_variance ?? 0)}`
              : undefined;
          const priorSub =
            kpi.prior_value != null ? `Prior ${money(kpi.prior_value)}` : undefined;
          const sub = targetSub ?? priorSub;
          const trend = varianceTrend(kpi.variance_pct);
          const highlight =
            kpi.target_variance != null
              ? kpi.target_variance >= 0
                ? "positive"
                : "negative"
              : undefined;

          return (
            <button
              key={kpi.key}
              type="button"
              onClick={() => void loadDrilldown(kpi.drill_key)}
              className={`text-left transition-shadow hover:ring-2 hover:ring-primary/20 rounded-lg ${
                selectedKpi === kpi.key ? "ring-2 ring-primary/40" : ""
              }`}
            >
              <StatCard
                label={kpi.label}
                value={money(kpi.value)}
                sub={sub}
                icon={Icon}
                trend={trend}
                highlight={highlight}
                className="h-full cursor-pointer"
              />
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <ChartCard
          title="Revenue & net profit trend"
          subtitle="Trailing six months"
          className="lg:col-span-3"
        >
          {trendData.length > 0 ? (
            <TrendAreaChart
              data={trendData}
              dataKey="value"
              secondaryKey="secondary"
              primaryLabel="Revenue"
              secondaryLabel="Net profit"
              formatValue={money}
              height={260}
            />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">No trend data for this period.</p>
          )}
        </ChartCard>

        <ReportSection
          title="Period context"
          className="lg:col-span-2"
          actions={
            drilldown?.financials_tab ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/financials?tab=${drilldown.financials_tab}&from=${from}&to=${to}`}>
                  Open in Financials
                </Link>
              </Button>
            ) : undefined
          }
        >
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Current period</dt>
              <dd className="font-medium tabular-nums">{from} → {to}</dd>
            </div>
            {dashboard.prior_from && dashboard.prior_to && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Prior period</dt>
                <dd className="font-medium tabular-nums">
                  {dashboard.prior_from} → {dashboard.prior_to}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">KPIs on scorecard</dt>
              <dd className="font-medium">{kpis.length}</dd>
            </div>
            {selectedKpiMeta && (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">Selected KPI</p>
                <p className="mt-1 font-medium">{selectedKpiMeta.label}</p>
                <p className="text-lg font-semibold tabular-nums">{money(selectedKpiMeta.value)}</p>
              </div>
            )}
          </dl>
        </ReportSection>
      </div>

      <ReportSection
        title={drilldown?.title ?? "KPI drill-down"}
        subtitle={
          selectedKpi
            ? "Click a KPI card above to explore underlying transactions and balances."
            : "Select a KPI to load detail rows."
        }
      >
        {drillLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading drill-down…</p>
        ) : (
          <DataTable>
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead>Type</DataTableHead>
                <DataTableHead>Reference</DataTableHead>
                <DataTableHead>Date</DataTableHead>
                <DataTableHead>Party</DataTableHead>
                <DataTableHead className="text-right">Amount</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead className="w-12"><span className="sr-only">Link</span></DataTableHead>
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {(drilldown?.rows ?? []).length === 0 ? (
                <DataTableEmpty colSpan={7} message="No drill-down rows for this KPI." />
              ) : (
                drilldown!.rows.map((row, i) => (
                  <DataTableRow key={`${row.reference}-${i}`}>
                    <DataTableCell className="capitalize">{row.type}</DataTableCell>
                    <DataTableCell className="font-medium">{row.reference}</DataTableCell>
                    <DataTableCell>{row.date}</DataTableCell>
                    <DataTableCell>{row.party}</DataTableCell>
                    <DataTableCell className="text-right tabular-nums">{money(row.amount)}</DataTableCell>
                    <DataTableCell>{row.status}</DataTableCell>
                    <DataTableCell className="text-right">
                      {row.link ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={row.link}>
                            {row.amount >= 0 ? (
                              <ArrowUpRight className="h-4 w-4" />
                            ) : (
                              <ArrowDownRight className="h-4 w-4" />
                            )}
                          </Link>
                        </Button>
                      ) : null}
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </DataTable>
        )}
      </ReportSection>

      {canManage && (
        <ReportSection title="KPI targets" subtitle="Set period targets for scorecard variance">
          <form onSubmit={saveTarget} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="exec-target-kpi">KPI</Label>
              <select
                id="exec-target-kpi"
                className={SELECT_CLS}
                value={targetKpi}
                onChange={(e) => setTargetKpi(e.target.value)}
              >
                {KPI_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="exec-target-value">Target amount</Label>
              <Input
                id="exec-target-value"
                type="number"
                step="0.01"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="exec-target-notes">Notes (optional)</Label>
              <Input
                id="exec-target-notes"
                value={targetNotes}
                onChange={(e) => setTargetNotes(e.target.value)}
                placeholder="Board target, budget reference…"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={busy}>
                Save target for {from} → {to}
              </Button>
            </div>
          </form>
        </ReportSection>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
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
import { ChartCard, FinanceBarChart } from "@/components/charts/finance-charts-lazy";
import { formatCurrency } from "@/lib/utils";
import type {
  AbcAnalysisRow,
  EcommerceChannelRow,
  InventoryForecastLineRow,
  ScmDashboardStats,
} from "@/lib/scm/types";
import { BarChart3, CloudUpload, RefreshCw, TrendingUp } from "lucide-react";

export function InventoryAnalyticsPanel({
  organizationId,
  storeId,
  currency,
  canManage,
}: {
  organizationId: string;
  storeId: string;
  currency: string;
  canManage: boolean;
}) {
  const t = useTranslations("inventory");
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ScmDashboardStats | null>(null);
  const [abc, setAbc] = useState<AbcAnalysisRow[]>([]);
  const [forecast, setForecast] = useState<InventoryForecastLineRow[]>([]);
  const [valuationTotal, setValuationTotal] = useState(0);
  const [channels, setChannels] = useState<EcommerceChannelRow[]>([]);
  const [channelName, setChannelName] = useState("");
  const [loaded, setLoaded] = useState(false);

  const money = (n: number) => formatCurrency(n, currency);

  async function loadAll() {
    const supabase = createClient();
    const [statsRes, abcRes, valRes, forecastRes, channelsRes] = await Promise.all([
      supabase.rpc("scm_dashboard_stats", { p_org_id: organizationId, p_store_id: storeId || null }),
      supabase.rpc("inventory_abc_analysis", { p_org_id: organizationId, p_store_id: storeId || null, p_days: 90 }),
      supabase.rpc("inventory_valuation_report", { p_org_id: organizationId, p_store_id: storeId || null }),
      supabase.rpc("list_inventory_forecast", { p_org_id: organizationId }),
      supabase.rpc("list_ecommerce_channels", { p_org_id: organizationId }),
    ]);

    if (statsRes.error) {
      toast({
        title: t("analytics.toast.unavailable"),
        description: statsRes.error.message,
        variant: "destructive",
      });
      return;
    }

    setStats((statsRes.data ?? {}) as ScmDashboardStats);
    const abcParsed = (abcRes.data ?? {}) as { items?: AbcAnalysisRow[] };
    setAbc(abcParsed.items ?? []);
    const valParsed = (valRes.data ?? {}) as { total_value?: number };
    setValuationTotal(valParsed.total_value ?? 0);
    const fcParsed = (forecastRes.data ?? {}) as { lines?: InventoryForecastLineRow[] };
    setForecast(fcParsed.lines ?? []);
    setChannels((channelsRes.data ?? []) as EcommerceChannelRow[]);
    setLoaded(true);
  }

  async function runForecast() {
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("run_inventory_forecast", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
      p_horizon_days: 30,
      p_history_days: 90,
    });
    setLoading(false);
    if (error) {
      toast({ title: t("analytics.toast.forecastFailed"), description: error.message, variant: "destructive" });
      return;
    }
    const result = (data ?? {}) as { line_count?: number };
    toast({
      title: t("analytics.toast.forecastComplete"),
      description: t("analytics.toast.forecastCompleteDesc", { count: result.line_count ?? 0 }),
    });
    void loadAll();
  }

  async function captureSnapshot() {
    if (!canManage || !storeId) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("capture_inventory_snapshot", {
      p_org_id: organizationId,
      p_store_id: storeId,
    });
    setLoading(false);
    if (error) {
      toast({ title: t("analytics.toast.snapshotFailed"), description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: t("analytics.toast.snapshotSaved"),
      description: t("analytics.toast.snapshotSavedDesc", { count: (data as number | null) ?? 0 }),
    });
  }

  async function addChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !channelName.trim()) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_ecommerce_channel", {
      p_org_id: organizationId,
      p_name: channelName.trim(),
      p_channel_type: "manual",
      p_store_id: storeId || null,
    });
    if (error) {
      toast({ title: t("analytics.toast.addChannelFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setChannelName("");
    toast({ title: t("analytics.toast.channelAdded") });
    void loadAll();
  }

  async function syncChannel(channelId: string) {
    if (!canManage) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("sync_ecommerce_inventory", { p_channel_id: channelId });
    setLoading(false);
    if (error) {
      toast({ title: t("analytics.toast.syncFailed"), description: error.message, variant: "destructive" });
      return;
    }
    const result = (data ?? {}) as { items_synced?: number; note?: string };
    toast({
      title: t("analytics.toast.exportReady"),
      description: t("analytics.toast.exportReadyDesc", {
        count: result.items_synced ?? 0,
        note: result.note ?? "",
      }),
    });
    void loadAll();
  }

  if (!loaded) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("analytics.loadPrompt")}</p>
        <Button onClick={() => void loadAll()}>
          <BarChart3 className="mr-2 h-4 w-4" />
          {t("analytics.loadAnalytics")}
        </Button>
      </div>
    );
  }

  const abcChart = abc.slice(0, 10).map((row) => ({
    name: row.product_name.length > 18 ? `${row.product_name.slice(0, 16)}…` : row.product_name,
    value: row.revenue,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void loadAll()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("analytics.refresh")}
        </Button>
        {canManage && (
          <>
            <Button variant="outline" size="sm" onClick={() => void captureSnapshot()} disabled={loading || !storeId}>
              {t("analytics.saveSnapshot")}
            </Button>
            <Button size="sm" onClick={() => void runForecast()} disabled={loading}>
              <TrendingUp className="mr-2 h-4 w-4" />
              {t("analytics.runForecast")}
            </Button>
          </>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-3">
          <StatCard
            label={t("analytics.skusOnHand")}
            value={String(stats.total_skus)}
            sub={t("analytics.units", { count: stats.total_units })}
          />
          <StatCard
            label={t("analytics.inventoryValue")}
            value={money(stats.total_value)}
            sub={t("analytics.valuation", { amount: money(valuationTotal) })}
          />
          <StatCard
            label={t("analytics.lowStock")}
            value={String(stats.low_stock_count)}
            sub={t("analytics.deadSkus", { count: stats.dead_stock_count })}
          />
          <StatCard label={t("analytics.openFulfillments")} value={String(stats.open_fulfillment_orders)} />
          <StatCard label={t("analytics.movementsToday")} value={String(stats.movements_today)} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={t("analytics.abcTitle")} subtitle={t("analytics.abcSubtitle")}>
          {abcChart.length > 0 ? (
            <FinanceBarChart data={abcChart} height={260} formatValue={(v) => money(v)} layout="vertical" />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("analytics.noAbcSales")}</p>
          )}
        </ChartCard>

        <FormCard title={t("analytics.abcClasses")}>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>{t("analytics.product")}</DataTableHead>
                <DataTableHead>{t("analytics.class")}</DataTableHead>
                <DataTableHead align="right">{t("analytics.revenue")}</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {abc.length === 0 ? (
                  <DataTableEmpty colSpan={3} message={t("analytics.noAbcData")} />
                ) : (
                  abc.slice(0, 15).map((row) => (
                    <DataTableRow key={row.variant_id}>
                      <DataTableCell className="max-w-[160px] truncate">{row.product_name}</DataTableCell>
                      <DataTableCell><StatusBadge status={`abc-${row.abc_class}`} /></DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(row.revenue)}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </FormCard>
      </div>

      <FormCard title={t("analytics.forecastTitle")}>
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>{t("analytics.product")}</DataTableHead>
              <DataTableHead>{t("analytics.class")}</DataTableHead>
              <DataTableHead align="right">{t("analytics.onHand")}</DataTableHead>
              <DataTableHead align="right">{t("analytics.avgPerDay")}</DataTableHead>
              <DataTableHead align="right">{t("analytics.forecast")}</DataTableHead>
              <DataTableHead align="right">{t("analytics.daysSupply")}</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {forecast.length === 0 ? (
                <DataTableEmpty colSpan={6} message={t("analytics.noForecast")} />
              ) : (
                forecast.slice(0, 20).map((row) => (
                  <DataTableRow key={row.id}>
                    <DataTableCell>{row.product_name}</DataTableCell>
                    <DataTableCell>{row.abc_class ?? "—"}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{row.on_hand}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{row.avg_daily_demand}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{row.forecast_qty}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{row.days_of_supply ?? "—"}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </FormCard>

      {canManage && (
        <FormCard title={t("analytics.ecommerceTitle")}>
          <p className="mb-4 text-sm text-muted-foreground">{t("analytics.ecommerceHelp")}</p>
          <form onSubmit={addChannel} className="mb-4 flex flex-wrap items-end gap-3">
            <div className="space-y-2 min-w-[200px]">
              <Label>{t("analytics.channelName")}</Label>
              <Input
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder={t("analytics.channelPlaceholder")}
              />
            </div>
            <Button type="submit" disabled={!channelName.trim()}>
              {t("analytics.addChannel")}
            </Button>
          </form>
          <div className="space-y-2">
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("analytics.noChannels")}</p>
            ) : (
              channels.map((ch) => (
                <div key={ch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div>
                    <p className="font-medium">{ch.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("analytics.channelMeta", { type: ch.channel_type, count: ch.mapping_count })}
                      {ch.last_sync_at
                        ? ` · ${t("analytics.lastSync", { when: new Date(ch.last_sync_at).toLocaleString() })}`
                        : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" disabled={loading} onClick={() => void syncChannel(ch.id)}>
                    <CloudUpload className="mr-2 h-4 w-4" />
                    {t("analytics.exportInventory")}
                  </Button>
                </div>
              ))
            )}
          </div>
        </FormCard>
      )}
    </div>
  );
}

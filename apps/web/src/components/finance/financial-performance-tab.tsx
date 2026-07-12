"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { RefreshCw, Trash2 } from "lucide-react";

export type FinancialPerformanceSettings = {
  financial_cache_enabled: boolean;
  financial_cache_ttl_minutes: number;
  financial_prefer_read_replica: boolean;
  read_replica_note?: string;
};

export type FinancialPartitionPolicy = {
  id: string;
  table_name: string;
  strategy: string;
  retention_months: number;
  is_active: boolean;
  last_maintenance_at?: string | null;
  notes?: string | null;
};

export type FinancialPerformanceDashboard = {
  settings: FinancialPerformanceSettings;
  table_counts: {
    journal_entries: number;
    journal_entry_lines: number;
    journal_entries_archived: number;
    sales: number;
    sales_archived: number;
  };
  cache: {
    entries?: number;
    total_hits?: number;
    active_entries?: number;
    expired_entries?: number;
    newest_computed_at?: string | null;
  };
  partition_policies: FinancialPartitionPolicy[];
  indexes?: { name: string; table: string; type: string }[];
  generated_at?: string;
};

function formatTs(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function FinancialPerformanceTab({
  orgId,
  canManage,
  settings: initialSettings,
  dashboard: initialDashboard,
}: {
  orgId: string;
  canManage: boolean;
  settings: FinancialPerformanceSettings;
  dashboard: FinancialPerformanceDashboard;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [settings, setSettings] = useState(initialSettings);
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const supabase = createClient();
    const [{ data: dash }, { data: sec }] = await Promise.all([
      supabase.rpc("get_financial_performance_dashboard", { p_org_id: orgId }),
      supabase.rpc("get_financial_performance_settings", { p_org_id: orgId }),
    ]);
    setDashboard((dash as FinancialPerformanceDashboard) ?? dashboard);
    setSettings((sec as FinancialPerformanceSettings) ?? settings);
    router.refresh();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_financial_performance_settings", {
      p_org_id: orgId,
      p_financial_cache_enabled: settings.financial_cache_enabled,
      p_financial_cache_ttl_minutes: settings.financial_cache_ttl_minutes,
      p_financial_prefer_read_replica: settings.financial_prefer_read_replica,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setSettings(data as FinancialPerformanceSettings);
    toast({ title: "Performance settings saved" });
    await reload();
  }

  async function warmCache() {
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("warm_financial_report_cache", { p_org_id: orgId });
    setBusy(false);
    if (error) {
      toast({ title: "Warm cache failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Cache warmed",
      description: `${(data as { warmed?: number })?.warmed ?? 0} reports refreshed`,
    });
    await reload();
  }

  async function invalidateCache() {
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("invalidate_financial_report_cache", {
      p_org_id: orgId,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Invalidate failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Cache cleared",
      description: `${typeof data === "number" ? data : 0} entries removed`,
    });
    await reload();
  }

  async function runMaintenance(dryRun: boolean) {
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("run_financial_partition_maintenance", {
      p_org_id: orgId,
      p_dry_run: dryRun,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Maintenance failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as { dry_run?: boolean; policies_processed?: number };
    toast({
      title: dryRun ? "Dry run complete" : "Maintenance complete",
      description: `${result.policies_processed ?? 0} policies processed`,
    });
    await reload();
  }

  const counts = dashboard.table_counts ?? {
    journal_entries: 0,
    journal_entry_lines: 0,
    journal_entries_archived: 0,
    sales: 0,
    sales_archived: 0,
  };
  const cache = dashboard.cache ?? {};
  const policies = dashboard.partition_policies ?? [];

  return (
    <div className="space-y-6">
      <ReportSection
        title="Report cache"
        subtitle="Speed up P&amp;L, balance sheet, trial balance, cash flow, and executive dashboards"
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => warmCache()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Warm cache
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => invalidateCache()}>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear cache
              </Button>
            </div>
          ) : null
        }
      >
        <form onSubmit={saveSettings} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.financial_cache_enabled}
              disabled={!canManage || busy}
              onChange={(e) => setSettings((s) => ({ ...s, financial_cache_enabled: e.target.checked }))}
            />
            Enable report cache
          </label>
          <div>
            <Label htmlFor="cache-ttl">Cache TTL (minutes)</Label>
            <Input
              id="cache-ttl"
              type="number"
              min={5}
              max={1440}
              disabled={!canManage || busy}
              value={settings.financial_cache_ttl_minutes}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  financial_cache_ttl_minutes: Number(e.target.value) || 60,
                }))
              }
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.financial_prefer_read_replica}
              disabled={!canManage || busy}
              onChange={(e) =>
                setSettings((s) => ({ ...s, financial_prefer_read_replica: e.target.checked }))
              }
            />
            Prefer read replica for reporting
          </label>
          {canManage && (
            <div className="md:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}>
                Save settings
              </Button>
            </div>
          )}
        </form>
        <p className="mt-3 text-sm text-muted-foreground">{settings.read_replica_note}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Cache entries</p>
            <p className="text-xl font-semibold">{cache.entries ?? 0}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Active / expired</p>
            <p className="text-xl font-semibold">
              {cache.active_entries ?? 0} / {cache.expired_entries ?? 0}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Total cache hits</p>
            <p className="text-xl font-semibold">{cache.total_hits ?? 0}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Last computed</p>
            <p className="text-sm font-medium">{formatTs(cache.newest_computed_at)}</p>
          </div>
        </div>
      </ReportSection>

      <ReportSection
        title="Data volume"
        subtitle="Live vs archived row counts"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Journal entries", counts.journal_entries],
            ["JE lines", counts.journal_entry_lines],
            ["JE archived", counts.journal_entries_archived],
            ["Sales", counts.sales],
            ["Sales archived", counts.sales_archived],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold">{Number(value).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </ReportSection>

      <ReportSection
        title="Partition policies"
        subtitle="Retention and archive strategies for high-volume tables"
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => runMaintenance(true)}>
                Dry run
              </Button>
              <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => runMaintenance(false)}>
                Run maintenance
              </Button>
            </div>
          ) : null
        }
      >
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>Table</DataTableHead>
              <DataTableHead>Strategy</DataTableHead>
              <DataTableHead>Retention</DataTableHead>
              <DataTableHead>Active</DataTableHead>
              <DataTableHead>Last run</DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {policies.length === 0 ? (
              <DataTableEmpty colSpan={5} message="No partition policies configured." />
            ) : (
              policies.map((p) => (
                <DataTableRow key={p.id}>
                  <DataTableCell>{p.table_name}</DataTableCell>
                  <DataTableCell>{p.strategy}</DataTableCell>
                  <DataTableCell>{p.retention_months} mo</DataTableCell>
                  <DataTableCell>{p.is_active ? "Yes" : "No"}</DataTableCell>
                  <DataTableCell>{formatTs(p.last_maintenance_at)}</DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </DataTable>
        <p className="mt-3 text-sm text-muted-foreground">
          Maintenance defaults to dry run. Live archive moves eligible posted journal entries with no expense
          links. Sales archive uses the Phase 3 pipeline.
        </p>
      </ReportSection>
    </div>
  );
}

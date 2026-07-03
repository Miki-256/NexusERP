"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
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
import { formatCurrency } from "@/lib/utils";
import { Lock, Unlock } from "lucide-react";

export type FiscalPeriodRow = {
  id: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  closed_at: string | null;
  closing_entry_id: string | null;
};

export function FiscalPeriodsTab({
  orgId,
  currency,
  canManage,
  fiscalYear,
  lockDate,
  periods,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  fiscalYear: number;
  lockDate: string | null;
  periods: FiscalPeriodRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState("");
  const money = (n: number) => formatCurrency(n, currency);

  const closedCount = periods.filter((p) => p.status === "closed").length;
  const latestClosed = periods.filter((p) => p.status === "closed").sort((a, b) => b.period_no - a.period_no)[0];

  async function closePeriod(id: string) {
    if (!canManage) return;
    setBusy(id + "close");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("close_fiscal_period", { p_period_id: id });
    setBusy("");
    if (error) {
      toast({ title: "Close failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as { net_transferred?: number; lock_date?: string } | null;
    toast({
      title: "Period closed",
      description: result?.net_transferred
        ? `Transferred ${money(Number(result.net_transferred))} net to retained earnings.`
        : "Period locked with no P&L activity to transfer.",
    });
    router.refresh();
  }

  async function reopenPeriod(id: string) {
    if (!canManage) return;
    setBusy(id + "reopen");
    const supabase = createClient();
    const { error } = await supabase.rpc("reopen_fiscal_period", { p_period_id: id });
    setBusy("");
    if (error) {
      toast({ title: "Reopen failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Period reopened" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Fiscal year" value={String(fiscalYear)} sub="Calendar year" icon={Lock} />
        <StatCard
          label="Closed periods"
          value={String(closedCount)}
          sub={`${periods.length - closedCount} open`}
          icon={Lock}
        />
        <StatCard
          label="Lock date"
          value={lockDate ?? "None"}
          sub="No posting on or before this date"
          icon={Unlock}
        />
      </div>

      <ReportSection
        title="Fiscal periods"
        subtitle="Closing a period transfers net income/expense to retained earnings (3900) and blocks new postings in that date range."
      >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>#</DataTableHead>
              <DataTableHead>Period</DataTableHead>
              <DataTableHead>Start</DataTableHead>
              <DataTableHead>End</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {periods.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="No fiscal periods for this year." />
              ) : (
                periods.map((p) => (
                  <DataTableRow key={p.id}>
                    <DataTableCell className="font-mono text-xs">{p.period_no}</DataTableCell>
                    <DataTableCell>{p.name}</DataTableCell>
                    <DataTableCell>{p.start_date}</DataTableCell>
                    <DataTableCell>{p.end_date}</DataTableCell>
                    <DataTableCell>
                      <StatusBadge status={p.status === "closed" ? "completed" : "draft"} />
                    </DataTableCell>
                    {canManage && (
                      <DataTableCell align="right" className="space-x-2">
                        {p.status === "open" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!busy}
                            onClick={() => closePeriod(p.id)}
                          >
                            Close period
                          </Button>
                        )}
                        {p.status === "closed" && latestClosed?.id === p.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!!busy}
                            onClick={() => reopenPeriod(p.id)}
                          >
                            Reopen
                          </Button>
                        )}
                      </DataTableCell>
                    )}
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

"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import type { LeaveBalanceRow } from "@/lib/hr/types";
import { RefreshCw } from "lucide-react";

export function LeaveBalancesTab({
  organizationId,
  canManage,
  balances,
  employeeName,
  onChanged,
}: {
  organizationId: string;
  canManage: boolean;
  balances: LeaveBalanceRow[];
  employeeName: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();

  async function syncBalances() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("sync_leave_balances_for_org", {
      p_org_id: organizationId,
    });
    if (error) {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Balances synced", description: `${data ?? 0} balance row(s) updated.` });
    onChanged();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {employeeName ? `Leave balances for ${employeeName}` : "Your leave balances"} · current year
        </p>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => void syncBalances()}>
            <RefreshCw className="h-4 w-4" />
            Sync all employees
          </Button>
        )}
      </div>

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Type</DataTableHead>
            <DataTableHead align="right">Entitled</DataTableHead>
            <DataTableHead align="right">Used</DataTableHead>
            <DataTableHead align="right">Carried</DataTableHead>
            <DataTableHead align="right">Available</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {balances.length === 0 ? (
              <DataTableEmpty colSpan={5} message="No leave balances yet." />
            ) : (
              balances.map((b) => (
                <DataTableRow key={b.leave_type_id}>
                  <DataTableCell className="font-medium">{b.name}</DataTableCell>
                  <DataTableCell align="right">{b.entitled_days}</DataTableCell>
                  <DataTableCell align="right">{b.used_days}</DataTableCell>
                  <DataTableCell align="right">{b.carried_forward_days}</DataTableCell>
                  <DataTableCell align="right" className="font-mono font-medium">
                    {b.available_days}
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>
    </div>
  );
}

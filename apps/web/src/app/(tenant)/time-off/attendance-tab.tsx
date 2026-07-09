"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
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
import { runHrMutation } from "@/lib/hr/mutations";
import type { AttendanceRecordRow, AttendanceStatus } from "@/lib/hr/types";
import { Clock, LogIn, LogOut } from "lucide-react";

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function AttendanceTab({
  organizationId,
  attendanceStatus,
  records,
  recordTotal,
  canManage,
  hasEmployeeProfile,
}: {
  organizationId: string;
  attendanceStatus: AttendanceStatus;
  records: AttendanceRecordRow[];
  recordTotal: number;
  canManage: boolean;
  hasEmployeeProfile: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function clockIn() {
    setBusy(true);
    const supabase = createClient();
    let lat: number | null = null;
    let lng: number | null = null;
    let method: "web" | "gps" = "web";

    if (navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        method = "gps";
      } catch {
        // fall back to web method
      }
    }

    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("clock_in", {
          p_org_id: organizationId,
          p_method: method,
          p_lat: lat,
          p_lng: lng,
        });
        return { error };
      },
      { successTitle: "Clocked in" }
    );
    setBusy(false);
  }

  async function clockOut() {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("clock_out", { p_org_id: organizationId, p_method: "web" });
        return { error };
      },
      { successTitle: "Clocked out" }
    );
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      {hasEmployeeProfile ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-medium">
                {attendanceStatus.is_clocked_in ? "You are clocked in" : "Not clocked in"}
              </p>
              {attendanceStatus.today_shift && (
                <p className="text-sm text-muted-foreground">
                  Today&apos;s shift: {attendanceStatus.today_shift.shift_name} (
                  {attendanceStatus.today_shift.start_time?.slice(0, 5)}–
                  {attendanceStatus.today_shift.end_time?.slice(0, 5)})
                </p>
              )}
              {attendanceStatus.open_record && (
                <p className="text-xs text-muted-foreground">
                  Since {formatTime(attendanceStatus.open_record.clock_in_at)}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {!attendanceStatus.is_clocked_in ? (
                <Button disabled={busy} onClick={() => void clockIn()}>
                  <LogIn className="h-4 w-4" />
                  Clock in
                </Button>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => void clockOut()}>
                  <LogOut className="h-4 w-4" />
                  Clock out
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Link your ERP user to an employee profile in HR to clock in/out.
        </p>
      )}

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        {canManage ? "Team attendance (last 30 days)" : "Your attendance history"}
        {recordTotal > 0 && ` · ${recordTotal} record${recordTotal === 1 ? "" : "s"}`}
      </div>

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            {canManage && <DataTableHead>Employee</DataTableHead>}
            <DataTableHead>Clock in</DataTableHead>
            <DataTableHead>Clock out</DataTableHead>
            <DataTableHead>Flags</DataTableHead>
            <DataTableHead>Status</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {records.length === 0 ? (
              <DataTableEmpty colSpan={canManage ? 5 : 4} message="No attendance records yet." />
            ) : (
              records.map((r) => (
                <DataTableRow key={r.id}>
                  {canManage && <DataTableCell className="font-medium">{r.employee_name}</DataTableCell>}
                  <DataTableCell>{formatTime(r.clock_in_at)}</DataTableCell>
                  <DataTableCell>{formatTime(r.clock_out_at)}</DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {[r.is_late && "Late", r.is_early_leave && "Early", r.overtime_minutes > 0 && `OT ${r.overtime_minutes}m`]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={r.status} />
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

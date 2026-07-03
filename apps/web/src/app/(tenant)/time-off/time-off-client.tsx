"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { FormCard } from "@/components/layout/form-card";
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
import { relationName } from "@/lib/utils";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import type { LeaveRow } from "./page";

export function TimeOffClient({
  organizationId,
  canManage,
  leaves,
  employees,
}: {
  organizationId: string;
  canManage: boolean;
  leaves: LeaveRow[];
  employees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestLeave(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId || !start || !end) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("leave_requests").insert({
      organization_id: organizationId,
      employee_id: employeeId,
      start_date: start,
      end_date: end,
      reason: reason || null,
    });
    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Leave request submitted" });
    router.refresh();
  }

  async function review(id: string, approved: boolean) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("review_leave_request", {
      p_request_id: id,
      p_status: approved ? "approved" : "rejected",
    });
    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader title="Time Off" description="Employee leave requests" />
      <FormCard title="Request leave" onSubmit={requestLeave}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Employee</Label>
            <select className={SELECT_CLS} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Start</Label>
            <DatePicker value={start} onChange={setStart} max={end || undefined} />
          </div>
          <div className="space-y-2">
            <Label>End</Label>
            <DatePicker value={end} onChange={setEnd} min={start || undefined} />
          </div>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <Button type="submit" disabled={busy}>Submit</Button>
      </FormCard>

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Employee</DataTableHead>
            <DataTableHead>Dates</DataTableHead>
            <DataTableHead>Reason</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            {canManage && <DataTableHead align="right">Review</DataTableHead>}
          </DataTableHeader>
          <DataTableBody>
            {leaves.length === 0 ? (
              <DataTableEmpty colSpan={canManage ? 5 : 4} message="No leave requests." />
            ) : (
              leaves.map((l) => (
                <DataTableRow key={l.id}>
                  <DataTableCell className="font-medium">{relationName(l.employees)}</DataTableCell>
                  <DataTableCell>{l.start_date} → {l.end_date}</DataTableCell>
                  <DataTableCell className="text-muted-foreground">{l.reason ?? "—"}</DataTableCell>
                  <DataTableCell><StatusBadge status={l.status} /></DataTableCell>
                  {canManage && (
                    <DataTableCell align="right">
                      {l.status === "pending" && (
                        <>
                          <Button size="sm" className="mr-2" disabled={busy} onClick={() => review(l.id, true)}>Approve</Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => review(l.id, false)}>Reject</Button>
                        </>
                      )}
                    </DataTableCell>
                  )}
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>
    </div>
  );
}

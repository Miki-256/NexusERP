"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { SELECT_CLS } from "@/lib/ui-classes";
import { runHrMutation } from "@/lib/hr/mutations";
import type { HolidayDateRow, ShiftAssignmentRow, WorkShiftRow } from "@/lib/hr/types";
import { Plus } from "lucide-react";

export function ShiftsTab({
  organizationId,
  canManage,
  shifts,
  assignments,
  holidays,
  employees,
  onChanged,
}: {
  organizationId: string;
  canManage: boolean;
  shifts: WorkShiftRow[];
  assignments: ShiftAssignmentRow[];
  holidays: HolidayDateRow[];
  employees: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [shiftName, setShiftName] = useState("");
  const [shiftStart, setShiftStart] = useState("09:00");
  const [shiftEnd, setShiftEnd] = useState("17:00");
  const [assignEmployee, setAssignEmployee] = useState(employees[0]?.id ?? "");
  const [selectedShiftId, setSelectedShiftId] = useState(shifts[0]?.id ?? "");
  const [assignDate, setAssignDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [busy, setBusy] = useState(false);

  async function createShift(e: React.FormEvent) {
    e.preventDefault();
    if (!shiftName.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("upsert_work_shift", {
          p_org_id: organizationId,
          p_name: shiftName.trim(),
          p_start_time: shiftStart,
          p_end_time: shiftEnd,
        });
        return { error };
      },
      { successTitle: "Shift saved" }
    );
    setBusy(false);
    if (ok) {
      setShiftName("");
      onChanged();
    }
  }

  async function handleAssignShift(e: React.FormEvent) {
    e.preventDefault();
    if (!assignEmployee || !selectedShiftId || !assignDate) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("assign_employee_shift", {
          p_org_id: organizationId,
          p_employee_id: assignEmployee,
          p_shift_id: selectedShiftId,
          p_assignment_date: assignDate,
        });
        return { error };
      },
      { successTitle: "Shift assigned" }
    );
    setBusy(false);
    if (ok) onChanged();
  }

  async function addHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!holidayName.trim() || !holidayDate) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_holiday_date", {
      p_org_id: organizationId,
      p_name: holidayName.trim(),
      p_holiday_date: holidayDate,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Holiday added" });
    setHolidayName("");
    setHolidayDate("");
    onChanged();
  }

  return (
    <div className="space-y-8">
      {canManage && (
        <FormCard title="Define shift" onSubmit={createShift}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={shiftName} onChange={(e) => setShiftName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Start</Label>
              <Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End</Label>
              <Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            <Plus className="h-4 w-4" />
            Add shift
          </Button>
        </FormCard>
      )}

      <div>
        <h3 className="mb-3 font-medium">Shift templates</h3>
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead>Hours</DataTableHead>
              <DataTableHead>Grace (min)</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {shifts.length === 0 ? (
                <DataTableEmpty colSpan={3} message="No shifts defined." />
              ) : (
                shifts.map((s) => (
                  <DataTableRow key={s.id}>
                    <DataTableCell className="font-medium">{s.name}</DataTableCell>
                    <DataTableCell>
                      {s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)}
                    </DataTableCell>
                    <DataTableCell>{s.grace_minutes_late}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </div>

      {canManage && shifts.length > 0 && (
        <FormCard title="Assign shift" onSubmit={handleAssignShift}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Employee</Label>
              <select className={SELECT_CLS} value={assignEmployee} onChange={(e) => setAssignEmployee(e.target.value)}>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Shift</Label>
              <select className={SELECT_CLS} value={selectedShiftId} onChange={(e) => setSelectedShiftId(e.target.value)}>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <DatePicker value={assignDate} onChange={setAssignDate} />
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            Assign
          </Button>
        </FormCard>
      )}

      <div>
        <h3 className="mb-3 font-medium">Upcoming assignments</h3>
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Date</DataTableHead>
              <DataTableHead>Employee</DataTableHead>
              <DataTableHead>Shift</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {assignments.length === 0 ? (
                <DataTableEmpty colSpan={3} message="No shift assignments in range." />
              ) : (
                assignments.map((a) => (
                  <DataTableRow key={a.id}>
                    <DataTableCell>{a.assignment_date}</DataTableCell>
                    <DataTableCell className="font-medium">{a.employee_name}</DataTableCell>
                    <DataTableCell>
                      {a.shift_name} ({a.start_time?.slice(0, 5)}–{a.end_time?.slice(0, 5)})
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </div>

      {canManage && (
        <div className="space-y-4">
          <h3 className="font-medium">Holiday calendar</h3>
          <FormCard title="Add holiday" onSubmit={addHoliday}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={holidayName} onChange={(e) => setHolidayName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <DatePicker value={holidayDate} onChange={setHolidayDate} />
              </div>
            </div>
            <Button type="submit" disabled={busy}>
              Add holiday
            </Button>
          </FormCard>
          <ul className="divide-y divide-border rounded-xl border border-border text-sm">
            {holidays.length === 0 ? (
              <li className="p-4 text-muted-foreground">No holidays configured.</li>
            ) : (
              holidays.map((h) => (
                <li key={h.id} className="flex justify-between px-4 py-2">
                  <span>{h.name}</span>
                  <span className="text-muted-foreground">{h.holiday_date}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { TabBar } from "@/components/layout/tab-bar";
import { FormCard } from "@/components/layout/form-card";
import { StatusBadge } from "@/components/layout/status-badge";
import { TablePagination, TableToolbar } from "@/components/layout/table-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ResponsiveTableLayout } from "@/components/layout/responsive-table-layout";
import { relationName } from "@/lib/utils";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { runHrMutation } from "@/lib/hr/mutations";
import type {
  AttendanceRecordRow,
  AttendanceStatus,
  HolidayDateRow,
  LeaveBalanceRow,
  LeaveRow,
  LeaveTypeRow,
  PayslipSummary,
  MyGoalRow,
  MyBenefitRow,
  MyOffboardingTaskRow,
  MyTrainingRow,
  PendingPolicyRow,
  PerformanceReviewRow,
  ShiftAssignmentRow,
  WorkShiftRow,
} from "@/lib/hr/types";
import { LeaveBalancesTab } from "./leave-balances-tab";
import { AttendanceTab } from "./attendance-tab";
import { ShiftsTab } from "./shifts-tab";

import { PayslipsTab } from "./payslips-tab";
import { GrowthTab } from "./growth-tab";
import { BenefitsEssTab } from "./benefits-tab";

type TimeTab = "leave" | "balances" | "attendance" | "shifts" | "payslips" | "growth" | "benefits";

export function TimeOffClient({
  organizationId,
  canManage,
  leaves,
  leaveTotal,
  page,
  pageSize,
  statusFilter,
  employees,
  myEmployeeId,
  leaveTypes,
  balances,
  attendanceStatus,
  attendanceRecords,
  attendanceTotal,
  shifts,
  shiftAssignments,
  holidays,
  payslips,
  myGoals,
  myReviews,
  myTraining,
  myBenefits,
  pendingPolicies,
  myOffboardingTasks,
  currency,
  initialTab,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  leaves: LeaveRow[];
  leaveTotal: number;
  page: number;
  pageSize: number;
  statusFilter: string | null;
  employees: { id: string; name: string }[];
  myEmployeeId: string | null;
  leaveTypes: LeaveTypeRow[];
  balances: LeaveBalanceRow[];
  attendanceStatus: AttendanceStatus;
  attendanceRecords: AttendanceRecordRow[];
  attendanceTotal: number;
  shifts: WorkShiftRow[];
  shiftAssignments: ShiftAssignmentRow[];
  holidays: HolidayDateRow[];
  payslips: PayslipSummary[];
  myGoals: MyGoalRow[];
  myReviews: PerformanceReviewRow[];
  myTraining: MyTrainingRow[];
  myBenefits: MyBenefitRow[];
  pendingPolicies: PendingPolicyRow[];
  myOffboardingTasks: MyOffboardingTaskRow[];
  initialTab: TimeTab;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [tab, setTab] = useState<TimeTab>(initialTab);
  const defaultEmployee = myEmployeeId ?? employees[0]?.id ?? "";
  const [employeeId, setEmployeeId] = useState(defaultEmployee);
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes.find((t) => t.code === "annual")?.id ?? leaveTypes[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const selfServiceOnly = !canManage && !!myEmployeeId;
  const employeeName = employees.find((e) => e.id === (myEmployeeId ?? employeeId))?.name ?? "";

  function setQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    router.push(`/time-off?${params.toString()}`);
  }

  function changeTab(next: TimeTab) {
    setTab(next);
    setQuery({ tab: next === "leave" ? null : next });
  }

  async function requestLeave(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId || !start || !end) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("submit_leave_request", {
          p_org_id: organizationId,
          p_employee_id: employeeId,
          p_start_date: start,
          p_end_date: end,
          p_reason: reason || null,
          p_leave_type_id: leaveTypeId || null,
        });
        return { error };
      },
      { successTitle: "Leave request submitted" }
    );
    setBusy(false);
    if (ok) {
      setReason("");
      setStart("");
      setEnd("");
    }
  }

  async function review(id: string, approved: boolean) {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { data: wfData, error: wfError } = await supabase.rpc("approve_workflow_step", {
          p_entity_type: "leave_request",
          p_entity_id: id,
          p_approved: approved,
        });
        if (wfError) return { error: wfError };
        const wf = wfData as { workflow?: boolean } | null;
        if (wf?.workflow) return { error: null };

        const { error } = await supabase.rpc("review_leave_request", {
          p_request_id: id,
          p_status: approved ? "approved" : "rejected",
        });
        return { error };
      },
      { successTitle: approved ? "Leave approved" : "Leave rejected" }
    );
    setBusy(false);
  }

  const totalPages = Math.max(1, Math.ceil(leaveTotal / pageSize));

  return (
    <div className={PAGE_SHELL}>
      <PageHeader title="Time & Attendance" description="Leave, balances, clock-in/out, and shifts" />

      <TabBar
        tabs={[
          { key: "leave" as const, label: "Leave" },
          { key: "balances" as const, label: "Balances" },
          { key: "attendance" as const, label: "Attendance" },
          { key: "payslips" as const, label: "Payslips" },
          { key: "growth" as const, label: "Growth" },
          { key: "benefits" as const, label: "Benefits" },
          ...(canManage ? [{ key: "shifts" as const, label: "Shifts" }] : []),
        ]}
        value={tab}
        onChange={changeTab}
      />

      <div className="mt-6">
        {tab === "leave" && (
          <div className="space-y-6">
            <FormCard title="Request leave" onSubmit={requestLeave}>
              {selfServiceOnly && (
                <p className="mb-3 text-sm text-muted-foreground">
                  Submitting leave for your linked employee profile.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  {selfServiceOnly ? (
                    <Input readOnly value={employeeName || "Your profile"} />
                  ) : (
                    <select className={SELECT_CLS} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Leave type</Label>
                  <select className={SELECT_CLS} value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
                    {leaveTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
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
              <Button type="submit" disabled={busy || !employeeId}>
                Submit
              </Button>
            </FormCard>

            <TableToolbar
              filterOpen={filterOpen}
              onFilterOpenChange={setFilterOpen}
              filterActive={!!statusFilter}
              filterContent={
                <select
                  className={SELECT_CLS + " h-9 min-w-[140px]"}
                  value={statusFilter ?? ""}
                  onChange={(e) => setQuery({ status: e.target.value || null, page: "1" })}
                >
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              }
            />

            <ResponsiveTableLayout
              mobile={
                leaves.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">No leave requests.</p>
                ) : (
                  leaves.map((l) => (
                    <MobileRecordCard key={l.id}>
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <p className="font-semibold">{relationName(l.employees)}</p>
                        <StatusBadge status={l.status} />
                      </div>
                      <div className="space-y-1.5">
                        <MobileRecordCardRow label="Dates">
                          {l.start_date} → {l.end_date}
                          {l.days_requested != null ? ` (${l.days_requested}d)` : ""}
                        </MobileRecordCardRow>
                        {l.leave_type_name && (
                          <MobileRecordCardRow label="Type">{l.leave_type_name}</MobileRecordCardRow>
                        )}
                        {l.reason && <MobileRecordCardRow label="Reason">{l.reason}</MobileRecordCardRow>}
                      </div>
                      {canManage && l.status === "pending" && (
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" className="flex-1" disabled={busy} onClick={() => review(l.id, true)}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => review(l.id, false)}>
                            Reject
                          </Button>
                        </div>
                      )}
                    </MobileRecordCard>
                  ))
                )
              }
            >
              <DataTable>
                <table className="w-full">
                  <DataTableHeader>
                    <DataTableHead>Employee</DataTableHead>
                    <DataTableHead>Type</DataTableHead>
                    <DataTableHead>Dates</DataTableHead>
                    <DataTableHead>Days</DataTableHead>
                    <DataTableHead>Reason</DataTableHead>
                    <DataTableHead>Status</DataTableHead>
                    {canManage && <DataTableHead align="right">Review</DataTableHead>}
                  </DataTableHeader>
                  <DataTableBody>
                    {leaves.length === 0 ? (
                      <DataTableEmpty colSpan={canManage ? 7 : 6} message="No leave requests." />
                    ) : (
                      leaves.map((l) => (
                        <DataTableRow key={l.id}>
                          <DataTableCell className="font-medium">{relationName(l.employees)}</DataTableCell>
                          <DataTableCell>{l.leave_type_name ?? "—"}</DataTableCell>
                          <DataTableCell>
                            {l.start_date} → {l.end_date}
                          </DataTableCell>
                          <DataTableCell>{l.days_requested ?? "—"}</DataTableCell>
                          <DataTableCell className="text-muted-foreground">{l.reason ?? "—"}</DataTableCell>
                          <DataTableCell>
                            <StatusBadge status={l.status} />
                          </DataTableCell>
                          {canManage && (
                            <DataTableCell align="right">
                              {l.status === "pending" && (
                                <>
                                  <Button size="sm" className="mr-2" disabled={busy} onClick={() => review(l.id, true)}>
                                    Approve
                                  </Button>
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => review(l.id, false)}>
                                    Reject
                                  </Button>
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
            </ResponsiveTableLayout>

            <TablePagination
              page={page}
              totalPages={totalPages}
              total={leaveTotal}
              onPageChange={(p) => setQuery({ page: String(p) })}
            />
          </div>
        )}

        {tab === "balances" && (
          <LeaveBalancesTab
            organizationId={organizationId}
            canManage={canManage}
            balances={balances}
            employeeName={employeeName}
            onChanged={() => router.refresh()}
          />
        )}

        {tab === "attendance" && (
          <AttendanceTab
            organizationId={organizationId}
            attendanceStatus={attendanceStatus}
            records={attendanceRecords}
            recordTotal={attendanceTotal}
            canManage={canManage}
            hasEmployeeProfile={attendanceStatus.has_employee}
          />
        )}

        {tab === "shifts" && canManage && (
          <ShiftsTab
            organizationId={organizationId}
            canManage={canManage}
            shifts={shifts}
            assignments={shiftAssignments}
            holidays={holidays}
            employees={employees}
            onChanged={() => router.refresh()}
          />
        )}

        {tab === "payslips" && <PayslipsTab payslips={payslips} currency={currency} />}

        {tab === "growth" && (
          <GrowthTab
            organizationId={organizationId}
            goals={myGoals}
            reviews={myReviews}
            training={myTraining}
            offboardingTasks={myOffboardingTasks}
          />
        )}

        {tab === "benefits" && (
          <BenefitsEssTab
            organizationId={organizationId}
            currency={currency}
            benefits={myBenefits}
            pendingPolicies={pendingPolicies}
          />
        )}
      </div>
    </div>
  );
}

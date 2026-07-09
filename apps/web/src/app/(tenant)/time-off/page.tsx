import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { HR_PAGE_SIZE } from "@/lib/hr/constants";
import { parsePaginatedRpc } from "@/lib/hr/mutations";
import type {
  AttendanceRecordRow,
  AttendanceStatus,
  HolidayDateRow,
  LeaveBalanceRow,
  LeaveRow,
  LeaveTypeRow,
  MyGoalRow,
  MyBenefitRow,
  MyOffboardingTaskRow,
  MyTrainingRow,
  PayslipSummary,
  PendingPolicyRow,
  PerformanceReviewRow,
  ShiftAssignmentRow,
  WorkShiftRow,
} from "@/lib/hr/types";
import { TimeOffClient } from "./time-off-client";

export type { LeaveRow };

export default async function TimeOffPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireAppAccess("timeoff");
  const canManage = ctx.canManageApp("timeoff");

  const supabase = await createClient();
  const orgId = ctx.organization.id;
  const page = Math.max(1, Number(params.page) || 1);
  const status =
    params.status === "pending" || params.status === "approved" || params.status === "rejected"
      ? params.status
      : null;

  const [
    { data: leavePage },
    { data: employeeList },
    { data: myEmployeeId },
    { data: leaveTypes },
    { data: balances },
    { data: attendanceStatus },
    { data: attendancePage },
    { data: shifts },
    { data: assignments },
    { data: holidays },
    { data: myPayslips },
    { data: myGoals },
    { data: myReviews },
    { data: myTraining },
    { data: myBenefits },
    { data: pendingPolicies },
    { data: myOffboardingTasks },
  ] = await Promise.all([
    supabase.rpc("list_leave_requests", {
      p_org_id: orgId,
      p_status: status,
      p_limit: HR_PAGE_SIZE,
      p_offset: (page - 1) * HR_PAGE_SIZE,
    }),
    supabase.rpc("list_timeoff_employees", { p_org_id: orgId }),
    supabase.rpc("my_employee_id", { p_org_id: orgId }),
    supabase.rpc("list_leave_types", { p_org_id: orgId }),
    supabase.rpc("get_employee_leave_balances", {
      p_org_id: orgId,
      p_employee_id: null,
    }),
    supabase.rpc("get_my_attendance_status", { p_org_id: orgId }),
    supabase.rpc("list_attendance_records", {
      p_org_id: orgId,
      p_limit: HR_PAGE_SIZE,
      p_offset: 0,
    }),
    supabase.rpc("list_work_shifts", { p_org_id: orgId }),
    supabase.rpc("list_shift_assignments", { p_org_id: orgId }),
    canManage ? supabase.rpc("list_holiday_dates", { p_org_id: orgId }) : Promise.resolve({ data: [] }),
    supabase.rpc("list_my_payslips", { p_org_id: orgId, p_limit: 24 }),
    supabase.rpc("list_my_goals", { p_org_id: orgId }),
    supabase.rpc("list_my_performance_reviews", { p_org_id: orgId }),
    supabase.rpc("list_my_training", { p_org_id: orgId }),
    supabase.rpc("list_my_benefits", { p_org_id: orgId }),
    supabase.rpc("list_pending_policies", { p_org_id: orgId }),
    supabase.rpc("list_my_offboarding_tasks", { p_org_id: orgId }),
  ]);

  const parsed = parsePaginatedRpc<LeaveRow>(leavePage);
  const employees = (employeeList as { id: string; name: string }[] | null) ?? [];
  const myEmpId = (myEmployeeId as string | null) ?? null;
  const attendanceParsed = parsePaginatedRpc<AttendanceRecordRow>(attendancePage);

  return (
    <TimeOffClient
      organizationId={orgId}
      currency={ctx.organization.currency}
      canManage={canManage}
      leaves={parsed.items}
      leaveTotal={parsed.total_count}
      page={page}
      pageSize={HR_PAGE_SIZE}
      statusFilter={status}
      employees={employees}
      myEmployeeId={myEmpId}
      leaveTypes={(leaveTypes as LeaveTypeRow[]) ?? []}
      balances={(balances as LeaveBalanceRow[]) ?? []}
      attendanceStatus={(attendanceStatus as AttendanceStatus) ?? { has_employee: false }}
      attendanceRecords={attendanceParsed.items}
      attendanceTotal={attendanceParsed.total_count}
      shifts={(shifts as WorkShiftRow[]) ?? []}
      shiftAssignments={(assignments as ShiftAssignmentRow[]) ?? []}
      holidays={(holidays as HolidayDateRow[]) ?? []}
      payslips={(myPayslips as PayslipSummary[]) ?? []}
      myGoals={(myGoals as MyGoalRow[]) ?? []}
      myReviews={(myReviews as PerformanceReviewRow[]) ?? []}
      myTraining={(myTraining as MyTrainingRow[]) ?? []}
      myBenefits={(myBenefits as MyBenefitRow[]) ?? []}
      pendingPolicies={(pendingPolicies as PendingPolicyRow[]) ?? []}
      myOffboardingTasks={(myOffboardingTasks as MyOffboardingTaskRow[]) ?? []}
      initialTab={
        params.tab === "balances" ||
        params.tab === "attendance" ||
        params.tab === "shifts" ||
        params.tab === "payslips" ||
        params.tab === "growth" ||
        params.tab === "benefits"
          ? params.tab
          : "leave"
      }
    />
  );
}

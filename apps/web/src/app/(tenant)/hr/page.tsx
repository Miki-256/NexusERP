import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { HR_PAGE_SIZE } from "@/lib/hr/constants";
import { parsePaginatedRpc } from "@/lib/hr/mutations";
import type {
  BenefitEnrollmentRow,
  BenefitPlanRow,
  ComplianceExpiryRow,
  EmployeeTrainingRow,
  HrEmployeeRow,
  HrPolicyRow,
  HrWorkforceDashboard,
  HrPayrollGlMappingRow,
  HrWebhookDeliveryRow,
  HrWebhookEndpointRow,
  OffboardingTaskRow,
  PayComponentRow,
  PerformanceGoalRow,
  ProbationReviewRow,
  ContractRenewalRow,
  EmploymentContractRow,
  PerformanceReviewRow,
  PayrollRunRow,
  PolicyAckRow,
  ReviewCycleRow,
  SkillRow,
  TrainingCourseRow,
} from "@/lib/hr/types";
import { HrClient } from "./hr-client";

export type Employee = HrEmployeeRow;
export type PayrollRun = PayrollRunRow;

export default async function HrPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireAppAccess("hr");
  const manage = ctx.canManageApp("hr");
  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const page = Math.max(1, Number(params.page) || 1);
  const search = params.q?.trim() || null;
  const status =
    params.status === "active" || params.status === "on_leave" || params.status === "terminated"
      ? params.status
      : null;

  const monthStart = new Date();
  monthStart.setDate(1);
  const periodFrom = monthStart.toISOString().slice(0, 10);
  const periodTo = new Date().toISOString().slice(0, 10);

  const [{ data: employeePage }, { data: payrollEmployeePage }, { data: stores }, { data: runs }, perfData, benefitsData, { data: workforceDashboard }, lifecycleData, integrationData] =
    await Promise.all([
    supabase.rpc("list_hr_employees", {
      p_org_id: orgId,
      p_search: search,
      p_status: status,
      p_limit: HR_PAGE_SIZE,
      p_offset: (page - 1) * HR_PAGE_SIZE,
    }),
    manage
      ? supabase.rpc("list_hr_employees", {
          p_org_id: orgId,
          p_search: null,
          p_status: "active",
          p_limit: 500,
          p_offset: 0,
        })
      : Promise.resolve({ data: null }),
    supabase.from("stores").select("id, name").eq("organization_id", orgId).order("name"),
    manage
      ? supabase
          .from("payroll_runs")
          .select(
            "id, period_start, period_end, status, total_gross, total_tax, total_deductions, total_net, created_at"
          )
          .eq("organization_id", orgId)
          .order("period_end", { ascending: false })
          .limit(24)
      : Promise.resolve({ data: [] as PayrollRun[] }),
    manage
      ? Promise.all([
          supabase.rpc("list_review_cycles", { p_org_id: orgId }),
          supabase.rpc("list_performance_goals", { p_org_id: orgId, p_limit: HR_PAGE_SIZE, p_offset: 0 }),
          supabase.rpc("list_performance_reviews", { p_org_id: orgId, p_limit: HR_PAGE_SIZE, p_offset: 0 }),
          supabase.rpc("list_skills", { p_org_id: orgId }),
          supabase.rpc("list_training_courses", { p_org_id: orgId }),
          supabase.rpc("list_employee_training", { p_org_id: orgId, p_limit: HR_PAGE_SIZE, p_offset: 0 }),
        ])
      : Promise.resolve(null),
    manage
      ? Promise.all([
          supabase.rpc("list_benefit_plans", { p_org_id: orgId }),
          supabase.rpc("list_benefit_enrollments", { p_org_id: orgId, p_limit: HR_PAGE_SIZE, p_offset: 0 }),
          supabase.rpc("list_hr_policies", { p_org_id: orgId }),
          supabase.rpc("list_policy_acknowledgements", { p_org_id: orgId, p_limit: HR_PAGE_SIZE, p_offset: 0 }),
          supabase.rpc("list_expiring_compliance_items", { p_org_id: orgId, p_days_ahead: 30 }),
        ])
      : Promise.resolve(null),
    manage
      ? supabase.rpc("get_hr_workforce_dashboard", {
          p_org_id: orgId,
          p_from: periodFrom,
          p_to: periodTo,
        })
      : Promise.resolve({ data: null }),
    manage
      ? Promise.all([
          supabase.rpc("list_offboarding_tasks", { p_org_id: orgId, p_limit: HR_PAGE_SIZE, p_offset: 0 }),
          supabase.rpc("list_probation_reviews", { p_org_id: orgId, p_limit: HR_PAGE_SIZE, p_offset: 0 }),
          supabase.rpc("list_employment_contracts", { p_org_id: orgId, p_limit: HR_PAGE_SIZE, p_offset: 0 }),
          supabase.rpc("list_contracts_due_for_renewal", { p_org_id: orgId, p_days_ahead: 30 }),
        ])
      : Promise.resolve(null),
    manage
      ? Promise.all([
          supabase.rpc("list_hr_payroll_gl_mappings", { p_org_id: orgId }),
          supabase.rpc("list_pay_components", { p_org_id: orgId }),
          supabase.rpc("list_hr_webhook_endpoints", { p_org_id: orgId }),
          supabase.rpc("list_hr_webhook_deliveries", { p_org_id: orgId, p_limit: 30, p_offset: 0 }),
        ])
      : Promise.resolve(null),
  ]);

  const parsed = parsePaginatedRpc<HrEmployeeRow>(employeePage);
  const payrollEmployees = manage
    ? parsePaginatedRpc<HrEmployeeRow>(payrollEmployeePage).items
    : [];

  const orgDirectory = parsePaginatedRpc<{ id: string; name: string }>(
    manage
      ? payrollEmployeePage
      : employeePage
  ).items.map((e) => ({ id: e.id, name: e.name }));

  const perfParsed = perfData
    ? {
        cycles: (perfData[0].data as ReviewCycleRow[]) ?? [],
        goals: parsePaginatedRpc<PerformanceGoalRow>(perfData[1].data),
        reviews: parsePaginatedRpc<PerformanceReviewRow>(perfData[2].data),
        skills: (perfData[3].data as SkillRow[]) ?? [],
        courses: (perfData[4].data as TrainingCourseRow[]) ?? [],
        training: parsePaginatedRpc<EmployeeTrainingRow>(perfData[5].data),
      }
    : {
        cycles: [] as ReviewCycleRow[],
        goals: { items: [] as PerformanceGoalRow[], total_count: 0 },
        reviews: { items: [] as PerformanceReviewRow[], total_count: 0 },
        skills: [] as SkillRow[],
        courses: [] as TrainingCourseRow[],
        training: { items: [] as EmployeeTrainingRow[], total_count: 0 },
      };

  const benefitsParsed = benefitsData
    ? {
        plans: (benefitsData[0].data as BenefitPlanRow[]) ?? [],
        enrollments: parsePaginatedRpc<BenefitEnrollmentRow>(benefitsData[1].data),
        policies: (benefitsData[2].data as HrPolicyRow[]) ?? [],
        acknowledgements: parsePaginatedRpc<PolicyAckRow>(benefitsData[3].data),
        expiring: (benefitsData[4].data as ComplianceExpiryRow[]) ?? [],
      }
    : {
        plans: [] as BenefitPlanRow[],
        enrollments: { items: [] as BenefitEnrollmentRow[], total_count: 0 },
        policies: [] as HrPolicyRow[],
        acknowledgements: { items: [] as PolicyAckRow[], total_count: 0 },
        expiring: [] as ComplianceExpiryRow[],
      };

  const lifecycleParsed = lifecycleData
    ? {
        offboarding: parsePaginatedRpc<OffboardingTaskRow>(lifecycleData[0].data),
        probation: parsePaginatedRpc<ProbationReviewRow>(lifecycleData[1].data),
        contracts: parsePaginatedRpc<EmploymentContractRow>(lifecycleData[2].data),
        due: (lifecycleData[3].data as ContractRenewalRow[]) ?? [],
      }
    : {
        offboarding: { items: [] as OffboardingTaskRow[], total_count: 0 },
        probation: { items: [] as ProbationReviewRow[], total_count: 0 },
        contracts: { items: [] as EmploymentContractRow[], total_count: 0 },
        due: [] as ContractRenewalRow[],
      };

  const integrationParsed = integrationData
    ? {
        glMappings: (integrationData[0].data as HrPayrollGlMappingRow[]) ?? [],
        payComponents: (integrationData[1].data as PayComponentRow[]) ?? [],
        webhookEndpoints: (integrationData[2].data as HrWebhookEndpointRow[]) ?? [],
        webhookDeliveries: parsePaginatedRpc<HrWebhookDeliveryRow>(integrationData[3].data).items,
        webhookDeliveryTotal: parsePaginatedRpc<HrWebhookDeliveryRow>(integrationData[3].data)
          .total_count,
      }
    : {
        glMappings: [] as HrPayrollGlMappingRow[],
        payComponents: [] as PayComponentRow[],
        webhookEndpoints: [] as HrWebhookEndpointRow[],
        webhookDeliveries: [] as HrWebhookDeliveryRow[],
        webhookDeliveryTotal: 0,
      };

  let teamMembers: { user_id: string; email: string; display_name: string }[] = [];
  if (manage) {
    const { data } = await supabase.rpc("get_organization_team_members", { p_org_id: orgId });
    teamMembers = (data ?? []) as { user_id: string; email: string; display_name: string }[];
  }

  return (
    <HrClient
      organizationId={orgId}
      currency={ctx.organization.currency}
      canManage={manage}
      employees={parsed.items}
      employeeTotal={parsed.total_count}
      payrollEmployees={payrollEmployees}
      page={page}
      pageSize={HR_PAGE_SIZE}
      search={search ?? ""}
      statusFilter={status}
      stores={(stores as { id: string; name: string }[]) ?? []}
      runs={(runs as PayrollRun[]) ?? []}
      teamMembers={teamMembers}
      orgDirectory={orgDirectory}
      reviewCycles={perfParsed.cycles}
      performanceGoals={perfParsed.goals.items}
      performanceGoalTotal={perfParsed.goals.total_count}
      performanceReviews={perfParsed.reviews.items}
      performanceReviewTotal={perfParsed.reviews.total_count}
      skills={perfParsed.skills}
      trainingCourses={perfParsed.courses}
      employeeTraining={perfParsed.training.items}
      employeeTrainingTotal={perfParsed.training.total_count}
      benefitPlans={benefitsParsed.plans}
      benefitEnrollments={benefitsParsed.enrollments.items}
      benefitEnrollmentTotal={benefitsParsed.enrollments.total_count}
      hrPolicies={benefitsParsed.policies}
      policyAcknowledgements={benefitsParsed.acknowledgements.items}
      expiringCompliance={benefitsParsed.expiring}
      workforceDashboard={(workforceDashboard as HrWorkforceDashboard | null) ?? null}
      offboardingTasks={lifecycleParsed.offboarding.items}
      offboardingTotal={lifecycleParsed.offboarding.total_count}
      probationReviews={lifecycleParsed.probation.items}
      probationTotal={lifecycleParsed.probation.total_count}
      employmentContracts={lifecycleParsed.contracts.items}
      contractTotal={lifecycleParsed.contracts.total_count}
      contractsDue={lifecycleParsed.due}
      glMappings={integrationParsed.glMappings}
      payComponents={integrationParsed.payComponents}
      webhookEndpoints={integrationParsed.webhookEndpoints}
      webhookDeliveries={integrationParsed.webhookDeliveries}
      webhookDeliveryTotal={integrationParsed.webhookDeliveryTotal}
    />
  );
}

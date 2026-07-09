export type EmployeeStatus = "active" | "on_leave" | "terminated";
export type EmploymentType = "full_time" | "part_time" | "contract";
export type PayMethod = "cash" | "mobile_money" | "bank_transfer";

export type HrEmployeeRow = {
  id: string;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  employment_type: EmploymentType;
  base_salary: number | null;
  payment_method: PayMethod;
  hire_date: string;
  status: EmployeeStatus;
  store_id: string | null;
  user_id: string | null;
  employee_number?: string | null;
  org_unit_id?: string | null;
  org_unit_name?: string | null;
  manager_employee_id?: string | null;
  hr_position_id?: string | null;
  created_at?: string;
};

export type OrgUnitType =
  | "company"
  | "business_unit"
  | "division"
  | "region"
  | "branch"
  | "department"
  | "team";

export type OrgUnitRow = {
  id: string;
  parent_id: string | null;
  unit_type: OrgUnitType;
  code: string;
  name: string;
  description: string | null;
  manager_employee_id: string | null;
  analytic_department_id: string | null;
  is_active: boolean;
  sort_order: number;
  headcount: number;
};

export type OrgChartNode = {
  id: string;
  parent_id: string | null;
  unit_type: OrgUnitType;
  code: string;
  name: string;
  depth: number;
  headcount: number;
};

export type EmployeeDependent = {
  id?: string;
  full_name: string;
  relationship: string | null;
  date_of_birth: string | null;
};

export type EmployeeDocument = {
  id: string;
  document_type: string;
  name: string;
  url: string | null;
  mime_type: string | null;
  expires_at: string | null;
  created_at?: string;
};

export type EmployeeProfile = {
  date_of_birth?: string | null;
  gender?: string | null;
  marital_status?: string | null;
  nationality?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_region?: string | null;
  postal_code?: string | null;
  country?: string | null;
  national_id?: string | null;
  passport_number?: string | null;
  passport_expiry?: string | null;
  visa_number?: string | null;
  visa_expiry?: string | null;
  driving_license?: string | null;
  driving_license_expiry?: string | null;
  work_email?: string | null;
  work_phone?: string | null;
  termination_date?: string | null;
  probation_end_date?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relation?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_branch?: string | null;
  medical_notes?: string | null;
};

export type Employee360 = {
  employee: {
    id: string;
    organization_id: string;
    name: string;
    position: string | null;
    email: string | null;
    phone: string | null;
    employment_type: EmploymentType;
    base_salary: number | null;
    payment_method: PayMethod;
    hire_date: string;
    status: EmployeeStatus;
    store_id: string | null;
    user_id: string | null;
    employee_number: string | null;
    org_unit_id: string | null;
    hr_position_id: string | null;
    manager_employee_id: string | null;
    notes: string | null;
  };
  profile: EmployeeProfile;
  dependents: EmployeeDependent[];
  documents: EmployeeDocument[];
  leave_history: { id: string; start_date: string; end_date: string; status: string; reason: string | null }[];
  org_unit: { id: string; name: string; code: string } | null;
  hr_position: { id: string; title: string; code: string } | null;
  manager: { id: string; name: string } | null;
  can_manage: boolean;
};

export type LeaveWorkflowStatus = {
  has_workflow: boolean;
  status?: string;
  current_step?: number;
  total_steps?: number;
  steps?: { order: number; approver: string }[];
};

export type JobRequisitionStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "posted"
  | "cancelled";

export type JobRequisitionRow = {
  id: string;
  title: string;
  department: string | null;
  org_unit_id: string | null;
  org_unit_name?: string | null;
  headcount: number;
  employment_type: EmploymentType;
  justification: string | null;
  status: JobRequisitionStatus;
  job_position_id: string | null;
  created_at?: string;
};

export type ApplicantInterview = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  location_or_link: string | null;
  notes: string | null;
  scorecard: Record<string, unknown>;
  interviewer_name?: string | null;
};

export type JobOfferRow = {
  id: string;
  salary: number;
  start_date: string;
  employment_type: EmploymentType;
  status: string;
  offer_letter_url: string | null;
  notes: string | null;
  sent_at: string | null;
  created_at?: string;
};

export type ApplicantPipeline = {
  applicant: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    status: string;
    resume_url: string | null;
    source: string | null;
    hired_employee_id: string | null;
    created_at?: string;
  };
  job: { id: string; title: string; department: string | null } | null;
  interviews: ApplicantInterview[];
  offers: JobOfferRow[];
  can_manage: boolean;
};

export type OnboardingTaskRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  title: string;
  category: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  sort_order: number;
};

export type PaginatedResult<T> = {
  items: T[];
  total_count: number;
};

export type LeaveRow = {
  id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  days_requested?: number | null;
  leave_type_name?: string | null;
  created_at?: string;
  requested_by?: string | null;
  employees: { name: string } | { name: string }[] | null;
};

export type LeaveTypeRow = {
  id: string;
  code: string;
  name: string;
  is_paid: boolean;
  annual_entitlement_days: number;
  accrual_rate?: number;
  max_carry_forward_days?: number;
};

export type LeaveBalanceRow = {
  leave_type_id: string;
  code: string;
  name: string;
  is_paid: boolean;
  entitled_days: number;
  used_days: number;
  carried_forward_days: number;
  available_days: number;
};

export type AttendanceRecordRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_method: string;
  status: string;
  is_late: boolean;
  is_early_leave: boolean;
  overtime_minutes: number;
};

export type AttendanceStatus = {
  has_employee: boolean;
  employee_id?: string;
  is_clocked_in?: boolean;
  open_record?: { id: string; clock_in_at: string; clock_in_method: string } | null;
  today_shift?: { shift_name: string; start_time: string; end_time: string } | null;
};

export type WorkShiftRow = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_minutes_late: number;
};

export type ShiftAssignmentRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  assignment_date: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  notes: string | null;
};

export type HolidayDateRow = {
  id: string;
  name: string;
  holiday_date: string;
  is_recurring: boolean;
};

export type JobRow = {
  id: string;
  title: string;
  department: string | null;
  is_open: boolean;
  created_at?: string;
};

export type ApplicantRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  created_at?: string;
  job_positions: { title: string } | { title: string }[] | null;
};

export type PayrollRunRow = {
  id: string;
  period_start: string;
  period_end: string;
  status: "draft" | "pending_approval" | "approved" | "posted" | "cancelled";
  total_gross: number;
  total_tax: number;
  total_deductions: number;
  total_net: number;
  created_at: string;
  approved_at?: string | null;
  posted_at?: string | null;
};

export type PayComponentRow = {
  id: string;
  code: string;
  name: string;
  component_type: "earning" | "deduction" | "tax" | "employer_contribution";
  calc_type: "fixed" | "percent_gross" | "percent_base";
  default_amount: number;
  default_rate: number;
  is_taxable?: boolean;
  gl_account_code?: string | null;
};

export type PayrollPreviewLine = {
  employee_id: string;
  employee_name: string;
  gross: number;
  allowances: number;
  deductions: number;
  tax: number;
  net: number;
};

export type PayslipSummary = {
  id: string;
  run_id: string;
  period_start: string;
  period_end: string;
  run_status: string;
  gross: number;
  allowances: number;
  deductions: number;
  tax: number;
  net: number;
  created_at?: string;
};

export type PayrollRunDetail = {
  run: PayrollRunRow & { payment_method?: string; notes?: string | null };
  payslips: {
    id: string;
    employee_id: string;
    employee_name: string;
    gross: number;
    allowances: number;
    deductions: number;
    tax: number;
    net: number;
    lines: { component_name: string; component_type: string; amount: number }[];
  }[];
  can_manage: boolean;
};

export type SkillRow = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description?: string | null;
};

export type EmployeeSkillRow = {
  id: string;
  skill_id: string;
  skill_code: string;
  skill_name: string;
  category: string | null;
  proficiency: "beginner" | "intermediate" | "advanced" | "expert";
  years_experience: number | null;
  notes: string | null;
  assessed_at: string | null;
};

export type PerformanceGoalRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  cycle_id: string | null;
  title: string;
  description: string | null;
  target_date: string | null;
  weight: number;
  progress_pct: number;
  status: "draft" | "active" | "completed" | "cancelled";
  created_at?: string;
};

export type ReviewCycleRow = {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  status: "draft" | "active" | "closed";
  review_count: number;
  created_at?: string;
};

export type PerformanceReviewRow = {
  id: string;
  cycle_id: string;
  cycle_name: string;
  employee_id: string;
  employee_name: string;
  reviewer_employee_id: string | null;
  reviewer_name: string | null;
  status: string;
  overall_rating: number | null;
  submitted_at: string | null;
  approved_at: string | null;
  period_start?: string;
  period_end?: string;
};

export type ReviewRatingRow = {
  criteria_code: string;
  criteria_name: string;
  self_rating: number | null;
  manager_rating: number | null;
  comments: string | null;
  sort_order: number;
};

export type PerformanceReviewDetail = {
  review: {
    id: string;
    cycle_id: string;
    employee_id: string;
    reviewer_employee_id: string | null;
    status: string;
    overall_rating: number | null;
    self_comments: string | null;
    manager_comments: string | null;
    submitted_at: string | null;
    approved_at: string | null;
  };
  ratings: ReviewRatingRow[];
  can_manage: boolean;
  is_self: boolean;
  is_manager: boolean;
};

export type TrainingCourseRow = {
  id: string;
  code: string;
  name: string;
  provider: string | null;
  duration_hours: number | null;
  description?: string | null;
  is_mandatory: boolean;
};

export type EmployeeTrainingRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  course_id: string;
  course_code: string;
  course_name: string;
  status: "planned" | "in_progress" | "completed" | "cancelled";
  started_at: string | null;
  completed_at: string | null;
  score: number | null;
  certificate_url?: string | null;
};

export type MyGoalRow = {
  id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  weight: number;
  progress_pct: number;
  status: string;
  created_at?: string;
};

export type MyTrainingRow = {
  id: string;
  course_name: string;
  course_code: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  score: number | null;
  is_mandatory: boolean;
};

export type BenefitPlanRow = {
  id: string;
  code: string;
  name: string;
  plan_type: string;
  description: string | null;
  employer_contribution_pct: number;
  employee_cost_monthly: number;
};

export type BenefitEnrollmentRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  plan_type: string;
  status: string;
  coverage_level: string | null;
  effective_date: string;
  end_date: string | null;
  notes: string | null;
};

export type MyBenefitRow = {
  id: string;
  plan_name: string;
  plan_type: string;
  status: string;
  coverage_level: string | null;
  effective_date: string;
  end_date: string | null;
  employee_cost_monthly: number;
};

export type HrPolicyRow = {
  id: string;
  code: string;
  name: string;
  version: number;
  summary: string | null;
  content_url: string | null;
  requires_acknowledgement: boolean;
  effective_date: string;
};

export type PendingPolicyRow = {
  id: string;
  code: string;
  name: string;
  version: number;
  summary: string | null;
  content_url: string | null;
  effective_date: string;
};

export type PolicyAckRow = {
  id: string;
  policy_id: string;
  policy_name: string;
  policy_version: number;
  employee_id: string;
  employee_name: string;
  acknowledged_at: string;
};

export type ComplianceExpiryRow = {
  entity_id: string;
  entity_type: string;
  employee_id: string;
  employee_name: string;
  item_name: string;
  item_category: string;
  expires_on: string;
  days_remaining: number;
};

export type HrMetricPoint = { label: string; value: number };
export type HrTrendPoint = { month: string; count: number };
export type HrLeaveTypeMetric = { label: string; days: number };

export type HrWorkforceDashboard = {
  period: { from: string; to: string };
  summary: {
    active_headcount: number;
    on_leave: number;
    terminated_total: number;
    total_employees: number;
    new_hires: number;
    departures: number;
    turnover_rate_pct: number;
    pending_leave_requests: number;
    approved_leave_days: number;
    absence_rate_pct: number;
    avg_tenure_months: number;
    open_requisitions: number;
    attendance_coverage_pct: number;
  };
  headcount_by_status: HrMetricPoint[];
  headcount_by_org_unit: HrMetricPoint[];
  headcount_by_employment_type: HrMetricPoint[];
  headcount_trend: HrTrendPoint[];
  leave_by_type: HrLeaveTypeMetric[];
  recent_hires: { id: string; name: string; position: string | null; hire_date: string; employment_type: string }[];
  recent_departures: { id: string; name: string; position: string | null; departure_date: string }[];
  can_manage: boolean;
};

export type OffboardingTaskRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  title: string;
  category: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  sort_order: number;
};

export type MyOffboardingTaskRow = {
  id: string;
  title: string;
  category: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  sort_order: number;
};

export type ProbationReviewRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  probation_end_date: string;
  status: string;
  outcome_notes: string | null;
  extended_until: string | null;
  reviewer_employee_id: string | null;
  reviewer_name: string | null;
  completed_at: string | null;
};

export type EmploymentContractRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  contract_title: string;
  start_date: string;
  end_date: string | null;
  status: string;
  notes: string | null;
  created_at?: string;
};

export type ContractRenewalRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  contract_title: string;
  end_date: string;
  days_remaining: number;
  status: string;
};

export type HrPayrollGlMappingRow = {
  id: string;
  mapping_key: string;
  gl_account_code: string;
  description: string | null;
  updated_at?: string;
};

export type HrWebhookEndpointRow = {
  id: string;
  name: string;
  url: string;
  has_secret: boolean;
  events: string[];
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type HrWebhookDeliveryRow = {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
  endpoint_name: string;
  endpoint_url: string;
};

export type HrCsvExportResult = {
  content: string;
  filename: string;
  row_count: number;
};

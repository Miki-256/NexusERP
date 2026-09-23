"use client";

import { useMemo, useState } from "react";
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
import { formatCurrency } from "@/lib/utils";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Plus, Pencil, X, UserRound, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { deleteBlockedMessage } from "@/lib/delete-errors";
import { OrganizationTab } from "./organization-tab";
import { PayrollTab } from "./payroll-tab";
import { PerformanceTab } from "./performance-tab";
import { BenefitsTab } from "./benefits-tab";
import { AnalyticsTab } from "./analytics-tab";
import { LifecycleTab } from "./lifecycle-tab";
import { IntegrationsTab } from "./integrations-tab";
import type {
  BenefitEnrollmentRow,
  BenefitPlanRow,
  ComplianceExpiryRow,
  EmploymentContractRow,
  EmployeeTrainingRow,
  HrPolicyRow,
  HrWorkforceDashboard,
  OffboardingTaskRow,
  PerformanceGoalRow,
  ProbationReviewRow,
  ContractRenewalRow,
  HrPayrollGlMappingRow,
  HrWebhookDeliveryRow,
  HrWebhookEndpointRow,
  PayComponentRow,
  PerformanceReviewRow,
  PolicyAckRow,
  ReviewCycleRow,
  SkillRow,
  TrainingCourseRow,
} from "@/lib/hr/types";
import type { Employee, PayrollRun } from "./page";

type PayMethod = "cash" | "mobile_money" | "bank_transfer";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function HrClient({
  organizationId,
  currency,
  canManage,
  employees,
  employeeTotal,
  payrollEmployees,
  page,
  pageSize,
  search,
  statusFilter,
  stores,
  runs,
  teamMembers,
  orgDirectory,
  reviewCycles,
  performanceGoals,
  performanceGoalTotal,
  performanceReviews,
  performanceReviewTotal,
  skills,
  trainingCourses,
  employeeTraining,
  employeeTrainingTotal,
  benefitPlans,
  benefitEnrollments,
  benefitEnrollmentTotal,
  hrPolicies,
  policyAcknowledgements,
  expiringCompliance,
  workforceDashboard,
  offboardingTasks,
  offboardingTotal,
  probationReviews,
  probationTotal,
  employmentContracts,
  contractTotal,
  contractsDue,
  glMappings,
  payComponents,
  webhookEndpoints,
  webhookDeliveries,
  webhookDeliveryTotal,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  employees: Employee[];
  employeeTotal: number;
  payrollEmployees: Employee[];
  page: number;
  pageSize: number;
  search: string;
  statusFilter: Employee["status"] | null;
  stores: { id: string; name: string }[];
  runs: PayrollRun[];
  teamMembers: { user_id: string; email: string; display_name: string }[];
  orgDirectory: { id: string; name: string }[];
  reviewCycles: ReviewCycleRow[];
  performanceGoals: PerformanceGoalRow[];
  performanceGoalTotal: number;
  performanceReviews: PerformanceReviewRow[];
  performanceReviewTotal: number;
  skills: SkillRow[];
  trainingCourses: TrainingCourseRow[];
  employeeTraining: EmployeeTrainingRow[];
  employeeTrainingTotal: number;
  benefitPlans: BenefitPlanRow[];
  benefitEnrollments: BenefitEnrollmentRow[];
  benefitEnrollmentTotal: number;
  hrPolicies: HrPolicyRow[];
  policyAcknowledgements: PolicyAckRow[];
  expiringCompliance: ComplianceExpiryRow[];
  workforceDashboard: HrWorkforceDashboard | null;
  offboardingTasks: OffboardingTaskRow[];
  offboardingTotal: number;
  probationReviews: ProbationReviewRow[];
  probationTotal: number;
  employmentContracts: EmploymentContractRow[];
  contractTotal: number;
  contractsDue: ContractRenewalRow[];
  glMappings: HrPayrollGlMappingRow[];
  payComponents: PayComponentRow[];
  webhookEndpoints: HrWebhookEndpointRow[];
  webhookDeliveries: HrWebhookDeliveryRow[];
  webhookDeliveryTotal: number;
}) {
  const t = useTranslations("hr");
  const router = useRouter();
  const [tab, setTab] = useState<
    | "employees"
    | "organization"
    | "payroll"
    | "performance"
    | "benefits"
    | "analytics"
    | "lifecycle"
    | "integrations"
  >("employees");

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title={t("title")}
        description={t("employeeCount", { count: employeeTotal })}
        action={
          <TabBar
            tabs={[
              { key: "employees" as const, label: t("title") },
              { key: "organization" as const, label: t("organization") },
              ...(canManage ? [{ key: "payroll" as const, label: t("payroll") }] : []),
              ...(canManage ? [{ key: "performance" as const, label: t("performance") }] : []),
              ...(canManage ? [{ key: "benefits" as const, label: t("benefits") }] : []),
              ...(canManage ? [{ key: "analytics" as const, label: t("analytics") }] : []),
              ...(canManage ? [{ key: "lifecycle" as const, label: t("lifecycle") }] : []),
              ...(canManage ? [{ key: "integrations" as const, label: t("integrations") }] : []),
            ]}
            value={tab}
            onChange={setTab}
          />
        }
      />

      {tab === "employees" ? (
        <EmployeesTab
          organizationId={organizationId}
          currency={currency}
          canManage={canManage}
          employees={employees}
          employeeTotal={employeeTotal}
          page={page}
          pageSize={pageSize}
          search={search}
          statusFilter={statusFilter}
          stores={stores}
          teamMembers={teamMembers}
          onChanged={() => router.refresh()}
        />
      ) : tab === "organization" ? (
        <OrganizationTab
          organizationId={organizationId}
          canManage={canManage}
          employees={orgDirectory}
        />
      ) : tab === "performance" ? (
        <PerformanceTab
          organizationId={organizationId}
          employees={orgDirectory}
          cycles={reviewCycles}
          goals={performanceGoals}
          goalTotal={performanceGoalTotal}
          reviews={performanceReviews}
          reviewTotal={performanceReviewTotal}
          skills={skills}
          courses={trainingCourses}
          training={employeeTraining}
          trainingTotal={employeeTrainingTotal}
        />
      ) : tab === "benefits" ? (
        <BenefitsTab
          organizationId={organizationId}
          currency={currency}
          employees={orgDirectory}
          plans={benefitPlans}
          enrollments={benefitEnrollments}
          enrollmentTotal={benefitEnrollmentTotal}
          policies={hrPolicies}
          acknowledgements={policyAcknowledgements}
          expiringItems={expiringCompliance}
        />
      ) : tab === "analytics" && workforceDashboard ? (
        <AnalyticsTab organizationId={organizationId} initialDashboard={workforceDashboard} />
      ) : tab === "lifecycle" ? (
        <LifecycleTab
          organizationId={organizationId}
          employees={orgDirectory}
          offboardingTasks={offboardingTasks}
          offboardingTotal={offboardingTotal}
          probationReviews={probationReviews}
          probationTotal={probationTotal}
          contracts={employmentContracts}
          contractTotal={contractTotal}
          contractsDue={contractsDue}
        />
      ) : tab === "integrations" ? (
        <IntegrationsTab
          organizationId={organizationId}
          glMappings={glMappings}
          payComponents={payComponents}
          webhookEndpoints={webhookEndpoints}
          webhookDeliveries={webhookDeliveries}
          webhookDeliveryTotal={webhookDeliveryTotal}
        />
      ) : tab === "payroll" ? (
        <PayrollTab
          organizationId={organizationId}
          currency={currency}
          runs={runs}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function EmployeesTab({
  organizationId,
  currency,
  canManage,
  employees,
  employeeTotal,
  page,
  pageSize,
  search,
  statusFilter,
  stores,
  teamMembers,
  onChanged,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  employees: Employee[];
  employeeTotal: number;
  page: number;
  pageSize: number;
  search: string;
  statusFilter: Employee["status"] | null;
  stores: { id: string; name: string }[];
  teamMembers: { user_id: string; email: string; display_name: string }[];
  onChanged: () => void;
}) {
  const t = useTranslations("hr");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [formMode, setFormMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<Employee["employment_type"]>("full_time");
  const [salary, setSalary] = useState("");
  const [method, setMethod] = useState<PayMethod>("bank_transfer");
  const [storeId, setStoreId] = useState("");
  const [hireDate, setHireDate] = useState(todayIso());
  const [status, setStatus] = useState<Employee["status"]>("active");
  const [linkedUserId, setLinkedUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchInput, setSearchInput] = useState(search);
  const [filterOpen, setFilterOpen] = useState(false);

  function setQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    router.push(`/hr?${params.toString()}`);
  }

  const totalPages = Math.max(1, Math.ceil(employeeTotal / pageSize));

  function formatSalary(value: number | null) {
    if (value == null) return "—";
    return formatCurrency(Number(value), currency);
  }

  function resetForm() {
    setName("");
    setPosition("");
    setEmail("");
    setPhone("");
    setSalary("");
    setStoreId("");
    setType("full_time");
    setMethod("bank_transfer");
    setHireDate(todayIso());
    setStatus("active");
    setLinkedUserId("");
    setEditingId(null);
    setFormMode("closed");
    setOpen(false);
  }

  function openCreate() {
    resetForm();
    setFormMode("create");
    setOpen(true);
  }

  function openEdit(employee: Employee) {
    setEditingId(employee.id);
    setName(employee.name);
    setPosition(employee.position ?? "");
    setEmail(employee.email ?? "");
    setPhone(employee.phone ?? "");
    setType(employee.employment_type);
    setSalary(String(employee.base_salary ?? ""));
    setMethod(employee.payment_method);
    setStoreId(employee.store_id ?? "");
    setHireDate(employee.hire_date);
    setStatus(employee.status);
    setLinkedUserId(employee.user_id ?? "");
    setFormMode("edit");
    setOpen(true);
  }

  async function saveEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast({ title: t("nameRequired"), variant: "destructive" });
    setBusy(true);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      position: position.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      employment_type: type,
      base_salary: Number(salary) || 0,
      payment_method: method,
      store_id: storeId || null,
      hire_date: hireDate,
      status,
    };

    let savedId: string | undefined = editingId ?? undefined;
    let err: { message: string } | null = null;

    if (formMode === "edit" && editingId) {
      const res = await supabase
        .from("employees")
        .update(payload)
        .eq("id", editingId)
        .eq("organization_id", organizationId);
      err = res.error;
    } else {
      const res = await supabase
        .from("employees")
        .insert({
          organization_id: organizationId,
          ...payload,
        })
        .select("id")
        .single();
      err = res.error;
      savedId = res.data?.id;
    }
    setBusy(false);
    if (err) return toast({ title: t("couldNotSave"), description: err.message, variant: "destructive" });

    const priorUserId = editingId
      ? employees.find((e) => e.id === editingId)?.user_id ?? ""
      : "";

    if (savedId && linkedUserId !== priorUserId) {
      const { error: linkErr } = await supabase.rpc("link_employee_to_user", {
        p_employee_id: savedId,
        p_user_id: linkedUserId || null,
      });
      if (linkErr) {
        toast({ title: t("savedLinkFailed"), description: linkErr.message, variant: "destructive" });
      }
    }

    toast({ title: formMode === "edit" ? t("employeeUpdated") : t("employeeAdded"), description: name });
    resetForm();
    onChanged();
  }

  async function deleteEmployee(id: string, employeeName: string) {
    const supabase = createClient();
    const { error: err } = await supabase
      .from("employees")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (err) {
      return toast({
        title: t("couldNotDelete"),
        description: deleteBlockedMessage(err),
        variant: "destructive",
      });
    }
    toast({ title: t("employeeDeleted"), description: employeeName });
    if (editingId === id) resetForm();
    onChanged();
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => (open ? resetForm() : openCreate())} className="cursor-pointer shadow-sm">
            {open ? (
              <>
                <X className="h-4 w-4" />
                {tCommon("close")}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t("addEmployee")}
              </>
            )}
          </Button>
        </div>
      )}

      {open && canManage && (
        <FormCard title={formMode === "edit" ? t("editEmployee") : t("newEmployee")}>
            <form onSubmit={saveEmployee} className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{tCommon("name")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{tCommon("position")}</Label>
                <Input value={position} onChange={(e) => setPosition(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("employmentType")}</Label>
                <select
                  className={SELECT_CLS}
                  value={type}
                  onChange={(e) => setType(e.target.value as Employee["employment_type"])}
                >
                  <option value="full_time">{t("fullTime")}</option>
                  <option value="part_time">{t("partTime")}</option>
                  <option value="contract">{t("contract")}</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>{tCommon("email")}</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{tCommon("phone")}</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{tCommon("store")}</Label>
                <select className={SELECT_CLS} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  <option value="">{tCommon("none")}</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>{t("baseSalary")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("payMethod")}</Label>
                <select
                  className={SELECT_CLS}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PayMethod)}
                >
                  <option value="bank_transfer">{t("bankTransfer")}</option>
                  <option value="cash">{t("cash")}</option>
                  <option value="mobile_money">{t("mobileMoney")}</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>{t("hireDate")}</Label>
                <DatePicker value={hireDate} onChange={setHireDate} />
              </div>
              {formMode === "edit" && (
                <div className="space-y-2">
                  <Label>{tCommon("status")}</Label>
                  <select
                    className={SELECT_CLS}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Employee["status"])}
                  >
                    <option value="active">{t("statusActive")}</option>
                    <option value="on_leave">{t("statusOnLeave")}</option>
                    <option value="terminated">{t("statusTerminated")}</option>
                  </select>
                </div>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label>{t("linkUser")}</Label>
                <select
                  className={SELECT_CLS}
                  value={linkedUserId}
                  onChange={(e) => setLinkedUserId(e.target.value)}
                >
                  <option value="">{t("notLinked")}</option>
                  {teamMembers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name} ({m.email})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 sm:col-span-3">
                <Button type="submit" disabled={busy} className="cursor-pointer">
                  {busy ? tCommon("saving") : formMode === "edit" ? tCommon("update") : tCommon("save")}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm} className="cursor-pointer">
                  {tCommon("cancel")}
                </Button>
              </div>
            </form>
        </FormCard>
      )}

      <TableToolbar
        search={searchInput}
        placeholder={t("searchEmployees")}
        onSearchChange={setSearchInput}
        onSearchSubmit={() => setQuery({ q: searchInput || null, page: "1" })}
        filterOpen={filterOpen}
        onFilterOpenChange={setFilterOpen}
        filterActive={!!statusFilter}
        filterContent={
          <select
            className={SELECT_CLS + " h-9 min-w-[140px]"}
            value={statusFilter ?? ""}
            onChange={(e) => setQuery({ status: e.target.value || null, page: "1" })}
          >
            <option value="">{tCommon("allStatuses")}</option>
            <option value="active">{t("statusActive")}</option>
            <option value="on_leave">{t("statusOnLeave")}</option>
            <option value="terminated">{t("statusTerminated")}</option>
          </select>
        }
      />

      <div className="space-y-3 lg:hidden">
        {employees.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("noEmployees")}</p>
        ) : (
          employees.map((e) => (
            <MobileRecordCard key={e.id}>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{e.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.position || t("noPosition")}
                    {e.org_unit_name ? ` · ${e.org_unit_name}` : ""}
                  </p>
                </div>
                <StatusBadge status={e.status} />
              </div>
              <div className="space-y-1.5">
                <MobileRecordCardRow label={tCommon("type")}>
                  <span className="capitalize">{e.employment_type.replace("_", " ")}</span>
                </MobileRecordCardRow>
                <MobileRecordCardRow label={t("salary")}>{formatSalary(e.base_salary)}</MobileRecordCardRow>
              </div>
              {canManage && (
                <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                  <Button variant="outline" size="sm" className="cursor-pointer" asChild>
                    <Link href={`/hr/employees/${e.id}`}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      {tCommon("profile")}
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => openEdit(e)}>
                    <Pencil className="h-3.5 w-3.5" />
                    {tCommon("edit")}
                  </Button>
                  <ConfirmDeleteButton
                    message={t("removeConfirm")}
                    onConfirm={() => deleteEmployee(e.id, e.name)}
                  />
                </div>
              )}
            </MobileRecordCard>
          ))
        )}
      </div>

      <div className="hidden lg:block">
      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>{tCommon("name")}</DataTableHead>
            <DataTableHead>{tCommon("position")}</DataTableHead>
            <DataTableHead>{t("department")}</DataTableHead>
            <DataTableHead>{tCommon("type")}</DataTableHead>
            <DataTableHead>{tCommon("status")}</DataTableHead>
            <DataTableHead align="right">{t("baseSalary")}</DataTableHead>
            {canManage && <DataTableHead align="right">{tCommon("actions")}</DataTableHead>}
          </DataTableHeader>
          <DataTableBody>
            {employees.length === 0 ? (
              <DataTableEmpty colSpan={canManage ? 7 : 6} message={t("noEmployees")} />
            ) : (
              employees.map((e) => (
                <DataTableRow key={e.id}>
                  <DataTableCell className="font-medium">
                    <Link href={`/hr/employees/${e.id}`} className="hover:underline">
                      {e.name}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>{e.position || "—"}</DataTableCell>
                  <DataTableCell className="text-muted-foreground">{e.org_unit_name || "—"}</DataTableCell>
                  <DataTableCell className="capitalize text-muted-foreground">{e.employment_type.replace("_", " ")}</DataTableCell>
                  <DataTableCell><StatusBadge status={e.status} /></DataTableCell>
                  <DataTableCell align="right" className="font-mono">{formatSalary(e.base_salary)}</DataTableCell>
                  {canManage && (
                    <DataTableCell align="right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="outline" size="sm" className="cursor-pointer" asChild>
                          <Link href={`/hr/employees/${e.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                            {tCommon("profile")}
                          </Link>
                        </Button>
                        <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => openEdit(e)}>
                          <Pencil className="h-3.5 w-3.5" />
                          {tCommon("edit")}
                        </Button>
                        <ConfirmDeleteButton
                          message={t("removeConfirm")}
                          onConfirm={() => deleteEmployee(e.id, e.name)}
                        />
                      </div>
                    </DataTableCell>
                  )}
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>
      </div>

      <TablePagination
        page={page}
        totalPages={totalPages}
        total={employeeTotal}
        onPageChange={(p) => setQuery({ page: String(p) })}
      />
    </div>
  );
}

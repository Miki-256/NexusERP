"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { TabBar } from "@/components/layout/tab-bar";
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
import { formatCurrency } from "@/lib/utils";
import { SELECT_CLS } from "@/lib/ui-classes";
import { runHrMutation } from "@/lib/hr/mutations";
import type {
  BenefitEnrollmentRow,
  BenefitPlanRow,
  ComplianceExpiryRow,
  HrPolicyRow,
  PolicyAckRow,
} from "@/lib/hr/types";
import { Bell, Plus, Shield } from "lucide-react";

type BenefitsTab = "plans" | "enrollments" | "policies" | "compliance";

export function BenefitsTab({
  organizationId,
  currency,
  employees,
  plans,
  enrollments,
  enrollmentTotal,
  policies,
  acknowledgements,
  expiringItems,
}: {
  organizationId: string;
  currency: string;
  employees: { id: string; name: string }[];
  plans: BenefitPlanRow[];
  enrollments: BenefitEnrollmentRow[];
  enrollmentTotal: number;
  policies: HrPolicyRow[];
  acknowledgements: PolicyAckRow[];
  expiringItems: ComplianceExpiryRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<BenefitsTab>("enrollments");
  const [busy, setBusy] = useState(false);
  const [enrollEmployeeId, setEnrollEmployeeId] = useState(employees[0]?.id ?? "");
  const [enrollPlanId, setEnrollPlanId] = useState(plans[0]?.id ?? "");
  const [coverageLevel, setCoverageLevel] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [scanDays, setScanDays] = useState("30");

  async function enroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollEmployeeId || !enrollPlanId) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("enroll_employee_benefit", {
          p_org_id: organizationId,
          p_employee_id: enrollEmployeeId,
          p_plan_id: enrollPlanId,
          p_coverage_level: coverageLevel || null,
          p_effective_date: effectiveDate || null,
          p_status: "active",
        });
        return { error };
      },
      { successTitle: "Employee enrolled" }
    );
    setBusy(false);
    if (ok) router.refresh();
  }

  async function terminateEnrollment(id: string) {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("update_benefit_enrollment", {
          p_enrollment_id: id,
          p_status: "terminated",
          p_end_date: new Date().toISOString().slice(0, 10),
        });
        return { error };
      },
      { successTitle: "Enrollment terminated" }
    );
    setBusy(false);
    router.refresh();
  }

  async function scanAlerts() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("scan_hr_compliance_alerts", {
      p_org_id: organizationId,
      p_days_ahead: Number(scanDays) || 30,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Scan failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Compliance scan complete", description: `${data ?? 0} alert(s) sent.` });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <TabBar
        tabs={[
          { key: "enrollments" as const, label: "Enrollments" },
          { key: "plans" as const, label: "Plans" },
          { key: "policies" as const, label: "Policies" },
          { key: "compliance" as const, label: "Compliance" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "enrollments" && (
        <div className="space-y-6">
          <FormCard title="Enroll employee" onSubmit={enroll}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label>Employee</Label>
                <select className={SELECT_CLS} value={enrollEmployeeId} onChange={(e) => setEnrollEmployeeId(e.target.value)}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Plan</Label>
                <select className={SELECT_CLS} value={enrollPlanId} onChange={(e) => setEnrollPlanId(e.target.value)}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Coverage level</Label>
                <Input value={coverageLevel} onChange={(e) => setCoverageLevel(e.target.value)} placeholder="Individual / Family" />
              </div>
              <div className="space-y-2">
                <Label>Effective date</Label>
                <DatePicker value={effectiveDate} onChange={setEffectiveDate} />
              </div>
            </div>
            <Button type="submit" disabled={busy || !enrollPlanId}>
              <Plus className="h-4 w-4" />
              Enroll
            </Button>
          </FormCard>

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Employee</DataTableHead>
                <DataTableHead>Plan</DataTableHead>
                <DataTableHead>Coverage</DataTableHead>
                <DataTableHead>Effective</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead align="right">Action</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {enrollments.length === 0 ? (
                  <DataTableEmpty colSpan={6} message="No enrollments yet." />
                ) : (
                  enrollments.map((en) => (
                    <DataTableRow key={en.id}>
                      <DataTableCell className="font-medium">{en.employee_name}</DataTableCell>
                      <DataTableCell>{en.plan_name}</DataTableCell>
                      <DataTableCell>{en.coverage_level ?? "—"}</DataTableCell>
                      <DataTableCell>{en.effective_date}</DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={en.status} />
                      </DataTableCell>
                      <DataTableCell align="right">
                        {en.status === "active" && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void terminateEnrollment(en.id)}>
                            Terminate
                          </Button>
                        )}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
          <p className="text-xs text-muted-foreground">{enrollmentTotal} enrollment(s) total</p>
        </div>
      )}

      {tab === "plans" && (
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Plan</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead align="right">Employer %</DataTableHead>
              <DataTableHead align="right">Employee cost</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {plans.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No benefit plans configured." />
              ) : (
                plans.map((p) => (
                  <DataTableRow key={p.id}>
                    <DataTableCell>
                      <p className="font-medium">{p.name}</p>
                      {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                    </DataTableCell>
                    <DataTableCell className="capitalize">{p.plan_type}</DataTableCell>
                    <DataTableCell align="right">{p.employer_contribution_pct}%</DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {formatCurrency(p.employee_cost_monthly, currency)}/mo
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      )}

      {tab === "policies" && (
        <div className="space-y-6">
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Policy</DataTableHead>
                <DataTableHead>Version</DataTableHead>
                <DataTableHead>Effective</DataTableHead>
                <DataTableHead>Ack required</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {policies.length === 0 ? (
                  <DataTableEmpty colSpan={4} message="No policies yet." />
                ) : (
                  policies.map((p) => (
                    <DataTableRow key={p.id}>
                      <DataTableCell>
                        <p className="font-medium">{p.name}</p>
                        {p.summary && <p className="text-xs text-muted-foreground">{p.summary}</p>}
                      </DataTableCell>
                      <DataTableCell>v{p.version}</DataTableCell>
                      <DataTableCell>{p.effective_date}</DataTableCell>
                      <DataTableCell>{p.requires_acknowledgement ? "Yes" : "No"}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>

          <div className="space-y-3">
            <h3 className="font-semibold">Recent acknowledgements</h3>
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Employee</DataTableHead>
                  <DataTableHead>Policy</DataTableHead>
                  <DataTableHead>Version</DataTableHead>
                  <DataTableHead>Acknowledged</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {acknowledgements.length === 0 ? (
                    <DataTableEmpty colSpan={4} message="No acknowledgements yet." />
                  ) : (
                    acknowledgements.map((a) => (
                      <DataTableRow key={a.id}>
                        <DataTableCell className="font-medium">{a.employee_name}</DataTableCell>
                        <DataTableCell>{a.policy_name}</DataTableCell>
                        <DataTableCell>v{a.policy_version}</DataTableCell>
                        <DataTableCell>{new Date(a.acknowledged_at).toLocaleDateString()}</DataTableCell>
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>
          </div>
        </div>
      )}

      {tab === "compliance" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>Days ahead</Label>
              <Input
                type="number"
                min={7}
                max={365}
                className="h-9 w-24"
                value={scanDays}
                onChange={(e) => setScanDays(e.target.value)}
              />
            </div>
            <Button disabled={busy} onClick={() => void scanAlerts()}>
              <Bell className="h-4 w-4" />
              Scan & notify HR
            </Button>
          </div>

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Employee</DataTableHead>
                <DataTableHead>Item</DataTableHead>
                <DataTableHead>Category</DataTableHead>
                <DataTableHead>Expires</DataTableHead>
                <DataTableHead align="right">Days left</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {expiringItems.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No expiring items in the selected window." />
                ) : (
                  expiringItems.map((item, i) => (
                    <DataTableRow key={`${item.entity_type}-${item.entity_id}-${i}`}>
                      <DataTableCell className="font-medium">{item.employee_name}</DataTableCell>
                      <DataTableCell>{item.item_name}</DataTableCell>
                      <DataTableCell className="capitalize">{item.item_category}</DataTableCell>
                      <DataTableCell>{item.expires_on}</DataTableCell>
                      <DataTableCell align="right">
                        <span className={item.days_remaining <= 7 ? "font-semibold text-amber-600" : ""}>
                          {item.days_remaining}
                        </span>
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="h-4 w-4" />
            Includes employee documents and identity expiry dates from profiles.
          </p>
        </div>
      )}
    </div>
  );
}

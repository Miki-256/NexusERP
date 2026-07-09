"use client";

import { useState } from "react";
import Link from "next/link";
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
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { formatCurrency } from "@/lib/utils";
import { runHrMutation } from "@/lib/hr/mutations";
import type { ApplicantPipeline, EmploymentType } from "@/lib/hr/types";
import { ArrowLeft, UserPlus } from "lucide-react";

export function ApplicantPipelineClient({
  organizationId,
  pipeline,
  employees,
  orgUnits,
}: {
  organizationId: string;
  pipeline: ApplicantPipeline;
  employees: { id: string; name: string }[];
  orgUnits: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const { applicant, job, interviews, offers, can_manage: canManage } = pipeline;

  const [interviewAt, setInterviewAt] = useState("");
  const [interviewerId, setInterviewerId] = useState("");
  const [location, setLocation] = useState("");
  const [offerSalary, setOfferSalary] = useState("");
  const [offerStart, setOfferStart] = useState("");
  const [offerType, setOfferType] = useState<EmploymentType>("full_time");
  const [offerUrl, setOfferUrl] = useState("");
  const [hireSalary, setHireSalary] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [orgUnitId, setOrgUnitId] = useState("");

  async function scheduleInterview(e: React.FormEvent) {
    e.preventDefault();
    if (!interviewAt) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("schedule_applicant_interview", {
          p_applicant_id: applicant.id,
          p_scheduled_at: new Date(interviewAt).toISOString(),
          p_interviewer_employee_id: interviewerId || null,
          p_location_or_link: location || null,
        });
        return { error };
      },
      { successTitle: "Interview scheduled" }
    );
    setBusy(false);
    if (ok) router.refresh();
  }

  async function createOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!offerStart) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("upsert_job_offer", {
          p_applicant_id: applicant.id,
          p_salary: Number(offerSalary) || 0,
          p_start_date: offerStart,
          p_employment_type: offerType,
          p_offer_letter_url: offerUrl || null,
          p_status: "sent",
        });
        return { error };
      },
      { successTitle: "Offer created" }
    );
    setBusy(false);
    if (ok) router.refresh();
  }

  async function hire() {
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("hire_applicant", {
          p_applicant_id: applicant.id,
          p_base_salary: hireSalary ? Number(hireSalary) : null,
          p_hire_date: hireDate || null,
          p_org_unit_id: orgUnitId || null,
          p_send_erp_invite: !!applicant.email,
        });
        return { error };
      },
      {
        successTitle: "Applicant hired",
        successDescription: applicant.email ? "Employee record and ERP invite created." : "Employee record created.",
      }
    );
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link href="/recruitment">
          <ArrowLeft className="h-4 w-4" />
          Back to recruitment
        </Link>
      </Button>

      <PageHeader
        title={applicant.full_name}
        description={[job?.title, applicant.email].filter(Boolean).join(" · ")}
        action={<StatusBadge status={applicant.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <h3 className="font-medium">Interviews</h3>
          {interviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No interviews scheduled.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {interviews.map((iv) => (
                <li key={iv.id} className="px-4 py-3">
                  <p className="font-medium">{new Date(iv.scheduled_at).toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">
                    {iv.interviewer_name ?? "No interviewer"} · {iv.status}
                    {iv.location_or_link ? ` · ${iv.location_or_link}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {canManage && applicant.status !== "hired" && (
            <FormCard title="Schedule interview" onSubmit={scheduleInterview}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Date & time</Label>
                  <Input
                    type="datetime-local"
                    value={interviewAt}
                    onChange={(e) => setInterviewAt(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Interviewer</Label>
                  <select className={SELECT_CLS} value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)}>
                    <option value="">— Select —</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Location / link</Label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
              </div>
              <Button type="submit" disabled={busy}>
                Schedule
              </Button>
            </FormCard>
          )}
        </section>

        <section className="space-y-4">
          <h3 className="font-medium">Offers</h3>
          {offers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No offers yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {offers.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-medium">{formatCurrency(o.salary, "USD")} · starts {o.start_date}</p>
                    <p className="text-sm text-muted-foreground capitalize">{o.status}</p>
                  </div>
                  {o.offer_letter_url && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={o.offer_letter_url} target="_blank" rel="noopener noreferrer">
                        Letter
                      </a>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage && applicant.status !== "hired" && (
            <FormCard title="Create offer" onSubmit={createOffer}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Salary</Label>
                  <Input type="number" value={offerSalary} onChange={(e) => setOfferSalary(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Start date</Label>
                  <DatePicker value={offerStart} onChange={setOfferStart} />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <select className={SELECT_CLS} value={offerType} onChange={(e) => setOfferType(e.target.value as EmploymentType)}>
                    <option value="full_time">Full time</option>
                    <option value="part_time">Part time</option>
                    <option value="contract">Contract</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Offer letter URL</Label>
                  <Input value={offerUrl} onChange={(e) => setOfferUrl(e.target.value)} placeholder="https://…" />
                </div>
              </div>
              <Button type="submit" disabled={busy}>
                Send offer
              </Button>
            </FormCard>
          )}
        </section>
      </div>

      {canManage && applicant.status !== "hired" && (
        <FormCard title="Hire applicant" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Base salary</Label>
              <Input type="number" value={hireSalary} onChange={(e) => setHireSalary(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Hire date</Label>
              <DatePicker value={hireDate} onChange={setHireDate} />
            </div>
            <div className="space-y-2">
              <Label>Org unit</Label>
              <select className={SELECT_CLS} value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
                <option value="">— None —</option>
                {orgUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button disabled={busy} onClick={() => void hire()}>
            <UserPlus className="h-4 w-4" />
            Hire & start onboarding
          </Button>
        </FormCard>
      )}

      {applicant.hired_employee_id && (
        <div className="mt-6 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Hired employee</p>
          <Button variant="link" className="h-auto p-0" asChild>
            <Link href={`/hr/employees/${applicant.hired_employee_id}`}>View employee profile →</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

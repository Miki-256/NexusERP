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
import { TabBar } from "@/components/layout/tab-bar";
import { FormCard } from "@/components/layout/form-card";
import { StatusBadge } from "@/components/layout/status-badge";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { formatCurrency } from "@/lib/utils";
import { runHrMutation } from "@/lib/hr/mutations";
import type { Employee360, EmployeeDependent, EmployeeDocument } from "@/lib/hr/types";
import { ArrowLeft, FileText, Plus, Trash2 } from "lucide-react";

type Tab = "overview" | "personal" | "employment" | "documents" | "leave";

export function EmployeeProfileClient({
  organizationId,
  currency,
  initial,
  orgUnits,
  employees,
  stores,
}: {
  organizationId: string;
  currency: string;
  initial: Employee360;
  orgUnits: { id: string; name: string }[];
  employees: { id: string; name: string }[];
  stores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [emp, setEmp] = useState(initial.employee);
  const [profile, setProfile] = useState(initial.profile ?? {});
  const [dependents, setDependents] = useState<EmployeeDependent[]>(initial.dependents ?? []);
  const [documents, setDocuments] = useState<EmployeeDocument[]>(initial.documents ?? []);
  const canManage = initial.can_manage;

  const [docName, setDocName] = useState("");
  const [docType, setDocType] = useState("general");
  const [docUrl, setDocUrl] = useState("");
  const [docExpiry, setDocExpiry] = useState("");

  function updateProfile(field: string, value: string) {
    setProfile((p) => ({ ...p, [field]: value || null }));
  }

  function updateDependent(index: number, field: keyof EmployeeDependent, value: string) {
    setDependents((list) =>
      list.map((d, i) => (i === index ? { ...d, [field]: value || null } : d))
    );
  }

  async function save360() {
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("save_employee_360", {
          p_employee_id: emp.id,
          p_employee: emp,
          p_profile: profile,
          p_dependents: dependents,
        });
        return { error };
      },
      { successTitle: "Profile saved" }
    );
    setBusy(false);
    return ok;
  }

  async function addDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!docName.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("upsert_employee_document", {
      p_employee_id: emp.id,
      p_name: docName.trim(),
      p_document_type: docType,
      p_url: docUrl.trim() || null,
      p_expires_at: docExpiry || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not add document", description: error.message, variant: "destructive" });
      return;
    }
    setDocuments((prev) => [
      {
        id: data as string,
        name: docName.trim(),
        document_type: docType,
        url: docUrl.trim() || null,
        mime_type: null,
        expires_at: docExpiry || null,
      },
      ...prev,
    ]);
    setDocName("");
    setDocUrl("");
    setDocExpiry("");
    toast({ title: "Document added" });
  }

  return (
    <div className={PAGE_SHELL}>
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/hr">
            <ArrowLeft className="h-4 w-4" />
            Back to HR
          </Link>
        </Button>
      </div>

      <PageHeader
        title={emp.name}
        description={
          [
            emp.employee_number,
            emp.position,
            initial.org_unit?.name,
          ]
            .filter(Boolean)
            .join(" · ") || "Employee profile"
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={emp.status} />
            {canManage && (
              <Button size="sm" disabled={busy} onClick={() => void save360()}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            )}
          </div>
        }
      />

      <TabBar
        tabs={[
          { key: "overview" as const, label: "Overview" },
          { key: "personal" as const, label: "Personal" },
          { key: "employment" as const, label: "Employment" },
          { key: "documents" as const, label: "Documents" },
          { key: "leave" as const, label: "Leave" },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="mt-6">
        {tab === "overview" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoCard label="Email" value={emp.email} />
            <InfoCard label="Phone" value={emp.phone} />
            <InfoCard label="Manager" value={initial.manager?.name} />
            <InfoCard label="Org unit" value={initial.org_unit?.name} />
            <InfoCard label="Hire date" value={emp.hire_date} />
            <InfoCard
              label="Base salary"
              value={emp.base_salary != null ? formatCurrency(emp.base_salary, currency) : null}
            />
          </div>
        )}

        {tab === "personal" && (
          <FormCard title="Personal & emergency">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Date of birth" disabled={!canManage}>
                <DatePicker
                  value={profile.date_of_birth ?? ""}
                  onChange={(v) => updateProfile("date_of_birth", v)}
                  disabled={!canManage}
                />
              </Field>
              <Field label="Gender" disabled={!canManage}>
                <Input
                  value={profile.gender ?? ""}
                  onChange={(e) => updateProfile("gender", e.target.value)}
                  disabled={!canManage}
                />
              </Field>
              <Field label="Nationality" disabled={!canManage}>
                <Input
                  value={profile.nationality ?? ""}
                  onChange={(e) => updateProfile("nationality", e.target.value)}
                  disabled={!canManage}
                />
              </Field>
              <Field label="National ID" disabled={!canManage}>
                <Input
                  value={profile.national_id ?? ""}
                  onChange={(e) => updateProfile("national_id", e.target.value)}
                  disabled={!canManage}
                />
              </Field>
              <Field label="Emergency contact" disabled={!canManage}>
                <Input
                  value={profile.emergency_contact_name ?? ""}
                  onChange={(e) => updateProfile("emergency_contact_name", e.target.value)}
                  disabled={!canManage}
                />
              </Field>
              <Field label="Emergency phone" disabled={!canManage}>
                <Input
                  value={profile.emergency_contact_phone ?? ""}
                  onChange={(e) => updateProfile("emergency_contact_phone", e.target.value)}
                  disabled={!canManage}
                />
              </Field>
              <Field label="Address" className="sm:col-span-2 lg:col-span-3" disabled={!canManage}>
                <Input
                  value={profile.address_line1 ?? ""}
                  onChange={(e) => updateProfile("address_line1", e.target.value)}
                  disabled={!canManage}
                />
              </Field>
            </div>

            {canManage && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Dependents</h4>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDependents((d) => [...d, { full_name: "", relationship: null, date_of_birth: null }])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
                {dependents.map((dep, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-4">
                    <Input
                      placeholder="Full name"
                      value={dep.full_name}
                      onChange={(e) => updateDependent(i, "full_name", e.target.value)}
                    />
                    <Input
                      placeholder="Relationship"
                      value={dep.relationship ?? ""}
                      onChange={(e) => updateDependent(i, "relationship", e.target.value)}
                    />
                    <DatePicker
                      value={dep.date_of_birth ?? ""}
                      onChange={(v) => updateDependent(i, "date_of_birth", v)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDependents((d) => d.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </FormCard>
        )}

        {tab === "employment" && canManage && (
          <FormCard title="Employment details">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Employee number">
                <Input
                  value={emp.employee_number ?? ""}
                  onChange={(e) => setEmp({ ...emp, employee_number: e.target.value || null })}
                />
              </Field>
              <Field label="Position title">
                <Input
                  value={emp.position ?? ""}
                  onChange={(e) => setEmp({ ...emp, position: e.target.value || null })}
                />
              </Field>
              <Field label="Status">
                <select
                  className={SELECT_CLS}
                  value={emp.status}
                  onChange={(e) => setEmp({ ...emp, status: e.target.value as typeof emp.status })}
                >
                  <option value="active">Active</option>
                  <option value="on_leave">On leave</option>
                  <option value="terminated">Terminated</option>
                </select>
              </Field>
              <Field label="Org unit">
                <select
                  className={SELECT_CLS}
                  value={emp.org_unit_id ?? ""}
                  onChange={(e) => setEmp({ ...emp, org_unit_id: e.target.value || null })}
                >
                  <option value="">— None —</option>
                  {orgUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reports to">
                <select
                  className={SELECT_CLS}
                  value={emp.manager_employee_id ?? ""}
                  onChange={(e) => setEmp({ ...emp, manager_employee_id: e.target.value || null })}
                >
                  <option value="">— None —</option>
                  {employees
                    .filter((e) => e.id !== emp.id)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Store">
                <select
                  className={SELECT_CLS}
                  value={emp.store_id ?? ""}
                  onChange={(e) => setEmp({ ...emp, store_id: e.target.value || null })}
                >
                  <option value="">— None —</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Base salary">
                <Input
                  type="number"
                  step="0.01"
                  value={emp.base_salary ?? ""}
                  onChange={(e) => setEmp({ ...emp, base_salary: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Probation end">
                <DatePicker
                  value={profile.probation_end_date ?? ""}
                  onChange={(v) => updateProfile("probation_end_date", v)}
                />
              </Field>
              <Field label="Bank account" className="sm:col-span-2">
                <Input
                  value={profile.bank_account_number ?? ""}
                  onChange={(e) => updateProfile("bank_account_number", e.target.value)}
                />
              </Field>
            </div>
          </FormCard>
        )}

        {tab === "employment" && !canManage && (
          <p className="text-sm text-muted-foreground">Employment details are visible to HR managers only.</p>
        )}

        {tab === "documents" && (
          <div className="space-y-4">
            {canManage && (
              <FormCard title="Add document" onSubmit={addDocument}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Name">
                    <Input value={docName} onChange={(e) => setDocName(e.target.value)} required />
                  </Field>
                  <Field label="Type">
                    <Input value={docType} onChange={(e) => setDocType(e.target.value)} />
                  </Field>
                  <Field label="URL">
                    <Input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" />
                  </Field>
                  <Field label="Expires">
                    <DatePicker value={docExpiry} onChange={setDocExpiry} />
                  </Field>
                </div>
                <Button type="submit" disabled={busy}>
                  Add document
                </Button>
              </FormCard>
            )}
            <ul className="divide-y divide-border rounded-xl border border-border">
              {documents.length === 0 ? (
                <li className="p-6 text-center text-sm text-muted-foreground">No documents on file.</li>
              ) : (
                documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.document_type}
                        {d.expires_at ? ` · expires ${d.expires_at}` : ""}
                      </p>
                    </div>
                    {d.url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={d.url} target="_blank" rel="noopener noreferrer">
                          Open
                        </a>
                      </Button>
                    )}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}

        {tab === "leave" && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {initial.leave_history.length === 0 ? (
              <li className="p-6 text-center text-sm text-muted-foreground">No leave history.</li>
            ) : (
              initial.leave_history.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-medium">
                      {l.start_date} → {l.end_date}
                    </p>
                    {l.reason && <p className="text-sm text-muted-foreground">{l.reason}</p>}
                  </div>
                  <StatusBadge status={l.status} />
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value || "—"}</p>
    </div>
  );
}

function Field({
  label,
  children,
  className,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label className={disabled ? "text-muted-foreground" : undefined}>{label}</Label>
      {children}
    </div>
  );
}

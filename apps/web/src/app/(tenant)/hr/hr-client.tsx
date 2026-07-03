"use client";

import { useMemo, useState } from "react";
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
import { Plus, Pencil, X, UserRound } from "lucide-react";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { deleteBlockedMessage } from "@/lib/delete-errors";
import type { Employee, PayrollRun } from "./page";

type PayMethod = "cash" | "mobile_money" | "bank_transfer";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function monthStartIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function HrClient({
  organizationId,
  currency,
  canManage,
  employees,
  stores,
  runs,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  employees: Employee[];
  stores: { id: string; name: string }[];
  runs: PayrollRun[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"employees" | "payroll">("employees");

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Human Resources"
        description={`${employees.length} employee${employees.length === 1 ? "" : "s"}`}
        action={
          <TabBar
            tabs={[
              { key: "employees" as const, label: "Employees" },
              ...(canManage ? [{ key: "payroll" as const, label: "Payroll" }] : []),
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
          stores={stores}
          onChanged={() => router.refresh()}
        />
      ) : (
        <PayrollTab
          organizationId={organizationId}
          currency={currency}
          employees={employees.filter((e) => e.status === "active")}
          runs={runs}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function EmployeesTab({
  organizationId,
  currency,
  canManage,
  employees,
  stores,
  onChanged,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  employees: Employee[];
  stores: { id: string; name: string }[];
  onChanged: () => void;
}) {
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
  const [busy, setBusy] = useState(false);

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
    setFormMode("edit");
    setOpen(true);
  }

  async function saveEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast({ title: "Name required", variant: "destructive" });
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

    const { error: err } =
      formMode === "edit" && editingId
        ? await supabase
            .from("employees")
            .update(payload)
            .eq("id", editingId)
            .eq("organization_id", organizationId)
        : await supabase.from("employees").insert({
            organization_id: organizationId,
            ...payload,
          });

    setBusy(false);
    if (err) return toast({ title: "Could not save", description: err.message, variant: "destructive" });
    toast({ title: formMode === "edit" ? "Employee updated" : "Employee added", description: name });
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
        title: "Could not delete employee",
        description: deleteBlockedMessage(err),
        variant: "destructive",
      });
    }
    toast({ title: "Employee deleted", description: employeeName });
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
                Close
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add Employee
              </>
            )}
          </Button>
        </div>
      )}

      {open && canManage && (
        <FormCard title={formMode === "edit" ? "Edit Employee" : "New Employee"}>
            <form onSubmit={saveEmployee} className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Position</Label>
                <Input value={position} onChange={(e) => setPosition(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Employment Type</Label>
                <select
                  className={SELECT_CLS}
                  value={type}
                  onChange={(e) => setType(e.target.value as Employee["employment_type"])}
                >
                  <option value="full_time">Full time</option>
                  <option value="part_time">Part time</option>
                  <option value="contract">Contract</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Store</Label>
                <select className={SELECT_CLS} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  <option value="">— None —</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Base Salary</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Pay Method</Label>
                <select
                  className={SELECT_CLS}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PayMethod)}
                >
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="mobile_money">Mobile money</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Hire Date</Label>
                <DatePicker value={hireDate} onChange={setHireDate} />
              </div>
              {formMode === "edit" && (
                <div className="space-y-2">
                  <Label>Status</Label>
                  <select
                    className={SELECT_CLS}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Employee["status"])}
                  >
                    <option value="active">Active</option>
                    <option value="on_leave">On leave</option>
                    <option value="terminated">Terminated</option>
                  </select>
                </div>
              )}
              <div className="flex gap-2 sm:col-span-3">
                <Button type="submit" disabled={busy} className="cursor-pointer">
                  {busy ? "Saving…" : formMode === "edit" ? "Update" : "Save"}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm} className="cursor-pointer">
                  Cancel
                </Button>
              </div>
            </form>
        </FormCard>
      )}

      <div className="space-y-3 lg:hidden">
        {employees.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No employees yet.</p>
        ) : (
          employees.map((e) => (
            <MobileRecordCard key={e.id}>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{e.name}</p>
                  <p className="text-xs text-muted-foreground">{e.position || "No position"}</p>
                </div>
                <StatusBadge status={e.status} />
              </div>
              <div className="space-y-1.5">
                <MobileRecordCardRow label="Type">
                  <span className="capitalize">{e.employment_type.replace("_", " ")}</span>
                </MobileRecordCardRow>
                <MobileRecordCardRow label="Salary">
                  {formatCurrency(Number(e.base_salary), currency)}
                </MobileRecordCardRow>
              </div>
              {canManage && (
                <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                  <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => openEdit(e)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <ConfirmDeleteButton
                    message="Remove this employee? Use Edit → Terminated to keep payroll history."
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
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Position</DataTableHead>
            <DataTableHead>Type</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead align="right">Base Salary</DataTableHead>
            {canManage && <DataTableHead align="right">Actions</DataTableHead>}
          </DataTableHeader>
          <DataTableBody>
            {employees.length === 0 ? (
              <DataTableEmpty colSpan={canManage ? 6 : 5} message="No employees yet." />
            ) : (
              employees.map((e) => (
                <DataTableRow key={e.id}>
                  <DataTableCell className="font-medium">{e.name}</DataTableCell>
                  <DataTableCell>{e.position || "—"}</DataTableCell>
                  <DataTableCell className="capitalize text-muted-foreground">{e.employment_type.replace("_", " ")}</DataTableCell>
                  <DataTableCell><StatusBadge status={e.status} /></DataTableCell>
                  <DataTableCell align="right" className="font-mono">{formatCurrency(Number(e.base_salary), currency)}</DataTableCell>
                  {canManage && (
                    <DataTableCell align="right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => openEdit(e)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <ConfirmDeleteButton
                          message="Remove this employee? Use Edit → Terminated to keep payroll history."
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
    </div>
  );
}

type Line = { gross: string; allowances: string; deductions: string; tax: string };

function PayrollTab({
  organizationId,
  currency,
  employees,
  runs,
  onChanged,
}: {
  organizationId: string;
  currency: string;
  employees: Employee[];
  runs: PayrollRun[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [periodStart, setPeriodStart] = useState(monthStartIso());
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [method, setMethod] = useState<PayMethod>("bank_transfer");
  const [lines, setLines] = useState<Record<string, Line>>(() =>
    Object.fromEntries(
      employees.map((e) => [
        e.id,
        { gross: String(e.base_salary || ""), allowances: "", deductions: "", tax: "" },
      ])
    )
  );
  const [busy, setBusy] = useState(false);

  function update(id: string, field: keyof Line, value: string) {
    setLines((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  const totals = useMemo(() => {
    let gross = 0,
      net = 0;
    for (const e of employees) {
      const l = lines[e.id];
      if (!l) continue;
      const g = Number(l.gross) || 0;
      const a = Number(l.allowances) || 0;
      const d = Number(l.deductions) || 0;
      const t = Number(l.tax) || 0;
      gross += g + a;
      net += g + a - d - t;
    }
    return { gross, net };
  }, [employees, lines]);

  async function runPayroll() {
    const payload = employees
      .map((e) => {
        const l = lines[e.id];
        return {
          employeeId: e.id,
          gross: Number(l?.gross) || 0,
          allowances: Number(l?.allowances) || 0,
          deductions: Number(l?.deductions) || 0,
          tax: Number(l?.tax) || 0,
        };
      })
      .filter((l) => l.gross > 0 || l.allowances > 0);

    if (payload.length === 0) return toast({ title: "No pay entered", description: "Enter pay for at least one employee.", variant: "destructive" });
    setBusy(true);
    const supabase = createClient();
    const { error: err } = await supabase.rpc("run_payroll", {
      p_org_id: organizationId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_payment_method: method,
      p_lines: payload,
    });
    setBusy(false);
    if (err) return toast({ title: "Payroll failed", description: err.message, variant: "destructive" });
    toast({ title: "Payroll posted" });
    onChanged();
  }

  return (
    <div className="space-y-6">
      <FormCard title="Run Payroll">
          <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Period Start</Label>
              <DatePicker value={periodStart} onChange={setPeriodStart} max={periodEnd || undefined} />
            </div>
            <div className="space-y-2">
              <Label>Period End</Label>
              <DatePicker value={periodEnd} onChange={setPeriodEnd} min={periodStart || undefined} />
            </div>
            <div className="space-y-2">
              <Label>Pay Method</Label>
              <select
                className={SELECT_CLS}
                value={method}
                onChange={(e) => setMethod(e.target.value as PayMethod)}
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
              </select>
            </div>
          </div>

          {employees.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add active employees first.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left">Employee</th>
                    <th className="p-2 text-right">Gross</th>
                    <th className="p-2 text-right">Allowances</th>
                    <th className="p-2 text-right">Deductions</th>
                    <th className="p-2 text-right">Tax</th>
                    <th className="p-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => {
                    const l = lines[e.id] ?? { gross: "", allowances: "", deductions: "", tax: "" };
                    const net =
                      (Number(l.gross) || 0) +
                      (Number(l.allowances) || 0) -
                      (Number(l.deductions) || 0) -
                      (Number(l.tax) || 0);
                    return (
                      <tr key={e.id} className="border-b">
                        <td className="p-2 font-medium">{e.name}</td>
                        {(["gross", "allowances", "deductions", "tax"] as const).map((f) => (
                          <td key={f} className="p-2">
                            <Input
                              type="number"
                              step="0.01"
                              className="h-9 text-right"
                              value={l[f]}
                              onChange={(ev) => update(e.id, f, ev.target.value)}
                            />
                          </td>
                        ))}
                        <td className="p-2 text-right font-mono">
                          {formatCurrency(net, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td className="p-2">Totals</td>
                    <td className="p-2 text-right font-mono" colSpan={4}>
                      Gross {formatCurrency(totals.gross, currency)}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {formatCurrency(totals.net, currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <Button onClick={runPayroll} disabled={busy || employees.length === 0}>
            {busy ? "Posting…" : "Run & Post Payroll"}
          </Button>
          </div>
      </FormCard>

      <div className="space-y-3">
        <h3 className="font-semibold">Payroll History</h3>
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Period</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Gross</DataTableHead>
              <DataTableHead align="right">Tax</DataTableHead>
              <DataTableHead align="right">Deductions</DataTableHead>
              <DataTableHead align="right">Net</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {runs.length === 0 ? (
                <DataTableEmpty colSpan={6} message="No payroll runs yet." />
              ) : (
                runs.map((r) => (
                  <DataTableRow key={r.id}>
                    <DataTableCell>{r.period_start} → {r.period_end}</DataTableCell>
                    <DataTableCell><StatusBadge status={r.status} /></DataTableCell>
                    <DataTableCell align="right" className="font-mono">{formatCurrency(Number(r.total_gross), currency)}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{formatCurrency(Number(r.total_tax), currency)}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{formatCurrency(Number(r.total_deductions), currency)}</DataTableCell>
                    <DataTableCell align="right" className="font-mono font-semibold">{formatCurrency(Number(r.total_net), currency)}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </div>
    </div>
  );
}

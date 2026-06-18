"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { Employee, PayrollRun } from "./page";

type PayMethod = "cash" | "mobile_money" | "bank_transfer";

const selectCls = "flex h-10 w-full rounded-md border px-3 text-sm";

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Human Resources</h1>
        <div className="flex gap-1 rounded-md border p-1">
          <Button
            variant={tab === "employees" ? "default" : "ghost"}
            size="sm"
            onClick={() => setTab("employees")}
          >
            Employees
          </Button>
          {canManage && (
            <Button
              variant={tab === "payroll" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTab("payroll")}
            >
              Payroll
            </Button>
          )}
        </div>
      </div>

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function addEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.from("employees").insert({
      organization_id: organizationId,
      name: name.trim(),
      position: position.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      employment_type: type,
      base_salary: Number(salary) || 0,
      payment_method: method,
      store_id: storeId || null,
      hire_date: hireDate,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setName("");
    setPosition("");
    setEmail("");
    setPhone("");
    setSalary("");
    setStoreId("");
    setOpen(false);
    onChanged();
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Add Employee"}</Button>
        </div>
      )}

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>New Employee</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addEmployee} className="grid gap-4 sm:grid-cols-3">
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
                  className={selectCls}
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
                <select className={selectCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
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
                  className={selectCls}
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
                <Input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
              </div>
              {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
              <div>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Position</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Base Salary</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-muted-foreground">
                    No employees yet.
                  </td>
                </tr>
              ) : (
                employees.map((e) => (
                  <tr key={e.id} className="border-b">
                    <td className="p-3 font-medium">{e.name}</td>
                    <td className="p-3">{e.position || "—"}</td>
                    <td className="p-3 capitalize text-muted-foreground">
                      {e.employment_type.replace("_", " ")}
                    </td>
                    <td className="p-3 capitalize">{e.status.replace("_", " ")}</td>
                    <td className="p-3 text-right font-mono">
                      {formatCurrency(Number(e.base_salary), currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
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
  const [error, setError] = useState("");

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

    if (payload.length === 0) return setError("Enter pay for at least one employee");
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.rpc("run_payroll", {
      p_org_id: organizationId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_payment_method: method,
      p_lines: payload,
    });
    setBusy(false);
    if (err) return setError(err.message);
    onChanged();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Run Payroll</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Period Start</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Period End</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Pay Method</Label>
              <select
                className={selectCls}
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

          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button onClick={runPayroll} disabled={busy || employees.length === 0}>
            {busy ? "Posting…" : "Run & Post Payroll"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payroll History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left">Period</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Gross</th>
                <th className="p-3 text-right">Tax</th>
                <th className="p-3 text-right">Deductions</th>
                <th className="p-3 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted-foreground">
                    No payroll runs yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-3">
                      {r.period_start} → {r.period_end}
                    </td>
                    <td className="p-3 capitalize">{r.status}</td>
                    <td className="p-3 text-right font-mono">
                      {formatCurrency(Number(r.total_gross), currency)}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {formatCurrency(Number(r.total_tax), currency)}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {formatCurrency(Number(r.total_deductions), currency)}
                    </td>
                    <td className="p-3 text-right font-mono font-semibold">
                      {formatCurrency(Number(r.total_net), currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

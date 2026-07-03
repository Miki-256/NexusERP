import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { HrClient } from "./hr-client";

export type Employee = {
  id: string;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  employment_type: "full_time" | "part_time" | "contract";
  base_salary: number;
  payment_method: "cash" | "mobile_money" | "bank_transfer";
  hire_date: string;
  status: "active" | "on_leave" | "terminated";
  store_id: string | null;
};

export type PayrollRun = {
  id: string;
  period_start: string;
  period_end: string;
  status: "draft" | "posted";
  total_gross: number;
  total_tax: number;
  total_deductions: number;
  total_net: number;
  created_at: string;
};

export default async function HrPage() {
  const ctx = await requireAppAccess("hr");

  const manage = ctx.canManageApp("hr");
  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: employees }, { data: stores }, { data: runs }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, name, position, email, phone, employment_type, base_salary, payment_method, hire_date, status, store_id"
      )
      .eq("organization_id", orgId)
      .order("name"),
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
  ]);

  return (
    <HrClient
      organizationId={orgId}
      currency={ctx.organization.currency}
      canManage={manage}
      employees={(employees as Employee[]) ?? []}
      stores={(stores as { id: string; name: string }[]) ?? []}
      runs={(runs as PayrollRun[]) ?? []}
    />
  );
}

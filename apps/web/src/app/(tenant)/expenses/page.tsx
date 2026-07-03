import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { ExpensesClient } from "./expenses-client";

export type ExpenseRow = {
  id: string;
  expense_date: string;
  vendor_name: string | null;
  description: string | null;
  amount: number;
  payment_method: "cash" | "mobile_money" | "bank_transfer";
  category_id: string | null;
  expense_categories: { name: string } | { name: string }[] | null;
};

export default async function ExpensesPage() {
  const ctx = await requireAppAccess("expenses");

  const supabase = await createClient();

  const { data: expenses } = await supabase
    .from("expenses")
    .select(
      "id, expense_date, vendor_name, description, amount, payment_method, category_id, expense_categories(name)"
    )
    .eq("organization_id", ctx.organization.id)
    .order("expense_date", { ascending: false })
    .limit(200);

  const { data: categories } = await supabase
    .from("expense_categories")
    .select("id, name")
    .eq("organization_id", ctx.organization.id)
    .order("name");

  const { data: stores } = await supabase
    .from("stores")
    .select("id, name")
    .eq("organization_id", ctx.organization.id)
    .order("name");

  return (
    <ExpensesClient
      organizationId={ctx.organization.id}
      currency={ctx.organization.currency}
      canManage={ctx.canManageApp("expenses")}
      initialExpenses={(expenses as unknown as ExpenseRow[]) ?? []}
      categories={(categories as { id: string; name: string }[]) ?? []}
      stores={(stores as { id: string; name: string }[]) ?? []}
    />
  );
}

import { requireAppAccess } from "@/lib/require-app-access";
import { createReportingClient } from "@/lib/supabase/server";
import { Suspense } from "react";
import { ReportsClient } from "@/components/finance/reports-client";
import { monthToDate } from "@/lib/finance-dates";
import { bucketDailyTotals, groupByField } from "@/lib/finance-aggregates";
import { relationName } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

async function ReportsContent({
  orgId,
  currency,
  from,
  to,
}: {
  orgId: string;
  currency: string;
  from: string;
  to: string;
}) {
  const supabase = await createReportingClient();
  const fromIso = `${from}T00:00:00.000Z`;
  const toIso = `${to}T23:59:59.999Z`;

  const [
    { data: pnlData },
    { data: todayStats },
    { data: sales },
    { data: expenses },
    { data: sessions },
    { data: audit },
    { data: periodPayments },
  ] = await Promise.all([
    supabase.rpc("profit_and_loss", { p_org_id: orgId, p_from: from, p_to: to }),
    supabase.rpc("dashboard_stats", { p_organization_id: orgId }),
    supabase
      .from("sales")
      .select(
        `id, receipt_no, total, status, created_at, subtotal, tax_amount, discount_amount,
         customer_name, customer_phone,
         stores(name),
         registers(name),
         pos_staff(display_name),
         sale_lines(id, product_name, variant_name, quantity, unit_price, tax_amount, discount_amount, line_total),
         payments(id, method, amount, reference, provider, phone, bank_name, cash_tendered, change_given, created_at)`
      )
      .eq("organization_id", orgId)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("expenses")
      .select("id, expense_date, vendor_name, description, amount, payment_method, expense_categories(name)")
      .eq("organization_id", orgId)
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("expense_date", { ascending: false })
      .limit(200),
    supabase
      .from("register_sessions")
      .select("id, opened_at, closed_at, opening_float, closing_cash_counted, registers(name, stores(name))")
      .eq("organization_id", orgId)
      .gte("opened_at", fromIso)
      .lte("opened_at", toIso)
      .order("opened_at", { ascending: false })
      .limit(100),
    supabase.rpc("list_org_audit_logs", {
      p_organization_id: orgId,
      p_limit: 200,
      p_offset: 0,
    }),
    supabase
      .from("payments")
      .select("method, amount, created_at")
      .eq("organization_id", orgId)
      .gte("created_at", fromIso)
      .lte("created_at", toIso),
  ]);

  const completedSales = (sales ?? []).filter((s) => s.status === "completed");
  const dailyTrend = bucketDailyTotals(
    from,
    to,
    completedSales.map((s) => ({
      date: new Date(s.created_at).toISOString().slice(0, 10),
      value: Number(s.total),
    }))
  ).map((d) => ({ label: d.label, value: d.value }));

  const dailyExpenses = bucketDailyTotals(
    from,
    to,
    (expenses ?? []).map((e) => ({ date: e.expense_date, value: Number(e.amount) }))
  );

  const revenueExpenseTrend = dailyTrend.map((r, i) => ({
    label: r.label,
    revenue: r.value,
    expenses: dailyExpenses[i]?.value ?? 0,
  }));

  const paymentMix = groupByField(
    periodPayments ?? [],
    (p) => p.method.replace(/_/g, " "),
    (p) => Number(p.amount)
  );

  const expenseByCategory = groupByField(
    expenses ?? [],
    (e) => relationName(e.expense_categories as { name: string } | { name: string }[] | null) || "Uncategorized",
    (e) => Number(e.amount)
  );

  return (
    <ReportsClient
      currency={currency}
      from={from}
      to={to}
      pnl={(pnlData ?? {}) as Record<string, number>}
      todayStats={(todayStats ?? {}) as Record<string, number>}
      sales={(sales ?? []) as unknown as Parameters<typeof ReportsClient>[0]["sales"]}
      transactions={((sales ?? []) as Parameters<typeof ReportsClient>[0]["transactions"]).map((t) => ({
        ...t,
        sale_lines: t.sale_lines ?? [],
        payments: t.payments ?? [],
      }))}
      expenses={(expenses ?? []) as unknown as Parameters<typeof ReportsClient>[0]["expenses"]}
      sessions={(sessions ?? []) as unknown as Parameters<typeof ReportsClient>[0]["sessions"]}
      audit={((audit ?? []) as Parameters<typeof ReportsClient>[0]["audit"]).filter((a) => {
        const t = new Date(a.created_at).getTime();
        return t >= new Date(fromIso).getTime() && t <= new Date(toIso).getTime();
      })}
      revenueExpenseTrend={revenueExpenseTrend}
      paymentMix={paymentMix}
      expenseByCategory={expenseByCategory}
    />
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const ctx = await requireAppAccess("reports");

  const sp = await searchParams;
  const def = monthToDate();
  const from = sp.from ?? def.from;
  const to = sp.to ?? def.to;

  return (
    <Suspense
      fallback={
        <div className="space-y-6 p-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      }
    >
      <ReportsContent orgId={ctx.organization.id} currency={ctx.organization.currency} from={from} to={to} />
    </Suspense>
  );
}

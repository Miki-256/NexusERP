"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCurrency, relationName } from "@/lib/utils";
import { formatPeriod } from "@/lib/finance-dates";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { TabBar } from "@/components/layout/tab-bar";
import { DateRangeToolbar } from "@/components/finance/date-range-toolbar";
import { ExportCsvButton } from "@/components/finance/export-csv-button";
import { ReportSection, StatementTable } from "@/components/finance/report-section";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { Button } from "@/components/ui/button";
import { PAGE_SHELL } from "@/lib/ui-classes";
import { TransactionsTab, type TransactionRow } from "@/components/finance/transactions-tab";
import {
  ChartCard,
  DualMetricChart,
  FinanceBarChart,
  FinanceDonutChart,
  PnlWaterfallChart,
} from "@/components/charts/finance-charts";
import {
  BarChart3,
  ClipboardList,
  FileSpreadsheet,
  Landmark,
  Receipt,
  ShoppingCart,
} from "lucide-react";

type PnL = Partial<{
  revenue: number;
  cogs: number;
  gross_profit: number;
  operating_expenses: number;
  net_profit: number;
  net_margin_pct: number;
}>;

type SaleRow = {
  id: string;
  receipt_no: string;
  total: number;
  status: string;
  created_at: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  stores: { name: string } | { name: string }[] | null;
};

type ExpenseRow = {
  id: string;
  expense_date: string;
  vendor_name: string | null;
  description: string | null;
  amount: number;
  payment_method: string;
  expense_categories: { name: string } | { name: string }[] | null;
};

type SessionRow = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  closing_cash_counted: number | null;
  registers: { name: string; stores: { name: string } | { name: string }[] } | null;
};

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string;
  user_id?: string | null;
  actor_email?: string | null;
  payload?: Record<string, unknown> | null;
};

type Tab = "summary" | "sales" | "transactions" | "expenses" | "operations" | "audit";

export function ReportsClient({
  currency,
  from,
  to,
  pnl,
  todayStats,
  sales,
  transactions,
  expenses,
  sessions,
  audit,
  revenueExpenseTrend,
  paymentMix,
  expenseByCategory,
}: {
  currency: string;
  from: string;
  to: string;
  pnl: PnL;
  todayStats: Record<string, number>;
  sales: SaleRow[];
  transactions: TransactionRow[];
  expenses: ExpenseRow[];
  sessions: SessionRow[];
  audit: AuditRow[];
  revenueExpenseTrend: { label: string; revenue: number; expenses: number }[];
  paymentMix: { name: string; value: number }[];
  expenseByCategory: { name: string; value: number }[];
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const money = (n: number) => formatCurrency(n, currency);
  const period = formatPeriod(from, to);

  const salesSummary = useMemo(() => {
    const completed = sales.filter((s) => s.status === "completed");
    return {
      count: completed.length,
      gross: completed.reduce((sum, s) => sum + Number(s.total), 0),
      tax: completed.reduce((sum, s) => sum + Number(s.tax_amount ?? 0), 0),
      discounts: completed.reduce((sum, s) => sum + Number(s.discount_amount ?? 0), 0),
    };
  }, [sales]);

  const expenseSummary = useMemo(
    () => ({
      count: expenses.length,
      total: expenses.reduce((sum, e) => sum + Number(e.amount), 0),
    }),
    [expenses]
  );

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        breadcrumb="Reporting"
        title="Business Reports"
        description={`Operational and financial reports for ${period}. Export any table to CSV for accounting or audit.`}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/financials">
              <Landmark className="h-4 w-4" />
              Full financials
            </Link>
          </Button>
        }
      />

      <DateRangeToolbar from={from} to={to} className="rounded-xl border border-border/60 bg-muted/20 p-4" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Period revenue (ledger)"
          value={money(pnl.revenue ?? 0)}
          sub={`Net margin ${pnl.net_margin_pct ?? 0}%`}
          icon={Landmark}
        />
        <StatCard
          label="POS sales (period)"
          value={money(salesSummary.gross)}
          sub={`${salesSummary.count} completed`}
          icon={ShoppingCart}
        />
        <StatCard
          label="Operating expenses"
          value={money(expenseSummary.total)}
          sub={`${expenseSummary.count} records`}
          icon={Receipt}
        />
        <StatCard
          label="Today's POS"
          value={money(todayStats.sales_total ?? 0)}
          sub={`${todayStats.transaction_count ?? 0} transactions`}
          icon={BarChart3}
        />
      </div>

      <TabBar
        tabs={[
          { key: "summary" as const, label: "Executive summary" },
          { key: "sales" as const, label: "Sales register" },
          { key: "transactions" as const, label: "Transactions", count: transactions.length },
          { key: "expenses" as const, label: "Expense register" },
          { key: "operations" as const, label: "Register shifts" },
          { key: "audit" as const, label: "Audit trail" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "summary" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Revenue vs expenses" subtitle={period}>
              <DualMetricChart data={revenueExpenseTrend} formatValue={money} />
            </ChartCard>
            <ChartCard title="Payment collections" subtitle="By method in period">
              {paymentMix.length > 0 ? (
                <FinanceDonutChart data={paymentMix.slice(0, 6)} formatValue={money} />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No payments in period.</p>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <ChartCard title="P&L snapshot" subtitle="Period waterfall" className="lg:col-span-2">
              <PnlWaterfallChart
                revenue={pnl.revenue ?? 0}
                cogs={pnl.cogs ?? 0}
                opex={pnl.operating_expenses ?? 0}
                netProfit={pnl.net_profit ?? 0}
                formatValue={money}
              />
            </ChartCard>
            <ChartCard title="Expense breakdown" subtitle="By category">
              {expenseByCategory.length > 0 ? (
                <FinanceDonutChart data={expenseByCategory.slice(0, 6)} formatValue={money} innerRadius={48} />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No expenses in period.</p>
              )}
            </ChartCard>
          </div>

          <ChartCard title="Today's payment mix" subtitle="Live POS register">
            <FinanceBarChart
              formatValue={money}
              data={[
                { name: "Cash", value: todayStats.cash_total ?? 0, fill: "hsl(142 71% 45%)" },
                { name: "Mobile money", value: todayStats.mobile_total ?? 0, fill: "hsl(221 83% 53%)" },
                { name: "Bank transfer", value: todayStats.bank_total ?? 0, fill: "hsl(262 83% 58%)" },
              ]}
              height={200}
            />
          </ChartCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <ReportSection title="Income statement snapshot" subtitle={period}>
            <StatementTable
              rows={[
                { label: "Ledger revenue", value: money(pnl.revenue ?? 0), bold: true },
                { label: "Gross profit", value: money(pnl.gross_profit ?? 0), indent: true },
                { label: "Operating expenses", value: `(${money(pnl.operating_expenses ?? 0)})`, indent: true },
                { label: "Net profit", value: money(pnl.net_profit ?? 0), bold: true, border: true },
              ]}
            />
          </ReportSection>

          <ReportSection title="Sales activity" subtitle={period}>
            <StatementTable
              rows={[
                { label: "Completed sales", value: String(salesSummary.count) },
                { label: "Gross sales", value: money(salesSummary.gross), bold: true },
                { label: "Tax collected", value: money(salesSummary.tax), indent: true },
                { label: "Discounts given", value: `(${money(salesSummary.discounts)})`, indent: true },
              ]}
            />
          </ReportSection>
        </div>
        </div>
      )}

      {tab === "sales" && (
        <ReportSection
          title="Sales register"
          subtitle={`${sales.length} transactions · ${period}`}
          actions={
            <ExportCsvButton
              filename={`sales-register-${from}-${to}`}
              rows={sales.map((s) => ({
                receipt_no: s.receipt_no,
                date: new Date(s.created_at).toLocaleString(),
                store: relationName(s.stores) || "",
                status: s.status,
                subtotal: s.subtotal,
                tax: s.tax_amount,
                discount: s.discount_amount,
                total: s.total,
              }))}
              columns={[
                { key: "receipt_no", label: "Receipt" },
                { key: "date", label: "Date" },
                { key: "store", label: "Store" },
                { key: "status", label: "Status" },
                { key: "subtotal", label: "Subtotal" },
                { key: "tax", label: "Tax" },
                { key: "discount", label: "Discount" },
                { key: "total", label: "Total" },
              ]}
            />
          }
        >
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Receipt</DataTableHead>
                <DataTableHead>Date</DataTableHead>
                <DataTableHead>Store</DataTableHead>
                <DataTableHead align="right">Subtotal</DataTableHead>
                <DataTableHead align="right">Tax</DataTableHead>
                <DataTableHead align="right">Total</DataTableHead>
                <DataTableHead>Status</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {sales.length === 0 ? (
                  <DataTableEmpty colSpan={7} message="No sales in this period." />
                ) : (
                  sales.map((s) => (
                    <DataTableRow key={s.id}>
                      <DataTableCell className="font-medium">{s.receipt_no}</DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {new Date(s.created_at).toLocaleString()}
                      </DataTableCell>
                      <DataTableCell>{relationName(s.stores) || "—"}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">
                        {money(s.subtotal)}
                      </DataTableCell>
                      <DataTableCell align="right" className="font-mono">
                        {money(s.tax_amount)}
                      </DataTableCell>
                      <DataTableCell align="right" className="font-mono font-medium">
                        {money(s.total)}
                      </DataTableCell>
                      <DataTableCell className="capitalize">{s.status}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}

      {tab === "transactions" && (
        <TransactionsTab currency={currency} from={from} to={to} transactions={transactions} />
      )}

      {tab === "expenses" && (
        <ReportSection
          title="Expense register"
          subtitle={`${expenses.length} records · ${period}`}
          actions={
            <ExportCsvButton
              filename={`expense-register-${from}-${to}`}
              rows={expenses.map((e) => ({
                date: e.expense_date,
                category: relationName(e.expense_categories) || "",
                vendor: e.vendor_name || "",
                description: e.description || "",
                payment: e.payment_method,
                amount: e.amount,
              }))}
              columns={[
                { key: "date", label: "Date" },
                { key: "category", label: "Category" },
                { key: "vendor", label: "Vendor" },
                { key: "description", label: "Description" },
                { key: "payment", label: "Payment Method" },
                { key: "amount", label: "Amount" },
              ]}
            />
          }
        >
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Date</DataTableHead>
                <DataTableHead>Category</DataTableHead>
                <DataTableHead>Vendor</DataTableHead>
                <DataTableHead>Description</DataTableHead>
                <DataTableHead>Payment</DataTableHead>
                <DataTableHead align="right">Amount</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {expenses.length === 0 ? (
                  <DataTableEmpty colSpan={6} message="No expenses in this period." />
                ) : (
                  expenses.map((e) => (
                    <DataTableRow key={e.id}>
                      <DataTableCell>{e.expense_date}</DataTableCell>
                      <DataTableCell>{relationName(e.expense_categories) || "—"}</DataTableCell>
                      <DataTableCell className="text-muted-foreground">{e.vendor_name || "—"}</DataTableCell>
                      <DataTableCell>{e.description || "—"}</DataTableCell>
                      <DataTableCell className="capitalize">{e.payment_method.replace("_", " ")}</DataTableCell>
                      <DataTableCell align="right" className="font-mono font-medium">
                        {money(Number(e.amount))}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}

      {tab === "operations" && (
        <ReportSection
          title="Register shifts"
          subtitle="Cash drawer sessions and float reconciliation"
          actions={
            <ExportCsvButton
              filename={`register-shifts-${from}-${to}`}
              rows={sessions.map((s) => {
                const reg = s.registers;
                const store = reg?.stores
                  ? relationName(reg.stores as { name: string } | { name: string }[])
                  : "";
                return {
                  register: reg?.name || "",
                  store,
                  opened: new Date(s.opened_at).toLocaleString(),
                  closed: s.closed_at ? new Date(s.closed_at).toLocaleString() : "Open",
                  opening_float: s.opening_float,
                  closing_counted: s.closing_cash_counted ?? "",
                };
              })}
              columns={[
                { key: "register", label: "Register" },
                { key: "store", label: "Store" },
                { key: "opened", label: "Opened" },
                { key: "closed", label: "Closed" },
                { key: "opening_float", label: "Opening Float" },
                { key: "closing_counted", label: "Closing Counted" },
              ]}
            />
          }
        >
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Register</DataTableHead>
                <DataTableHead>Opened</DataTableHead>
                <DataTableHead>Closed</DataTableHead>
                <DataTableHead align="right">Opening float</DataTableHead>
                <DataTableHead align="right">Counted</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {sessions.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No register sessions in this period." />
                ) : (
                  sessions.map((sess) => {
                    const reg = sess.registers;
                    const store = reg?.stores
                      ? relationName(reg.stores as { name: string } | { name: string }[])
                      : "";
                    return (
                      <DataTableRow key={sess.id}>
                        <DataTableCell>
                          {reg?.name ?? "—"}
                          {store ? ` · ${store}` : ""}
                        </DataTableCell>
                        <DataTableCell className="text-muted-foreground">
                          {new Date(sess.opened_at).toLocaleString()}
                        </DataTableCell>
                        <DataTableCell className="text-muted-foreground">
                          {sess.closed_at ? new Date(sess.closed_at).toLocaleString() : "Open"}
                        </DataTableCell>
                        <DataTableCell align="right" className="font-mono">
                          {money(Number(sess.opening_float))}
                        </DataTableCell>
                        <DataTableCell align="right" className="font-mono">
                          {sess.closing_cash_counted != null
                            ? money(Number(sess.closing_cash_counted))
                            : "—"}
                        </DataTableCell>
                      </DataTableRow>
                    );
                  })
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}

      {tab === "audit" && (
        <ReportSection
          title="Audit trail"
          subtitle="System actions for compliance review"
          actions={
            <ExportCsvButton
              filename={`audit-trail-${from}-${to}`}
              rows={audit.map((a) => ({
                timestamp: new Date(a.created_at).toLocaleString(),
                action: a.action,
                entity_type: a.entity_type,
                entity_id: a.entity_id,
                actor: a.actor_email ?? a.user_id ?? "",
                payload: a.payload ? JSON.stringify(a.payload) : "",
              }))}
              columns={[
                { key: "timestamp", label: "Timestamp" },
                { key: "action", label: "Action" },
                { key: "entity_type", label: "Entity Type" },
                { key: "entity_id", label: "Entity ID" },
                { key: "actor", label: "Actor" },
                { key: "payload", label: "Payload" },
              ]}
            />
          }
        >
          <div className="max-h-[480px] overflow-y-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {audit.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No audit entries in this period.
                    </td>
                  </tr>
                ) : (
                  audit.map((a) => (
                    <tr key={a.id} className="border-b border-border/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 font-medium">{a.action}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">
                        {a.actor_email ?? (a.user_id ? `${a.user_id.slice(0, 8)}…` : "—")}
                      </td>
                      <td className="px-4 py-2.5 capitalize text-muted-foreground">
                        {a.entity_type}
                        <span className="ml-1 font-mono text-xs">{a.entity_id.slice(0, 8)}…</span>
                      </td>
                      <td className="max-w-[240px] truncate px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {a.payload ? JSON.stringify(a.payload) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <ClipboardList className="h-3.5 w-3.5" />
            Export to CSV for external audit or tax filing workflows.
          </p>
        </ReportSection>
      )}
    </div>
  );
}

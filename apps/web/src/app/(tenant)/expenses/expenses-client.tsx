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
import { FormCard } from "@/components/layout/form-card";
import { StatCard } from "@/components/layout/stat-card";
import { ExportCsvButton } from "@/components/finance/export-csv-button";
import { ReportSection } from "@/components/finance/report-section";
import { TableToolbar } from "@/components/layout/table-toolbar";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ResponsiveTableLayout } from "@/components/layout/responsive-table-layout";
import { formatCurrency, relationName } from "@/lib/utils";
import { groupByField } from "@/lib/finance-aggregates";
import {
  ChartCard,
  FinanceBarChart,
  FinanceDonutChart,
  TrendAreaChart,
} from "@/components/charts/finance-charts";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { PieChart, Receipt, Wallet } from "lucide-react";
import type { ExpenseRow } from "./page";

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "bank_transfer", label: "Bank Transfer" },
] as const;

export function ExpensesClient({
  organizationId,
  currency,
  canManage,
  initialExpenses,
  categories,
  stores,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  initialExpenses: ExpenseRow[];
  categories: { id: string; name: string }[];
  stores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]["value"]>("cash");
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const total = initialExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const mtdTotal = useMemo(() => {
    const monthStart = today.slice(0, 7);
    return initialExpenses
      .filter((e) => e.expense_date.startsWith(monthStart))
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }, [initialExpenses, today]);

  const filtered = useMemo(() => {
    if (!search.trim()) return initialExpenses;
    const q = search.toLowerCase();
    return initialExpenses.filter(
      (e) =>
        (e.vendor_name?.toLowerCase().includes(q) ?? false) ||
        (e.description?.toLowerCase().includes(q) ?? false) ||
        relationName(e.expense_categories).toLowerCase().includes(q)
    );
  }, [initialExpenses, search]);

  const money = (n: number) => formatCurrency(n, currency);

  const byCategory = useMemo(
    () =>
      groupByField(
        filtered,
        (e) => relationName(e.expense_categories) || "Uncategorized",
        (e) => Number(e.amount)
      ),
    [filtered]
  );

  const byPayment = useMemo(
    () =>
      groupByField(
        filtered,
        (e) => e.payment_method.replace(/_/g, " "),
        (e) => Number(e.amount)
      ),
    [filtered]
  );

  const expenseTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) {
      const key = e.expense_date.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(e.amount));
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, value]) => ({
        label: new Date(`${month}-01`).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        value,
      }));
  }, [filtered]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      return toast({ title: "Invalid amount", description: "Enter a valid amount.", variant: "destructive" });
    }
    setLoading(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("record_expense", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
      p_category_id: categoryId || null,
      p_vendor_name: vendor || null,
      p_description: description || null,
      p_amount: value,
      p_payment_method: method,
      p_expense_date: date,
    });
    setLoading(false);
    if (rpcError) return toast({ title: "Could not record expense", description: rpcError.message, variant: "destructive" });
    toast({ title: "Expense recorded", description: formatCurrency(value, currency) });
    setAmount("");
    setVendor("");
    setDescription("");
    setCategoryId("");
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        breadcrumb="Accounts payable & opex"
        title="Expense Register"
        description="Operating expenses posted to the general ledger. Export for bookkeeping, tax prep, or management review."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total recorded" value={formatCurrency(total, currency)} sub="All time" icon={Wallet} />
        <StatCard label="Month to date" value={formatCurrency(mtdTotal, currency)} icon={PieChart} />
        <StatCard label="Records" value={initialExpenses.length} sub={`${filtered.length} shown`} icon={Receipt} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard title="Spend by category" subtitle="Filtered view">
          {byCategory.length > 0 ? (
            <FinanceDonutChart data={byCategory.slice(0, 6)} formatValue={money} innerRadius={48} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No data</p>
          )}
        </ChartCard>
        <ChartCard title="Payment methods" subtitle="How expenses were paid">
          {byPayment.length > 0 ? (
            <FinanceBarChart data={byPayment.map((d, i) => ({ ...d, fill: undefined }))} formatValue={money} height={220} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No data</p>
          )}
        </ChartCard>
        <ChartCard title="Monthly trend" subtitle="Last 6 months">
          {expenseTrend.length > 0 ? (
            <TrendAreaChart data={expenseTrend} formatValue={money} height={220} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No data</p>
          )}
        </ChartCard>
      </div>

      {canManage && (
        <FormCard title="Record Expense">
          <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label>Amount ({currency})</Label><Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
            <div className="space-y-2"><Label>Category</Label><select className={SELECT_CLS} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Uncategorized</option>{categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></div>
            <div className="space-y-2"><Label>Payment</Label><select className={SELECT_CLS} value={method} onChange={(e) => setMethod(e.target.value as (typeof PAYMENT_METHODS)[number]["value"])}>{PAYMENT_METHODS.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}</select></div>
            <div className="space-y-2"><Label>Vendor</Label><Input value={vendor} onChange={(e) => setVendor(e.target.value)} /></div>
            <div className="space-y-2"><Label>Date</Label><DatePicker value={date} onChange={setDate} required /></div>
            {stores.length > 0 && (<div className="space-y-2"><Label>Store (optional)</Label><select className={SELECT_CLS} value={storeId} onChange={(e) => setStoreId(e.target.value)}><option value="">All / none</option>{stores.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</select></div>)}
            <div className="space-y-2 sm:col-span-2"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div className="flex items-end"><Button type="submit" disabled={loading}>{loading ? "Saving…" : "Add Expense"}</Button></div>
          </form>
        </FormCard>
      )}

      <ReportSection
        title="Expense ledger"
        subtitle={`${filtered.length} entries`}
        actions={
          <ExportCsvButton
            filename="expense-register"
            rows={filtered.map((e) => ({
              date: e.expense_date,
              category: relationName(e.expense_categories) || "",
              vendor: e.vendor_name || "",
              description: e.description || "",
              payment_method: e.payment_method,
              amount: e.amount,
            }))}
            columns={[
              { key: "date", label: "Date" },
              { key: "category", label: "Category" },
              { key: "vendor", label: "Vendor" },
              { key: "description", label: "Description" },
              { key: "payment_method", label: "Payment Method" },
              { key: "amount", label: "Amount" },
            ]}
          />
        }
      >
        <TableToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search vendor, category, description…"
          className="mb-4"
        />
        <ResponsiveTableLayout
          mobile={
            filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No expenses match your search.</p>
            ) : (
              filtered.map((e) => (
                <MobileRecordCard key={e.id}>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{relationName(e.expense_categories) || "Uncategorized"}</p>
                      <p className="truncate text-xs text-muted-foreground">{e.description || e.vendor_name || "—"}</p>
                    </div>
                    <p className="shrink-0 font-mono font-semibold">{formatCurrency(Number(e.amount), currency)}</p>
                  </div>
                  <div className="space-y-1.5">
                    <MobileRecordCardRow label="Date">{e.expense_date}</MobileRecordCardRow>
                    <MobileRecordCardRow label="Vendor">{e.vendor_name || "—"}</MobileRecordCardRow>
                    <MobileRecordCardRow label="Payment">{e.payment_method.replace("_", " ")}</MobileRecordCardRow>
                  </div>
                </MobileRecordCard>
              ))
            )
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
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={6} message="No expenses match your search." />
            ) : (
              filtered.map((e) => (
                <DataTableRow key={e.id}>
                  <DataTableCell>{e.expense_date}</DataTableCell>
                  <DataTableCell>{relationName(e.expense_categories) || "—"}</DataTableCell>
                  <DataTableCell className="text-muted-foreground">{e.vendor_name || "—"}</DataTableCell>
                  <DataTableCell>{e.description || "—"}</DataTableCell>
                  <DataTableCell className="capitalize text-muted-foreground">{e.payment_method.replace("_", " ")}</DataTableCell>
                  <DataTableCell align="right" className="font-mono font-medium">{formatCurrency(Number(e.amount), currency)}</DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>
      </ResponsiveTableLayout>
      </ReportSection>
    </div>
  );
}

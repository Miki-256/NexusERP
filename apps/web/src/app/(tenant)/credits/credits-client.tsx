"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { TabBar } from "@/components/layout/tab-bar";
import { FormCard } from "@/components/layout/form-card";
import { StatCard } from "@/components/layout/stat-card";
import { ExportCsvButton } from "@/components/finance/export-csv-button";
import { ReportSection } from "@/components/finance/report-section";
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
import { ChartCard, FinanceBarChart, FinanceDonutChart, TrendAreaChart } from "@/components/charts/finance-charts";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Gift, History, Users } from "lucide-react";
import type { CreditRow, CreditTx } from "./page";
import { GiftCardsPanel } from "./gift-cards-panel";

export function CreditsClient({
  organizationId,
  currency,
  canManage,
  credits,
  transactions,
  customers,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  credits: CreditRow[];
  transactions: CreditTx[];
  customers: { id: string; name: string | null }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<"balances" | "history" | "gift_cards">("balances");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (n: number) => formatCurrency(Number(n), currency);

  const totalOutstanding = useMemo(
    () => credits.reduce((s, c) => s + Number(c.balance), 0),
    [credits]
  );
  const txVolume = useMemo(
    () => transactions.reduce((s, t) => s + Number(t.amount), 0),
    [transactions]
  );

  const balanceByCustomer = useMemo(
    () =>
      groupByField(
        credits,
        (c) => relationName(c.customers as { name: string } | { name: string }[] | null) || "Unknown",
        (c) => Number(c.balance)
      ).slice(0, 8),
    [credits]
  );

  const issuanceTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions) {
      const key = t.created_at.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(t.amount));
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, value]) => ({
        label: new Date(`${month}-01`).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        value,
      }));
  }, [transactions]);

  async function issueCredit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !customerId || !amount) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("issue_customer_credit", {
      p_org_id: organizationId,
      p_customer_id: customerId,
      p_amount: Number(amount),
      p_reason: reason || null,
    });
    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Credit issued" });
    setAmount("");
    setReason("");
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        breadcrumb="Customer credits"
        title="Store Credit & Liabilities"
        description="Track customer credit balances and issuance history for refunds, promotions, and loyalty programs."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Outstanding credit" value={money(totalOutstanding)} icon={Gift} />
        <StatCard label="Customers with balance" value={credits.length} icon={Users} />
        <StatCard label="Issuance volume" value={money(txVolume)} sub={`${transactions.length} transactions`} icon={History} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard title="Balance by customer" subtitle="Top accounts">
          {balanceByCustomer.length > 0 ? (
            <FinanceDonutChart data={balanceByCustomer} formatValue={money} innerRadius={48} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No balances yet</p>
          )}
        </ChartCard>
        <ChartCard title="Issuance trend" subtitle="Last 6 months">
          {issuanceTrend.length > 0 ? (
            <TrendAreaChart data={issuanceTrend} formatValue={money} height={220} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No issuance history</p>
          )}
        </ChartCard>
        <ChartCard title="Average per customer" subtitle="Outstanding liability">
          {credits.length > 0 ? (
            <FinanceBarChart
              data={[
                { name: "Avg balance", value: totalOutstanding / credits.length },
                { name: "Largest", value: Math.max(...credits.map((c) => Number(c.balance))) },
              ]}
              formatValue={money}
              height={220}
            />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No data</p>
          )}
        </ChartCard>
      </div>

      <TabBar
        tabs={[
          { key: "balances" as const, label: "Balances" },
          { key: "history" as const, label: "History" },
          { key: "gift_cards" as const, label: "Gift cards" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "gift_cards" && (
        <GiftCardsPanel
          organizationId={organizationId}
          currency={currency}
          canManage={canManage}
          customers={customers}
        />
      )}

      {tab !== "gift_cards" && (
        <>
      {canManage && tab === "balances" && (
        <FormCard title="Issue credit" onSubmit={issueCredit}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Customer</Label>
              <select className={SELECT_CLS} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name ?? "Unnamed"}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={busy}>Issue credit</Button>
        </FormCard>
      )}

      {tab === "balances" ? (
        <ReportSection
          title="Credit balances"
          subtitle={`${credits.length} customers`}
          actions={
            <ExportCsvButton
              filename="customer-credit-balances"
              rows={credits.map((c) => ({
                customer: relationName(c.customers as { name: string } | { name: string }[] | null) || "",
                balance: c.balance,
              }))}
              columns={[
                { key: "customer", label: "Customer" },
                { key: "balance", label: "Balance" },
              ]}
            />
          }
        >
        <ResponsiveTableLayout
          mobile={
            credits.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No credit balances yet.</p>
            ) : (
              credits.map((c) => (
                <MobileRecordCard key={c.id}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">
                      {relationName(c.customers as { name: string } | { name: string }[] | null) || "—"}
                    </p>
                    <p className="font-mono font-semibold text-emerald-700">{money(c.balance)}</p>
                  </div>
                </MobileRecordCard>
              ))
            )
          }
        >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Customer</DataTableHead>
              <DataTableHead align="right">Balance</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {credits.length === 0 ? (
                <DataTableEmpty colSpan={2} message="No credit balances yet." />
              ) : (
                credits.map((c) => (
                  <DataTableRow key={c.id}>
                    <DataTableCell className="font-medium">
                    {relationName(c.customers as { name: string } | { name: string }[] | null) || "—"}
                  </DataTableCell>
                    <DataTableCell align="right">{money(c.balance)}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
        </ResponsiveTableLayout>
        </ReportSection>
      ) : (
        <ReportSection
          title="Credit transaction history"
          subtitle={`${transactions.length} entries`}
          actions={
            <ExportCsvButton
              filename="credit-transactions"
              rows={transactions.map((t) => ({
                date: new Date(t.created_at).toLocaleString(),
                customer: relationName(t.customers as { name: string } | { name: string }[] | null) || "",
                reason: t.reason || "",
                amount: t.amount,
              }))}
              columns={[
                { key: "date", label: "Date" },
                { key: "customer", label: "Customer" },
                { key: "reason", label: "Reason" },
                { key: "amount", label: "Amount" },
              ]}
            />
          }
        >
        <ResponsiveTableLayout
          mobile={
            transactions.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No credit transactions.</p>
            ) : (
              transactions.map((t) => (
                <MobileRecordCard key={t.id}>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {relationName(t.customers as { name: string } | { name: string }[] | null) || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">{t.reason ?? "—"}</p>
                    </div>
                    <p className="shrink-0 font-mono font-semibold">{money(t.amount)}</p>
                  </div>
                  <MobileRecordCardRow label="Date">
                    {new Date(t.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </MobileRecordCardRow>
                </MobileRecordCard>
              ))
            )
          }
        >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Date & time</DataTableHead>
              <DataTableHead>Customer</DataTableHead>
              <DataTableHead>Reason</DataTableHead>
              <DataTableHead align="right">Amount</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {transactions.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No credit transactions." />
              ) : (
                transactions.map((t) => (
                  <DataTableRow key={t.id}>
                    <DataTableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(t.created_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </DataTableCell>
                    <DataTableCell>{relationName(t.customers as { name: string } | { name: string }[] | null) || "—"}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">{t.reason ?? "—"}</DataTableCell>
                    <DataTableCell align="right">{money(t.amount)}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
        </ResponsiveTableLayout>
        </ReportSection>
      )}
        </>
      )}
    </div>
  );
}

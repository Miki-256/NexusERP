"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { formatCurrency, relationName } from "@/lib/utils";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Clock, History, Users } from "lucide-react";
import type { ReceivableRow, ReceivableTx } from "./page";

type CustomerOption = {
  id: string;
  name: string | null;
  on_account_enabled: boolean;
  credit_limit: number | null;
};

export function ReceivablesClient({
  organizationId,
  currency,
  canManage,
  receivables,
  transactions,
  customers,
}: {
  organizationId: string;
  currency: string;
  canManage: boolean;
  receivables: ReceivableRow[];
  transactions: ReceivableTx[];
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<"balances" | "history" | "terms">("balances");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "mobile_money" | "bank_transfer">("cash");
  const [termsCustomerId, setTermsCustomerId] = useState(customers[0]?.id ?? "");
  const [onAccountEnabled, setOnAccountEnabled] = useState(false);
  const [creditLimit, setCreditLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (n: number) => formatCurrency(Number(n), currency);

  const totalOwed = useMemo(
    () => receivables.reduce((s, r) => s + Number(r.balance), 0),
    [receivables]
  );

  const payLaterCustomers = useMemo(
    () => customers.filter((c) => c.on_account_enabled).length,
    [customers]
  );

  const selectedTermsCustomer = customers.find((c) => c.id === termsCustomerId);

  useEffect(() => {
    const c = customers.find((x) => x.id === termsCustomerId);
    if (c) {
      setOnAccountEnabled(Boolean(c.on_account_enabled));
      setCreditLimit(c.credit_limit != null ? String(c.credit_limit) : "");
    }
  }, [termsCustomerId, customers]);

  function loadTermsForCustomer(id: string) {
    setTermsCustomerId(id);
    const c = customers.find((x) => x.id === id);
    setOnAccountEnabled(Boolean(c?.on_account_enabled));
    setCreditLimit(c?.credit_limit != null ? String(c.credit_limit) : "");
  }

  async function collectPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !customerId || !amount) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("collect_customer_receivable", {
      p_org_id: organizationId,
      p_customer_id: customerId,
      p_amount: Number(amount),
      p_payment_method: paymentMethod,
      p_reference: reference || null,
    });
    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Payment recorded" });
    setAmount("");
    setReference("");
    router.refresh();
  }

  async function saveTerms(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !termsCustomerId) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("update_customer_account_terms", {
      p_org_id: organizationId,
      p_customer_id: termsCustomerId,
      p_on_account_enabled: onAccountEnabled,
      p_credit_limit: creditLimit.trim() ? Number(creditLimit) : null,
    });
    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Account terms updated" });
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        breadcrumb="Pay later"
        title="Customer receivables"
        description="Track buy-now-pay-later balances, collect payments, and manage credit limits."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total owed" value={money(totalOwed)} icon={Clock} />
        <StatCard label="Customers with balance" value={receivables.filter((r) => Number(r.balance) > 0).length} icon={Users} />
        <StatCard label="Pay-later enabled" value={payLaterCustomers} icon={History} />
      </div>

      <TabBar
        tabs={[
          { key: "balances" as const, label: "Balances" },
          { key: "history" as const, label: "History" },
          { key: "terms" as const, label: "Account terms" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "balances" && canManage && (
        <FormCard title="Collect payment" onSubmit={collectPayment}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Customer</Label>
              <select className={SELECT_CLS} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name || c.id.slice(0, 8)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <select className={SELECT_CLS} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Reference (optional)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt / txn ID" />
            </div>
          </div>
          <Button type="submit" disabled={busy} className="mt-4 cursor-pointer">
            Record payment
          </Button>
        </FormCard>
      )}

      {tab === "terms" && canManage && (
        <FormCard title="Pay-later account terms" onSubmit={saveTerms}>
          <p className="mb-4 text-sm text-muted-foreground">
            Enable pay later for trusted customers. Optionally set a credit limit — leave blank for unlimited.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Customer</Label>
              <select
                className={SELECT_CLS}
                value={termsCustomerId}
                onChange={(e) => loadTermsForCustomer(e.target.value)}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name || c.id.slice(0, 8)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Credit limit ({currency})</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="Unlimited if empty"
              />
            </div>
            <div className="flex items-end gap-3 pb-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onAccountEnabled}
                  onChange={(e) => setOnAccountEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Enable pay later
              </label>
            </div>
          </div>
          {selectedTermsCustomer && (
            <p className="mt-3 text-xs text-muted-foreground">
              Current: {selectedTermsCustomer.on_account_enabled ? "enabled" : "disabled"}
              {selectedTermsCustomer.credit_limit != null
                ? ` · limit ${money(Number(selectedTermsCustomer.credit_limit))}`
                : " · no limit set"}
            </p>
          )}
          <Button type="submit" disabled={busy} className="mt-4 cursor-pointer">
            Save terms
          </Button>
        </FormCard>
      )}

      {tab === "balances" && (
        <DataTable
          toolbar={
            <ExportCsvButton
              filename="customer-receivables"
              rows={receivables.map((r) => {
                const cust = r.customers as { name: string | null; credit_limit: number | null } | { name: string | null; credit_limit: number | null }[] | null;
                const limit = Array.isArray(cust) ? cust[0]?.credit_limit : cust?.credit_limit;
                return {
                  customer: relationName(cust as { name: string } | { name: string }[] | null) || "",
                  balance: Number(r.balance),
                  credit_limit: limit ?? "",
                };
              })}
              columns={[
                { key: "customer", label: "Customer" },
                { key: "balance", label: "Balance owed" },
                { key: "credit_limit", label: "Credit limit" },
              ]}
            />
          }
        >
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Customer</DataTableHead>
              <DataTableHead>Phone</DataTableHead>
              <DataTableHead align="right">Balance owed</DataTableHead>
              <DataTableHead align="right">Credit limit</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {receivables.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No outstanding balances." />
              ) : (
                receivables.map((r) => {
                  const cust = r.customers as { name: string | null; phone: string | null; credit_limit: number | null } | { name: string | null; phone: string | null; credit_limit: number | null }[] | null;
                  return (
                    <DataTableRow key={r.id}>
                      <DataTableCell className="font-medium">
                        {relationName(cust as { name: string } | { name: string }[] | null) || "—"}
                      </DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {Array.isArray(cust) ? cust[0]?.phone : cust?.phone || "—"}
                      </DataTableCell>
                      <DataTableCell align="right" className="font-mono font-semibold text-amber-700">
                        {money(Number(r.balance))}
                      </DataTableCell>
                      <DataTableCell align="right" className="font-mono text-muted-foreground">
                        {(() => {
                          const limit = Array.isArray(cust) ? cust[0]?.credit_limit : cust?.credit_limit;
                          return limit != null ? money(Number(limit)) : "Unlimited";
                        })()}
                      </DataTableCell>
                    </DataTableRow>
                  );
                })
              )}
            </DataTableBody>
          </table>
        </DataTable>
      )}

      {tab === "history" && (
        <DataTable
          toolbar={
            <ExportCsvButton
              filename="receivable-transactions"
              rows={transactions.map((t) => ({
                date: t.created_at,
                customer: relationName(t.customers as { name: string } | { name: string }[] | null) || "",
                amount: Number(t.amount),
                method: t.payment_method || "",
                reason: t.reason || "",
              }))}
              columns={[
                { key: "date", label: "Date" },
                { key: "customer", label: "Customer" },
                { key: "amount", label: "Amount" },
                { key: "method", label: "Method" },
                { key: "reason", label: "Reason" },
              ]}
            />
          }
        >
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Date</DataTableHead>
              <DataTableHead>Customer</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead align="right">Amount</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {transactions.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No transactions yet." />
              ) : (
                transactions.map((t) => (
                  <DataTableRow key={t.id}>
                    <DataTableCell className="text-muted-foreground">
                      {new Date(t.created_at).toLocaleString()}
                    </DataTableCell>
                    <DataTableCell>
                      {relationName(t.customers as { name: string } | { name: string }[] | null) || "—"}
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {Number(t.amount) > 0 ? "Charge" : t.payment_method ? `Payment (${t.payment_method})` : "Adjustment"}
                      {t.reason ? ` — ${t.reason}` : ""}
                    </DataTableCell>
                    <DataTableCell
                      align="right"
                      className={`font-mono font-medium ${Number(t.amount) > 0 ? "text-amber-700" : "text-emerald-700"}`}
                    >
                      {Number(t.amount) > 0 ? "+" : ""}
                      {money(Number(t.amount))}
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      )}
    </div>
  );
}

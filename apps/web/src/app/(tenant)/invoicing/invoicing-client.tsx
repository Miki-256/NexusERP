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
import { StatusBadge } from "@/components/layout/status-badge";
import { StatCard } from "@/components/layout/stat-card";
import { TabBar } from "@/components/layout/tab-bar";
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
import { ChartCard, FinanceDonutChart } from "@/components/charts/finance-charts";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { AlertCircle, FileText, Landmark, Wallet } from "lucide-react";
import type { InvoiceRow, CreditNoteRow } from "./page";
import { CustomerStatementPanel } from "@/components/finance/customer-statement-panel";
import { ArCollectionsTab, type CollectionsQueueRow } from "@/components/finance/ar-collections-tab";

type Line = { description: string; quantity: string; unitPrice: string; taxCodeId: string };
type MainTab = "invoices" | "credit_notes" | "collections" | "statements";

function invoiceBalanceDue(inv: InvoiceRow) {
  if (inv.balance_due != null) return Number(inv.balance_due);
  if (inv.status === "paid") return 0;
  if (inv.status === "posted" || inv.status === "partially_paid") {
    return Math.max(Number(inv.total) - Number(inv.amount_paid ?? 0) - Number(inv.amount_credited ?? 0), 0);
  }
  return 0;
}

function isOpenInvoice(inv: InvoiceRow) {
  return inv.status === "posted" || inv.status === "partially_paid";
}

export function InvoicingClient({
  organizationId,
  currency,
  taxRate,
  taxCodes,
  canManage,
  invoices,
  creditNotes,
  customers,
  collectionsQueue,
}: {
  organizationId: string;
  currency: string;
  taxRate: number;
  taxCodes: { id: string; code: string; name: string; rate: number }[];
  canManage: boolean;
  invoices: InvoiceRow[];
  creditNotes: CreditNoteRow[];
  customers: { id: string; name: string | null }[];
  collectionsQueue: CollectionsQueueRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState<MainTab>("invoices");
  const [busy, setBusy] = useState("");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", unitPrice: "", taxCodeId: "" }]);
  const [cnLines, setCnLines] = useState<Line[]>([{ description: "", quantity: "1", unitPrice: "", taxCodeId: "" }]);
  const [cnCustomerId, setCnCustomerId] = useState(customers[0]?.id ?? "");
  const [cnSettlement, setCnSettlement] = useState<"store_credit" | "ar" | "cash">("store_credit");
  const [cnReason, setCnReason] = useState("");
  const [search, setSearch] = useState("");
  const [payInvoiceId, setPayInvoiceId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "mobile_money" | "bank_transfer">("cash");
  const [payReference, setPayReference] = useState("");

  const defaultTaxCodeId = taxCodes.find((t) => t.code === "STANDARD")?.id ?? taxCodes[0]?.id ?? "";

  const money = (n: number) => formatCurrency(Number(n), currency);

  const summary = useMemo(() => {
    const openInvoices = invoices.filter((i) => isOpenInvoice(i) && invoiceBalanceDue(i) > 0.01);
    const overdue = openInvoices.filter(
      (i) => i.due_date && i.due_date < new Date().toISOString().slice(0, 10)
    );
    return {
      arOpen: openInvoices.reduce((s, i) => s + invoiceBalanceDue(i), 0),
      openCount: openInvoices.length,
      overdueCount: overdue.length,
      paidTotal: invoices
        .filter((i) => i.status === "paid" || i.status === "partially_paid")
        .reduce((s, i) => s + Number(i.amount_paid ?? (i.status === "paid" ? i.total : 0)), 0),
    };
  }, [invoices]);

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.toLowerCase();
    return invoices.filter(
      (i) =>
        i.invoice_no.toLowerCase().includes(q) ||
        relationName(i.customers as { name: string } | { name: string }[] | null).toLowerCase().includes(q)
    );
  }, [invoices, search]);

  const byStatus = useMemo(
    () => groupByField(invoices, (i) => i.status, (i) => Number(i.total)),
    [invoices]
  );

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const payload = lines
      .filter((l) => l.description.trim() && l.unitPrice)
      .map((l) => ({
        description: l.description.trim(),
        quantity: Number(l.quantity) || 1,
        unitPrice: Number(l.unitPrice),
        taxCodeId: l.taxCodeId || defaultTaxCodeId || undefined,
      }));
    if (payload.length === 0) {
      toast({ title: "Add at least one line", variant: "destructive" });
      return;
    }
    setBusy("create");
    const supabase = createClient();
    const { error } = await supabase.rpc("create_customer_invoice", {
      p_org_id: organizationId,
      p_customer_id: customerId || null,
      p_invoice_date: new Date().toISOString().slice(0, 10),
      p_due_date: dueDate || null,
      p_tax_rate: taxRate,
      p_notes: notes || null,
      p_lines: payload,
    });
    setBusy("");
    if (error) return toast({ title: "Could not create invoice", description: error.message, variant: "destructive" });
    toast({ title: "Invoice created" });
    setLines([{ description: "", quantity: "1", unitPrice: "", taxCodeId: defaultTaxCodeId }]);
    router.refresh();
  }

  async function postInvoice(id: string) {
    setBusy(id + "post");
    const supabase = createClient();
    const { error } = await supabase.rpc("post_customer_invoice", { p_invoice_id: id });
    setBusy("");
    if (error) return toast({ title: "Post failed", description: error.message, variant: "destructive" });
    toast({ title: "Invoice posted to ledger" });
    router.refresh();
  }

  async function payInvoice(id: string, amount?: number) {
    const inv = invoices.find((i) => i.id === id);
    const balance = inv ? invoiceBalanceDue(inv) : 0;
    const pay = amount ?? balance;
    if (!pay || pay <= 0) return;
    setBusy(id + "pay");
    const supabase = createClient();
    const { error } = await supabase.rpc("pay_customer_invoice", {
      p_invoice_id: id,
      p_payment_method: payMethod,
      p_amount: pay,
      p_reference: payReference || null,
    });
    setBusy("");
    if (error) return toast({ title: "Payment failed", description: error.message, variant: "destructive" });
    toast({ title: pay >= balance - 0.01 ? "Invoice paid in full" : "Partial payment recorded" });
    setPayInvoiceId(null);
    setPayAmount("");
    setPayReference("");
    router.refresh();
  }

  function openPayDialog(inv: InvoiceRow) {
    setPayInvoiceId(inv.id);
    setPayAmount(String(invoiceBalanceDue(inv)));
    setPayMethod("cash");
    setPayReference("");
  }

  async function createCreditNote(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !cnCustomerId) return;
    const payload = cnLines
      .filter((l) => l.description.trim() && l.unitPrice)
      .map((l) => ({
        description: l.description.trim(),
        quantity: Number(l.quantity) || 1,
        unitPrice: Number(l.unitPrice),
        taxCodeId: l.taxCodeId || defaultTaxCodeId || undefined,
      }));
    if (payload.length === 0) {
      toast({ title: "Add at least one line", variant: "destructive" });
      return;
    }
    setBusy("cn-create");
    const supabase = createClient();
    const { error } = await supabase.rpc("create_customer_credit_note", {
      p_org_id: organizationId,
      p_customer_id: cnCustomerId,
      p_lines: payload,
      p_settlement_method: cnSettlement,
      p_tax_rate: taxRate,
      p_reason: cnReason || null,
    });
    setBusy("");
    if (error) return toast({ title: "Could not create credit note", description: error.message, variant: "destructive" });
    toast({ title: "Credit note created" });
    setCnLines([{ description: "", quantity: "1", unitPrice: "", taxCodeId: defaultTaxCodeId }]);
    setCnReason("");
    router.refresh();
  }

  async function postCreditNote(id: string) {
    setBusy(id + "cn-post");
    const supabase = createClient();
    const { error } = await supabase.rpc("post_customer_credit_note", { p_credit_note_id: id });
    setBusy("");
    if (error) return toast({ title: "Post failed", description: error.message, variant: "destructive" });
    toast({ title: "Credit note posted to ledger" });
    router.refresh();
  }

  const filteredCreditNotes = useMemo(() => {
    if (!search.trim()) return creditNotes;
    const q = search.toLowerCase();
    return creditNotes.filter(
      (n) =>
        n.credit_note_no.toLowerCase().includes(q) ||
        relationName(n.customers as { name: string } | { name: string }[] | null).toLowerCase().includes(q)
    );
  }, [creditNotes, search]);

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        breadcrumb="Accounts receivable"
        title="Customer Invoicing"
        description="Create, post, and collect on customer invoices and credit notes. Posted documents update the general ledger."
      />

      <TabBar
        tabs={[
          { key: "invoices" as const, label: "Invoices", count: invoices.length },
          { key: "credit_notes" as const, label: "Credit notes", count: creditNotes.length },
          { key: "collections" as const, label: "Collections", count: collectionsQueue.length },
          { key: "statements" as const, label: "Statements" },
        ]}
        value={mainTab}
        onChange={setMainTab}
      />

      {mainTab === "invoices" && (
        <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open AR" value={money(summary.arOpen)} sub={`${summary.openCount} invoices`} icon={FileText} />
        <StatCard label="Collected" value={money(summary.paidTotal)} icon={Wallet} />
        <StatCard
          label="Overdue"
          value={summary.overdueCount}
          sub={summary.overdueCount > 0 ? "Requires follow-up" : "None overdue"}
          icon={AlertCircle}
          highlight={summary.overdueCount > 0 ? "negative" : undefined}
        />
        <StatCard label="Default tax" value={`${taxRate}%`} sub="STANDARD code · per-line override" icon={Landmark} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="AR by status" subtitle="Invoice pipeline">
          {byStatus.length > 0 ? (
            <FinanceDonutChart data={byStatus} formatValue={money} />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">No invoices yet.</p>
          )}
        </ChartCard>
        <ChartCard title="Collection summary" subtitle="Accounts receivable">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-xs uppercase text-muted-foreground">Open AR</p>
              <p className="mt-2 text-2xl font-bold tabular-nums">{money(summary.arOpen)}</p>
              <p className="text-xs text-muted-foreground">{summary.openCount} invoices</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-xs uppercase text-muted-foreground">Collected</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-600">{money(summary.paidTotal)}</p>
            </div>
            <div className="col-span-2 rounded-lg border border-amber-200/60 bg-amber-50/50 p-4 dark:bg-amber-950/20">
              <p className="text-xs uppercase text-muted-foreground">Overdue</p>
              <p className="mt-2 text-2xl font-bold tabular-nums">{summary.overdueCount}</p>
              <p className="text-xs text-muted-foreground">Requires follow-up</p>
            </div>
          </div>
        </ChartCard>
      </div>

      {canManage && (
        <FormCard title="New invoice" onSubmit={createInvoice}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Customer</Label>
              <select className={SELECT_CLS} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Walk-in / none</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name ?? "Unnamed"}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Due date</Label>
              <DatePicker value={dueDate} onChange={setDueDate} />
            </div>
          </div>
          <div className="space-y-3">
            <Label>Lines</Label>
            {lines.map((line, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-5">
                <Input
                  className="sm:col-span-2"
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="Qty"
                  value={line.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Unit price"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                />
                <select
                  className={SELECT_CLS}
                  value={line.taxCodeId || defaultTaxCodeId}
                  onChange={(e) => updateLine(i, { taxCodeId: e.target.value })}
                >
                  {taxCodes.map((tc) => (
                    <option key={tc.id} value={tc.id}>{tc.code} ({tc.rate}%)</option>
                  ))}
                </select>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, { description: "", quantity: "1", unitPrice: "", taxCodeId: defaultTaxCodeId }])}>
              Add line
            </Button>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy === "create"}>Create draft</Button>
        </FormCard>
      )}

      <ReportSection
        title="Invoice register"
        subtitle={`${filtered.length} invoices`}
        actions={
          <ExportCsvButton
            filename="customer-invoices"
            rows={filtered.map((inv) => ({
              invoice_no: inv.invoice_no,
              customer: relationName(inv.customers as { name: string } | { name: string }[] | null) || "",
              invoice_date: inv.invoice_date,
              due_date: inv.due_date || "",
              status: inv.status,
              subtotal: inv.subtotal,
              tax: inv.tax_amount,
              total: inv.total,
            }))}
            columns={[
              { key: "invoice_no", label: "Invoice No" },
              { key: "customer", label: "Customer" },
              { key: "invoice_date", label: "Invoice Date" },
              { key: "due_date", label: "Due Date" },
              { key: "status", label: "Status" },
              { key: "subtotal", label: "Subtotal" },
              { key: "tax", label: "Tax" },
              { key: "total", label: "Total" },
            ]}
          />
        }
      >
        <TableToolbar search={search} onSearchChange={setSearch} placeholder="Search invoice or customer…" className="mb-4" />
        <ResponsiveTableLayout
          mobile={
            filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No invoices match your search.</p>
            ) : (
              filtered.map((inv) => (
                <MobileRecordCard key={inv.id}>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{inv.invoice_no}</p>
                      <p className="text-xs text-muted-foreground">
                        {relationName(inv.customers as { name: string } | { name: string }[] | null) || "—"}
                      </p>
                    </div>
                    <StatusBadge status={inv.status} />
                  </div>
                  <div className="space-y-1.5">
                    <MobileRecordCardRow label="Date">{inv.invoice_date}</MobileRecordCardRow>
                    <MobileRecordCardRow label="Due">{inv.due_date || "—"}</MobileRecordCardRow>
                    <MobileRecordCardRow label="Total">{money(inv.total)}</MobileRecordCardRow>
                    {isOpenInvoice(inv) && (
                      <MobileRecordCardRow label="Balance due">
                        <span className="font-mono text-amber-700">{money(invoiceBalanceDue(inv))}</span>
                      </MobileRecordCardRow>
                    )}
                  </div>
                  {canManage && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {inv.status === "draft" && (
                        <Button size="sm" variant="outline" disabled={!!busy} className="flex-1" onClick={() => postInvoice(inv.id)}>Post</Button>
                      )}
                      {isOpenInvoice(inv) && invoiceBalanceDue(inv) > 0.01 && (
                        <Button size="sm" disabled={!!busy} className="flex-1" onClick={() => openPayDialog(inv)}>
                          {inv.status === "partially_paid" ? "Pay balance" : "Collect"}
                        </Button>
                      )}
                    </div>
                  )}
                </MobileRecordCard>
              ))
            )
          }
        >
        <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Invoice</DataTableHead>
            <DataTableHead>Customer</DataTableHead>
            <DataTableHead>Date</DataTableHead>
            <DataTableHead>Due</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead align="right">Total</DataTableHead>
            <DataTableHead align="right">Balance</DataTableHead>
            {canManage && <DataTableHead align="right">Actions</DataTableHead>}
          </DataTableHeader>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={canManage ? 8 : 7} message="No invoices match your search." />
            ) : (
              filtered.map((inv) => (
                <DataTableRow key={inv.id}>
                  <DataTableCell className="font-medium">{inv.invoice_no}</DataTableCell>
                  <DataTableCell>{relationName(inv.customers as { name: string } | { name: string }[] | null) || "—"}</DataTableCell>
                  <DataTableCell>{inv.invoice_date}</DataTableCell>
                  <DataTableCell className="text-muted-foreground">{inv.due_date || "—"}</DataTableCell>
                  <DataTableCell><StatusBadge status={inv.status} /></DataTableCell>
                  <DataTableCell align="right">{money(inv.total)}</DataTableCell>
                  <DataTableCell align="right" className="font-mono text-amber-700">
                    {isOpenInvoice(inv) ? money(invoiceBalanceDue(inv)) : "—"}
                  </DataTableCell>
                  {canManage && (
                    <DataTableCell align="right" className="space-x-2">
                      {inv.status === "draft" && (
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => postInvoice(inv.id)}>Post</Button>
                      )}
                      {isOpenInvoice(inv) && invoiceBalanceDue(inv) > 0.01 && (
                        <Button size="sm" disabled={!!busy} onClick={() => openPayDialog(inv)}>
                          Collect
                        </Button>
                      )}
                    </DataTableCell>
                  )}
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>
      </ResponsiveTableLayout>
      </ReportSection>

      {payInvoiceId && (
        <FormCard
          title="Record payment"
          onSubmit={(e) => {
            e.preventDefault();
            void payInvoice(payInvoiceId, Number(payAmount) || undefined);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <select className={SELECT_CLS} value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Reference</Label>
              <Input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="Receipt / txn ID" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={!!busy}>Apply payment</Button>
            <Button type="button" variant="outline" onClick={() => setPayInvoiceId(null)}>Cancel</Button>
          </div>
        </FormCard>
      )}
        </>
      )}

      {mainTab === "collections" && (
        <ArCollectionsTab
          orgId={organizationId}
          currency={currency}
          canManage={canManage}
          queue={collectionsQueue}
        />
      )}

      {mainTab === "statements" && (
        <CustomerStatementPanel orgId={organizationId} currency={currency} customers={customers} />
      )}

      {mainTab === "credit_notes" && (
        <>
          {canManage && (
            <FormCard title="New credit note" onSubmit={createCreditNote}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Customer</Label>
                  <select className={SELECT_CLS} value={cnCustomerId} onChange={(e) => setCnCustomerId(e.target.value)} required>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name ?? "Unnamed"}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Settlement</Label>
                  <select className={SELECT_CLS} value={cnSettlement} onChange={(e) => setCnSettlement(e.target.value as typeof cnSettlement)}>
                    <option value="store_credit">Store credit liability</option>
                    <option value="ar">Reduce AR balance</option>
                    <option value="cash">Cash refund</option>
                  </select>
                </div>
              </div>
              <div className="space-y-3">
                <Label>Lines</Label>
                {cnLines.map((line, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-5">
                    <Input
                      className="sm:col-span-2"
                      placeholder="Description"
                      value={line.description}
                      onChange={(e) => setCnLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, description: e.target.value } : l)))}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) => setCnLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, quantity: e.target.value } : l)))}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Unit price"
                      value={line.unitPrice}
                      onChange={(e) => setCnLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, unitPrice: e.target.value } : l)))}
                    />
                    <select
                      className={SELECT_CLS}
                      value={line.taxCodeId || defaultTaxCodeId}
                      onChange={(e) => setCnLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, taxCodeId: e.target.value } : l)))}
                    >
                      {taxCodes.map((tc) => (
                        <option key={tc.id} value={tc.id}>{tc.code} ({tc.rate}%)</option>
                      ))}
                    </select>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCnLines((p) => [...p, { description: "", quantity: "1", unitPrice: "", taxCodeId: defaultTaxCodeId }])}
                >
                  Add line
                </Button>
              </div>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Input value={cnReason} onChange={(e) => setCnReason(e.target.value)} placeholder="Return, goodwill, price adjustment…" />
              </div>
              <Button type="submit" disabled={busy === "cn-create"}>Create draft</Button>
            </FormCard>
          )}

          <ReportSection title="Credit note register" subtitle={`${filteredCreditNotes.length} credit notes`}>
            <TableToolbar search={search} onSearchChange={setSearch} placeholder="Search credit note or customer…" className="mb-4" />
            <ResponsiveTableLayout
              mobile={
                filteredCreditNotes.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">No credit notes yet.</p>
                ) : (
                  filteredCreditNotes.map((cn) => (
                    <MobileRecordCard key={cn.id}>
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">{cn.credit_note_no}</p>
                          <p className="text-xs text-muted-foreground">
                            {relationName(cn.customers as { name: string } | { name: string }[] | null) || "—"}
                          </p>
                        </div>
                        <StatusBadge status={cn.status} />
                      </div>
                      <div className="space-y-1.5">
                        <MobileRecordCardRow label="Date">{cn.credit_date}</MobileRecordCardRow>
                        <MobileRecordCardRow label="Settlement">{cn.settlement_method.replace("_", " ")}</MobileRecordCardRow>
                        <MobileRecordCardRow label="Total">{money(cn.total)}</MobileRecordCardRow>
                      </div>
                      {canManage && cn.status === "draft" && (
                        <Button size="sm" variant="outline" disabled={!!busy} className="mt-3 w-full" onClick={() => postCreditNote(cn.id)}>
                          Post to ledger
                        </Button>
                      )}
                    </MobileRecordCard>
                  ))
                )
              }
            >
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Credit note</DataTableHead>
                  <DataTableHead>Customer</DataTableHead>
                  <DataTableHead>Date</DataTableHead>
                  <DataTableHead>Settlement</DataTableHead>
                  <DataTableHead>Status</DataTableHead>
                  <DataTableHead align="right">Total</DataTableHead>
                  {canManage && <DataTableHead align="right">Actions</DataTableHead>}
                </DataTableHeader>
                <DataTableBody>
                  {filteredCreditNotes.length === 0 ? (
                    <DataTableEmpty colSpan={canManage ? 7 : 6} message="No credit notes yet." />
                  ) : (
                    filteredCreditNotes.map((cn) => (
                      <DataTableRow key={cn.id}>
                        <DataTableCell className="font-medium">{cn.credit_note_no}</DataTableCell>
                        <DataTableCell>{relationName(cn.customers as { name: string } | { name: string }[] | null) || "—"}</DataTableCell>
                        <DataTableCell>{cn.credit_date}</DataTableCell>
                        <DataTableCell className="capitalize">{cn.settlement_method.replace("_", " ")}</DataTableCell>
                        <DataTableCell><StatusBadge status={cn.status} /></DataTableCell>
                        <DataTableCell align="right">{money(cn.total)}</DataTableCell>
                        {canManage && (
                          <DataTableCell align="right">
                            {cn.status === "draft" && (
                              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => postCreditNote(cn.id)}>
                                Post to ledger
                              </Button>
                            )}
                          </DataTableCell>
                        )}
                      </DataTableRow>
                    ))
                  )}
                </DataTableBody>
              </table>
            </DataTable>
            </ResponsiveTableLayout>
          </ReportSection>
        </>
      )}
    </div>
  );
}

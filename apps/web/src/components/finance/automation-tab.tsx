"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
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
import { formatCurrency } from "@/lib/utils";
import { SELECT_CLS } from "@/lib/ui-classes";
import type { AccountRow } from "@/components/finance/chart-of-accounts-tab";

export type RecurringJournalTemplate = {
  id: string;
  name: string;
  journal_code: string;
  memo: string | null;
  frequency: string;
  next_run_date: string;
  is_active: boolean;
};

export type InvoiceReminderRow = {
  id: string;
  invoice_no: string;
  customer_name: string | null;
  customer_email?: string | null;
  due_date: string;
  total: number;
  days_overdue: number;
};

export function AutomationTab({
  orgId,
  currency,
  canManage,
  accounts,
  journals,
  templates: initialTemplates,
  invoiceReminders: initialReminders,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  accounts: AccountRow[];
  journals: { id: string; code: string; name: string }[];
  templates: RecurringJournalTemplate[];
  invoiceReminders: InvoiceReminderRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);
  const [templates, setTemplates] = useState(initialTemplates);
  const [reminders, setReminders] = useState(initialReminders);
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [journalCode, setJournalCode] = useState(journals[0]?.code ?? "GEN");
  const [memo, setMemo] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [nextRun, setNextRun] = useState(new Date().toISOString().slice(0, 10));
  const [debitAcct, setDebitAcct] = useState(accounts.find((a) => a.type === "expense")?.id ?? "");
  const [creditAcct, setCreditAcct] = useState(accounts.find((a) => a.code === "1010")?.id ?? "");
  const [amount, setAmount] = useState("");

  const expenseAccounts = accounts.filter((a) => a.is_active);
  const assetAccounts = accounts.filter((a) => a.is_active && a.type === "asset");

  async function createTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !amount) return;
    setBusy("create");
    const supabase = createClient();
    const lines = [
      { accountId: debitAcct, debit: Number(amount), credit: 0, description: memo || name },
      { accountId: creditAcct, debit: 0, credit: Number(amount), description: memo || name },
    ];
    const { error } = await supabase.rpc("upsert_recurring_journal_template", {
      p_org_id: orgId,
      p_template_id: null,
      p_name: name.trim(),
      p_journal_code: journalCode,
      p_memo: memo || null,
      p_lines: lines,
      p_frequency: frequency,
      p_next_run_date: nextRun,
      p_is_active: true,
    });
    setBusy("");
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Recurring template created" });
    const { data } = await supabase.rpc("list_recurring_journal_templates", { p_org_id: orgId });
    setTemplates((data as RecurringJournalTemplate[]) ?? []);
    setName("");
    setAmount("");
    router.refresh();
  }

  async function runDue() {
    setBusy("run");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("run_recurring_journals", { p_org_id: orgId });
    setBusy("");
    if (error) {
      toast({ title: "Run failed", description: error.message, variant: "destructive" });
      return;
    }
    const posted = (data as { posted?: number })?.posted ?? 0;
    toast({ title: posted > 0 ? `Posted ${posted} recurring entr${posted === 1 ? "y" : "ies"}` : "No templates due" });
    const { data: list } = await supabase.rpc("list_recurring_journal_templates", { p_org_id: orgId });
    setTemplates((list as RecurringJournalTemplate[]) ?? []);
    router.refresh();
  }

  async function sendReminder(invoiceId: string) {
    setBusy(invoiceId);
    const supabase = createClient();
    const { error } = await supabase.rpc("enqueue_invoice_reminder_notification", {
      p_invoice_id: invoiceId,
    });
    setBusy("");
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Reminder queued",
      description: "Email will be sent when the notification worker runs (if email is enabled).",
    });
    const { data } = await supabase.rpc("list_invoices_needing_reminder", { p_org_id: orgId });
    setReminders((data as InvoiceReminderRow[]) ?? []);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <ReportSection title="Recurring journal entries" subtitle="Accruals, rent, allocations — run due templates from here">
        {canManage && (
          <form onSubmit={createTemplate} className="mb-6 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Template name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Monthly rent accrual" />
            </div>
            <div className="space-y-2">
              <Label>Journal</Label>
              <select className={SELECT_CLS} value={journalCode} onChange={(e) => setJournalCode(e.target.value)}>
                {journals.map((j) => (
                  <option key={j.id} value={j.code}>{j.code}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Frequency</Label>
              <select className={SELECT_CLS} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Next run date</Label>
              <DatePicker value={nextRun} onChange={setNextRun} />
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Debit account</Label>
              <select className={SELECT_CLS} value={debitAcct} onChange={(e) => setDebitAcct(e.target.value)}>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Credit account</Label>
              <select className={SELECT_CLS} value={creditAcct} onChange={(e) => setCreditAcct(e.target.value)}>
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy === "create"}>Save template</Button>
              <Button type="button" variant="outline" onClick={runDue} disabled={!!busy}>Run due now</Button>
            </div>
          </form>
        )}

        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead>Frequency</DataTableHead>
              <DataTableHead>Next run</DataTableHead>
              <DataTableHead>Status</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {templates.length === 0 ? (
                <DataTableEmpty colSpan={4} message="No recurring templates." />
              ) : (
                templates.map((t) => (
                  <DataTableRow key={t.id}>
                    <DataTableCell>{t.name}</DataTableCell>
                    <DataTableCell>{t.frequency}</DataTableCell>
                    <DataTableCell>{t.next_run_date}</DataTableCell>
                    <DataTableCell>{t.is_active ? "Active" : "Inactive"}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      <ReportSection title="Invoice payment reminders" subtitle="Overdue posted invoices not reminded in the last 7 days">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Invoice</DataTableHead>
              <DataTableHead>Customer</DataTableHead>
              <DataTableHead>Due</DataTableHead>
              <DataTableHead align="right">Amount</DataTableHead>
              {canManage && <DataTableHead align="right">Action</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {reminders.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 5 : 4} message="No invoices need a reminder right now." />
              ) : (
                reminders.map((r) => (
                  <DataTableRow key={r.id}>
                    <DataTableCell className="font-mono text-xs">{r.invoice_no}</DataTableCell>
                    <DataTableCell>
                      {r.customer_name ?? "—"}
                      {r.customer_email ? (
                        <p className="text-xs text-muted-foreground">{r.customer_email}</p>
                      ) : (
                        <p className="text-xs text-amber-600">No email on file</p>
                      )}
                    </DataTableCell>
                    <DataTableCell>{r.due_date} ({r.days_overdue}d)</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(r.total))}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!!busy || !r.customer_email}
                          onClick={() => sendReminder(r.id)}
                        >
                          Send reminder
                        </Button>
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>
    </div>
  );
}

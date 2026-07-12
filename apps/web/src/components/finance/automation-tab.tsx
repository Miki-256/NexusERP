"use client";

import Link from "next/link";
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

export type FinancialAutomationRule = {
  id: string;
  name: string;
  rule_type: string;
  config: Record<string, unknown>;
  is_active: boolean;
  cooldown_hours: number;
  last_evaluated_at?: string | null;
  last_triggered_at?: string | null;
};

export type FinancialScheduledReport = {
  id: string;
  name: string;
  report_type: string;
  preset: "daily" | "weekly" | "monthly";
  run_at_hour: number;
  run_at_minute: number;
  timezone: string;
  channels: string[];
  recipient_spec: Record<string, unknown>;
  export_format: "csv" | "pdf" | "xlsx";
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string;
};

const KPI_KEYS = ["revenue", "gross_profit", "net_profit", "cash", "liquid", "ar", "ap", "tax_payable"] as const;

const RULE_TYPES = [
  { value: "kpi_threshold", label: "KPI threshold" },
  { value: "cash_minimum", label: "Cash minimum" },
  { value: "ar_overdue", label: "AR overdue" },
  { value: "period_close_reminder", label: "Period close reminder" },
] as const;

const FINANCIAL_REPORT_TYPES = [
  { value: "financial.pnl", label: "GL P&L (MTD)" },
  { value: "financial.balance_sheet", label: "Balance sheet" },
  { value: "financial.executive", label: "Executive KPI summary" },
  { value: "financial.ar_aging", label: "AR aging" },
] as const;

function ruleSummary(rule: FinancialAutomationRule) {
  const c = rule.config ?? {};
  switch (rule.rule_type) {
    case "kpi_threshold":
    case "cash_minimum":
      return `${c.kpi_key ?? "net_profit"} ${c.operator ?? "lt"} ${c.threshold ?? 0}`;
    case "ar_overdue":
      return `60+ days total ≥ ${c.min_total ?? 0}`;
    case "period_close_reminder":
      return `${c.days_before_end ?? 3} days before period end`;
    default:
      return rule.rule_type;
  }
}

export function AutomationTab({
  orgId,
  currency,
  canManage,
  orgTimezone,
  accounts,
  journals,
  templates: initialTemplates,
  invoiceReminders: initialReminders,
  financialRules: initialRules,
  financialSchedules: initialSchedules,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  orgTimezone: string;
  accounts: AccountRow[];
  journals: { id: string; code: string; name: string }[];
  templates: RecurringJournalTemplate[];
  invoiceReminders: InvoiceReminderRow[];
  financialRules: FinancialAutomationRule[];
  financialSchedules: FinancialScheduledReport[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);
  const [templates, setTemplates] = useState(initialTemplates);
  const [reminders, setReminders] = useState(initialReminders);
  const [rules, setRules] = useState(initialRules);
  const [schedules, setSchedules] = useState(initialSchedules);
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [journalCode, setJournalCode] = useState(journals[0]?.code ?? "GEN");
  const [memo, setMemo] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [nextRun, setNextRun] = useState(new Date().toISOString().slice(0, 10));
  const [debitAcct, setDebitAcct] = useState(accounts.find((a) => a.type === "expense")?.id ?? "");
  const [creditAcct, setCreditAcct] = useState(accounts.find((a) => a.code === "1010")?.id ?? "");
  const [amount, setAmount] = useState("");

  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState<string>("kpi_threshold");
  const [ruleKpi, setRuleKpi] = useState<string>("net_profit");
  const [ruleOperator, setRuleOperator] = useState("lt");
  const [ruleThreshold, setRuleThreshold] = useState("0");

  const expenseAccounts = accounts.filter((a) => a.is_active);
  const assetAccounts = accounts.filter((a) => a.is_active && a.type === "asset");

  async function reloadFinancial() {
    const supabase = createClient();
    const [{ data: rulesData }, { data: schedulesData }] = await Promise.all([
      supabase.rpc("list_financial_automation_rules", { p_org_id: orgId }),
      supabase.rpc("list_financial_scheduled_reports", { p_org_id: orgId }),
    ]);
    setRules((rulesData as FinancialAutomationRule[]) ?? []);
    setSchedules((schedulesData as FinancialScheduledReport[]) ?? []);
    router.refresh();
  }

  async function evaluateRules() {
    setBusy("evaluate");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("evaluate_financial_automation_rules", {
      p_org_id: orgId,
    });
    setBusy("");
    if (error) {
      toast({ title: "Evaluation failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as { triggered?: number; evaluated?: number };
    toast({
      title: result.triggered ? `${result.triggered} alert(s) fired` : "No alerts triggered",
      description: `Evaluated ${result.evaluated ?? 0} active rule(s). Notifications queued when matched.`,
    });
    await reloadFinancial();
  }

  async function toggleRule(rule: FinancialAutomationRule) {
    if (!canManage) return;
    setBusy(rule.id);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_financial_automation_rule", {
      p_org_id: orgId,
      p_rule_id: rule.id,
      p_name: rule.name,
      p_rule_type: rule.rule_type,
      p_config: rule.config,
      p_is_active: !rule.is_active,
      p_cooldown_hours: rule.cooldown_hours,
    });
    setBusy("");
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    await reloadFinancial();
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !ruleName.trim()) return;
    const threshold = parseFloat(ruleThreshold);
    if (!Number.isFinite(threshold) && ruleType !== "period_close_reminder" && ruleType !== "ar_overdue") {
      toast({ title: "Invalid threshold", variant: "destructive" });
      return;
    }

    let config: Record<string, unknown> = {};
    if (ruleType === "kpi_threshold" || ruleType === "cash_minimum") {
      config = { kpi_key: ruleKpi, operator: ruleOperator, threshold };
    } else if (ruleType === "ar_overdue") {
      config = { min_days: 30, min_total: threshold || 1000 };
    } else if (ruleType === "period_close_reminder") {
      config = { days_before_end: parseInt(ruleThreshold, 10) || 3 };
    }

    setBusy("add-rule");
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_financial_automation_rule", {
      p_org_id: orgId,
      p_rule_id: null,
      p_name: ruleName.trim(),
      p_rule_type: ruleType,
      p_config: config,
      p_is_active: true,
      p_cooldown_hours: 24,
    });
    setBusy("");
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Alert rule created" });
    setRuleName("");
    await reloadFinancial();
  }

  async function toggleSchedule(schedule: FinancialScheduledReport) {
    if (!canManage) return;
    setBusy(schedule.id);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_financial_scheduled_report", {
      p_org_id: orgId,
      p_schedule_id: schedule.id,
      p_name: schedule.name,
      p_report_type: schedule.report_type,
      p_preset: schedule.preset,
      p_run_at_hour: schedule.run_at_hour,
      p_run_at_minute: schedule.run_at_minute,
      p_timezone: schedule.timezone || orgTimezone,
      p_channels: schedule.channels,
      p_recipient_spec: schedule.recipient_spec,
      p_export_format: schedule.export_format,
      p_is_active: !schedule.is_active,
    });
    setBusy("");
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: schedule.is_active ? "Schedule paused" : "Schedule activated" });
    await reloadFinancial();
  }

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
      <ReportSection
        title="Financial alert rules"
        subtitle="KPI thresholds, cash minimums, AR overdue, and period-close reminders — notifications via Communications"
        actions={
          canManage ? (
            <Button type="button" variant="outline" size="sm" onClick={evaluateRules} disabled={!!busy}>
              Evaluate now
            </Button>
          ) : undefined
        }
      >
        {canManage && (
          <form onSubmit={addRule} className="mb-6 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 sm:col-span-2">
              <Label>Rule name</Label>
              <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Net profit below target" required />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select className={SELECT_CLS} value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
                {RULE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            {(ruleType === "kpi_threshold" || ruleType === "cash_minimum") && (
              <div className="space-y-2">
                <Label>KPI</Label>
                <select className={SELECT_CLS} value={ruleKpi} onChange={(e) => setRuleKpi(e.target.value)}>
                  {KPI_KEYS.map((k) => (
                    <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            )}
            {(ruleType === "kpi_threshold" || ruleType === "cash_minimum") && (
              <div className="space-y-2">
                <Label>Operator</Label>
                <select className={SELECT_CLS} value={ruleOperator} onChange={(e) => setRuleOperator(e.target.value)}>
                  <option value="lt">&lt;</option>
                  <option value="lte">≤</option>
                  <option value="gt">&gt;</option>
                  <option value="gte">≥</option>
                  <option value="eq">=</option>
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label>{ruleType === "period_close_reminder" ? "Days before end" : ruleType === "ar_overdue" ? "Min overdue total" : "Threshold"}</Label>
              <Input type="number" step="0.01" value={ruleThreshold} onChange={(e) => setRuleThreshold(e.target.value)} />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={busy === "add-rule"}>Add alert rule</Button>
            </div>
          </form>
        )}

        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead>Type</DataTableHead>
                <DataTableHead>Condition</DataTableHead>
                <DataTableHead>Last triggered</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                {canManage && <DataTableHead align="right">Action</DataTableHead>}
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {rules.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="No financial alert rules." />
              ) : (
                rules.map((rule) => (
                  <DataTableRow key={rule.id}>
                    <DataTableCell className="font-medium">{rule.name}</DataTableCell>
                    <DataTableCell>{rule.rule_type.replace(/_/g, " ")}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">{ruleSummary(rule)}</DataTableCell>
                    <DataTableCell>{rule.last_triggered_at ? new Date(rule.last_triggered_at).toLocaleString() : "—"}</DataTableCell>
                    <DataTableCell>{rule.is_active ? "Active" : "Inactive"}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => toggleRule(rule)}>
                          {rule.is_active ? "Pause" : "Activate"}
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

      <ReportSection
        title="Scheduled financial reports"
        subtitle="GL P&L, balance sheet, executive summary, and AR aging — delivered via email or in-app"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/communications/schedules">All schedules</Link>
          </Button>
        }
      >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead>Report</DataTableHead>
                <DataTableHead>Cadence</DataTableHead>
                <DataTableHead>Format</DataTableHead>
                <DataTableHead>Next run</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                {canManage && <DataTableHead align="right">Action</DataTableHead>}
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {schedules.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 7 : 6} message="No financial report schedules." />
              ) : (
                schedules.map((s) => (
                  <DataTableRow key={s.id}>
                    <DataTableCell className="font-medium">{s.name}</DataTableCell>
                    <DataTableCell>
                      {FINANCIAL_REPORT_TYPES.find((t) => t.value === s.report_type)?.label ?? s.report_type}
                    </DataTableCell>
                    <DataTableCell>{s.preset}</DataTableCell>
                    <DataTableCell>{s.export_format.toUpperCase()}</DataTableCell>
                    <DataTableCell>{new Date(s.next_run_at).toLocaleString()}</DataTableCell>
                    <DataTableCell>{s.is_active ? "Active" : "Inactive"}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => toggleSchedule(s)}>
                          {s.is_active ? "Pause" : "Activate"}
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

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { StatCard } from "@/components/layout/stat-card";
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
import { FileCheck, Percent, Receipt } from "lucide-react";

export type TaxCodeRow = {
  id: string;
  code: string;
  name: string;
  rate: number;
  tax_type?: string;
  jurisdiction?: string | null;
  is_recoverable?: boolean;
  is_active: boolean;
};

export type TaxSummaryLine = {
  code: string;
  name: string;
  rate: number;
  taxable_base: number;
  tax_collected: number;
};

export type TaxComplianceSettings = {
  tax_id?: string | null;
  tax_rate?: number;
  tax_inclusive?: boolean;
  einvoice_enabled?: boolean;
  einvoice_provider?: string;
  tax_filing_frequency?: string;
};

export type VatLiabilityReport = {
  output_tax: number;
  input_tax: number;
  net_payable: number;
  output_lines?: { code: string; name: string; rate: number; taxable_base: number; tax_amount: number }[];
  input_lines?: { code: string; name: string; rate: number; taxable_base: number; tax_amount: number }[];
};

export type TaxReturnPeriod = {
  id: string;
  return_type: string;
  period_from: string;
  period_to: string;
  status: string;
  output_tax: number;
  input_tax: number;
  net_payable: number;
  notes?: string | null;
  filed_at?: string | null;
};

export type EinvoiceDocument = {
  id: string;
  source_type: string;
  source_id: string;
  document_number: string;
  provider: string;
  status: string;
  external_id?: string | null;
  error_message?: string | null;
  submitted_at?: string | null;
  accepted_at?: string | null;
  invoice_total?: number | null;
  invoice_date?: string | null;
};

export type PendingEinvoiceInvoice = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  total: number;
  tax_amount: number;
  status: string;
};

export type WithholdingRule = {
  id: string;
  name: string;
  rate: number;
  applies_to: string;
  is_active: boolean;
};

const TAX_TYPES = ["output", "input", "withholding"] as const;
const EINVOICE_PROVIDERS = [
  { value: "internal", label: "Internal (stub)" },
  { value: "peppol", label: "PEPPOL" },
  { value: "ethiopia_erca", label: "Ethiopia ERCA" },
] as const;

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: "text-muted-foreground",
    filed: "text-blue-600",
    paid: "text-green-600",
    accepted: "text-green-600",
    submitted: "text-amber-600",
    pending: "text-amber-600",
    rejected: "text-destructive",
    cancelled: "text-muted-foreground",
  };
  return map[status] ?? "";
}

export function TaxTab({
  orgId,
  currency,
  canManage,
  from,
  to,
  taxCodes: initialCodes,
  taxSummary,
  complianceSettings,
  vatLiability,
  taxReturns,
  einvoiceDocuments,
  pendingEinvoices,
  withholdingRules: initialWithholding,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  from: string;
  to: string;
  taxCodes: TaxCodeRow[];
  taxSummary: { total_tax: number; input_tax?: number; net_payable?: number; lines: TaxSummaryLine[] };
  complianceSettings: TaxComplianceSettings;
  vatLiability: VatLiabilityReport;
  taxReturns: TaxReturnPeriod[];
  einvoiceDocuments: EinvoiceDocument[];
  pendingEinvoices: PendingEinvoiceInvoice[];
  withholdingRules: WithholdingRule[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);
  const [codes, setCodes] = useState(initialCodes);
  const [withholding, setWithholding] = useState(initialWithholding);
  const [settings, setSettings] = useState(complianceSettings);
  const [returns, setReturns] = useState(taxReturns);
  const [einvDocs, setEinvDocs] = useState(einvoiceDocuments);
  const [pending, setPending] = useState(pendingEinvoices);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [taxType, setTaxType] = useState<string>("output");
  const [jurisdiction, setJurisdiction] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [taxId, setTaxId] = useState(settings.tax_id ?? "");
  const [einvoiceEnabled, setEinvoiceEnabled] = useState(settings.einvoice_enabled ?? false);
  const [einvoiceProvider, setEinvoiceProvider] = useState(settings.einvoice_provider ?? "internal");
  const [filingFrequency, setFilingFrequency] = useState(settings.tax_filing_frequency ?? "monthly");

  const [whName, setWhName] = useState("");
  const [whRate, setWhRate] = useState("");
  const [whAppliesTo, setWhAppliesTo] = useState("vendor_payments");
  const [busy, setBusy] = useState(false);

  const summaryLines = taxSummary.lines ?? [];
  const outputTax = Number(vatLiability.output_tax ?? taxSummary.total_tax ?? 0);
  const inputTax = Number(vatLiability.input_tax ?? taxSummary.input_tax ?? 0);
  const netPayable = Number(vatLiability.net_payable ?? taxSummary.net_payable ?? outputTax - inputTax);
  const activeCount = useMemo(() => codes.filter((c) => c.is_active).length, [codes]);

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setRate("");
    setTaxType("output");
    setJurisdiction("");
    setIsActive(true);
  }

  function startEdit(row: TaxCodeRow) {
    setEditingId(row.id);
    setCode(row.code);
    setName(row.name);
    setRate(String(row.rate));
    setTaxType(row.tax_type ?? "output");
    setJurisdiction(row.jurisdiction ?? "");
    setIsActive(row.is_active);
  }

  async function handleSaveCode(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const parsedRate = parseFloat(rate);
    if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      toast({ title: "Invalid rate", description: "Rate must be 0–100.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_tax_code", {
      p_org_id: orgId,
      p_tax_code_id: editingId,
      p_code: code.trim(),
      p_name: name.trim(),
      p_rate: parsedRate,
      p_is_active: isActive,
      p_tax_type: taxType,
      p_jurisdiction: jurisdiction.trim() || null,
      p_is_recoverable: true,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Tax code updated" : "Tax code created" });
    const { data: list } = await supabase.rpc("list_tax_codes", { p_org_id: orgId });
    setCodes((list as TaxCodeRow[]) ?? []);
    resetForm();
    router.refresh();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("update_tax_compliance_settings", {
      p_org_id: orgId,
      p_tax_id: taxId.trim() || null,
      p_einvoice_enabled: einvoiceEnabled,
      p_einvoice_provider: einvoiceProvider,
      p_tax_filing_frequency: filingFrequency,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Settings failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Tax settings saved" });
    setSettings({
      ...settings,
      tax_id: taxId.trim() || null,
      einvoice_enabled: einvoiceEnabled,
      einvoice_provider: einvoiceProvider,
      tax_filing_frequency: filingFrequency,
    });
    router.refresh();
  }

  async function createReturn() {
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_tax_return_period", {
      p_org_id: orgId,
      p_from: from,
      p_to: to,
      p_return_type: "vat",
    });
    setBusy(false);
    if (error) {
      toast({ title: "Return draft failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "VAT return draft created", description: `Period ${from} → ${to}` });
    const { data: list } = await supabase.rpc("list_tax_return_periods", { p_org_id: orgId });
    setReturns((list as TaxReturnPeriod[]) ?? []);
    void data;
    router.refresh();
  }

  async function fileReturn(returnId: string) {
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("file_tax_return", { p_return_id: returnId });
    setBusy(false);
    if (error) {
      toast({ title: "Filing failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Tax return marked as filed" });
    const { data: list } = await supabase.rpc("list_tax_return_periods", { p_org_id: orgId });
    setReturns((list as TaxReturnPeriod[]) ?? []);
    router.refresh();
  }

  async function submitEinvoice(invoiceId: string) {
    if (!canManage) return;
    if (!einvoiceEnabled) {
      toast({ title: "E-invoicing disabled", description: "Enable e-invoicing in settings first.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_einvoice", { p_org_id: orgId, p_invoice_id: invoiceId });
    setBusy(false);
    if (error) {
      toast({ title: "Submit failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "E-invoice submitted" });
    const [{ data: docs }, { data: pend }] = await Promise.all([
      supabase.rpc("list_einvoice_documents", { p_org_id: orgId }),
      supabase.rpc("list_invoices_pending_einvoice", { p_org_id: orgId }),
    ]);
    setEinvDocs((docs as EinvoiceDocument[]) ?? []);
    setPending((pend as PendingEinvoiceInvoice[]) ?? []);
    router.refresh();
  }

  async function saveWithholding(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const parsedRate = parseFloat(whRate);
    if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      toast({ title: "Invalid rate", variant: "destructive" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_withholding_tax_rule", {
      p_org_id: orgId,
      p_rule_id: null,
      p_name: whName.trim(),
      p_rate: parsedRate,
      p_applies_to: whAppliesTo,
      p_is_active: true,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Rule save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Withholding rule added" });
    setWhName("");
    setWhRate("");
    const { data: list } = await supabase.rpc("list_withholding_tax_rules", { p_org_id: orgId });
    setWithholding((list as WithholdingRule[]) ?? []);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Output tax" value={money(outputTax)} sub={`${from} → ${to}`} icon={Percent} />
        <StatCard label="Input tax" value={money(inputTax)} sub="Recoverable AP VAT" icon={Receipt} />
        <StatCard label="Net payable" value={money(netPayable)} sub="Output − input" icon={FileCheck} />
        <StatCard label="Tax codes" value={String(codes.length)} sub={`${activeCount} active`} icon={Percent} />
      </div>

      {canManage && (
        <ReportSection title="Compliance settings" subtitle="Registration, e-invoicing provider, and filing frequency">
          <form onSubmit={saveSettings} className="grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Tax registration (TIN/VAT)</Label>
              <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="Tax ID" />
            </div>
            <div className="space-y-2">
              <Label>Filing frequency</Label>
              <select
                value={filingFrequency}
                onChange={(e) => setFilingFrequency(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>E-invoice provider</Label>
              <select
                value={einvoiceProvider}
                onChange={(e) => setEinvoiceProvider(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {EINVOICE_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3">
              <input
                type="checkbox"
                checked={einvoiceEnabled}
                onChange={(e) => setEinvoiceEnabled(e.target.checked)}
                className="rounded border-input"
              />
              Enable e-invoicing for posted customer invoices
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</Button>
            </div>
          </form>
        </ReportSection>
      )}

      <ReportSection title="VAT liability" subtitle="Output tax from AR and input tax from posted vendor bills">
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Output (AR)</DataTableHead>
                <DataTableHead align="right">Base</DataTableHead>
                <DataTableHead align="right">Tax</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {(vatLiability.output_lines ?? summaryLines).length === 0 ? (
                  <DataTableEmpty colSpan={3} message="No output tax in period." />
                ) : (
                  (vatLiability.output_lines ?? summaryLines.map((r) => ({
                    code: r.code,
                    name: r.name,
                    rate: r.rate,
                    taxable_base: r.taxable_base,
                    tax_amount: r.tax_collected,
                  }))).map((row, i) => (
                    <DataTableRow key={`out-${row.code}-${i}`}>
                      <DataTableCell>{row.code} — {row.name}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(row.taxable_base))}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(row.tax_amount))}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Input (AP)</DataTableHead>
                <DataTableHead align="right">Base</DataTableHead>
                <DataTableHead align="right">Tax</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {(vatLiability.input_lines ?? []).length === 0 ? (
                  <DataTableEmpty colSpan={3} message="No input tax on vendor bills in period." />
                ) : (
                  (vatLiability.input_lines ?? []).map((row, i) => (
                    <DataTableRow key={`in-${row.code}-${i}`}>
                      <DataTableCell>{row.code} — {row.name}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(row.taxable_base))}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(row.tax_amount))}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </div>
      </ReportSection>

      <ReportSection
        title="Tax returns"
        subtitle="Draft VAT returns from the selected financial period"
        actions={
          canManage ? (
            <Button size="sm" onClick={createReturn} disabled={busy}>
              Create draft return
            </Button>
          ) : undefined
        }
      >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Period</DataTableHead>
              <DataTableHead align="right">Output</DataTableHead>
              <DataTableHead align="right">Input</DataTableHead>
              <DataTableHead align="right">Net</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {returns.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="No tax returns yet." />
              ) : (
                returns.map((row) => (
                  <DataTableRow key={row.id}>
                    <DataTableCell className="font-mono text-xs">{row.period_from} → {row.period_to}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.output_tax))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.input_tax))}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">{money(Number(row.net_payable))}</DataTableCell>
                    <DataTableCell className={statusBadge(row.status)}>{row.status}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        {row.status === "draft" && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => fileReturn(row.id)}>
                            Mark filed
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
      </ReportSection>

      <ReportSection title="E-invoicing" subtitle="Submit posted invoices to the configured provider (internal stub accepts immediately)">
        {canManage && pending.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-sm text-muted-foreground">{pending.length} invoice(s) pending e-invoice</p>
            <DataTable>
              <table className="w-full">
                <DataTableHeader>
                  <DataTableHead>Invoice</DataTableHead>
                  <DataTableHead>Date</DataTableHead>
                  <DataTableHead align="right">Total</DataTableHead>
                  <DataTableHead align="right">Actions</DataTableHead>
                </DataTableHeader>
                <DataTableBody>
                  {pending.slice(0, 10).map((inv) => (
                    <DataTableRow key={inv.id}>
                      <DataTableCell className="font-mono text-xs">{inv.invoice_no}</DataTableCell>
                      <DataTableCell>{inv.invoice_date}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">{money(Number(inv.total))}</DataTableCell>
                      <DataTableCell align="right">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => submitEinvoice(inv.id)}>
                          Submit
                        </Button>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </table>
            </DataTable>
          </div>
        )}
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Document</DataTableHead>
              <DataTableHead>Provider</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead>External ID</DataTableHead>
              <DataTableHead align="right">Total</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {einvDocs.length === 0 ? (
                <DataTableEmpty colSpan={5} message="No e-invoice submissions yet." />
              ) : (
                einvDocs.map((doc) => (
                  <DataTableRow key={doc.id}>
                    <DataTableCell className="font-mono text-xs">{doc.document_number}</DataTableCell>
                    <DataTableCell>{doc.provider}</DataTableCell>
                    <DataTableCell className={statusBadge(doc.status)}>{doc.status}</DataTableCell>
                    <DataTableCell className="font-mono text-xs">{doc.external_id ?? "—"}</DataTableCell>
                    <DataTableCell align="right" className="font-mono">
                      {doc.invoice_total != null ? money(Number(doc.invoice_total)) : "—"}
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      <ReportSection title="Tax codes" subtitle="Output, input, and withholding codes for AR/AP lines">
        {canManage && (
          <form onSubmit={handleSaveCode} className="mb-6 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="VAT15" disabled={!!editingId} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="VAT 15%" />
            </div>
            <div className="space-y-2">
              <Label>Rate %</Label>
              <Input type="number" min={0} max={100} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select
                value={taxType}
                onChange={(e) => setTaxType(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {TAX_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Jurisdiction</Label>
              <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="Optional" />
            </div>
            <label className="flex items-center gap-2 text-sm sm:mt-8">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-input" />
              Active
            </label>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : editingId ? "Update code" : "Add code"}</Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
              )}
            </div>
          </form>
        )}

        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Code</DataTableHead>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead>Type</DataTableHead>
              <DataTableHead align="right">Rate</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {codes.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="No tax codes." />
              ) : (
                codes.map((row) => (
                  <DataTableRow key={row.id}>
                    <DataTableCell className="font-mono text-xs">{row.code}</DataTableCell>
                    <DataTableCell>{row.name}</DataTableCell>
                    <DataTableCell>{row.tax_type ?? "output"}</DataTableCell>
                    <DataTableCell align="right">{Number(row.rate)}%</DataTableCell>
                    <DataTableCell>{row.is_active ? "Active" : "Inactive"}</DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(row)}>Edit</Button>
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </ReportSection>

      {canManage && (
        <ReportSection title="Withholding tax rules" subtitle="Rules for vendor payment and customer invoice withholding">
          <form onSubmit={saveWithholding} className="mb-4 grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={whName} onChange={(e) => setWhName(e.target.value)} required placeholder="WHT 2%" />
            </div>
            <div className="space-y-2">
              <Label>Rate %</Label>
              <Input type="number" min={0} max={100} step="0.01" value={whRate} onChange={(e) => setWhRate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Applies to</Label>
              <select
                value={whAppliesTo}
                onChange={(e) => setWhAppliesTo(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="vendor_payments">Vendor payments</option>
                <option value="customer_invoices">Customer invoices</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={busy}>Add rule</Button>
            </div>
          </form>
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead align="right">Rate</DataTableHead>
                <DataTableHead>Applies to</DataTableHead>
                <DataTableHead>Status</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {withholding.length === 0 ? (
                  <DataTableEmpty colSpan={4} message="No withholding rules." />
                ) : (
                  withholding.map((row) => (
                    <DataTableRow key={row.id}>
                      <DataTableCell>{row.name}</DataTableCell>
                      <DataTableCell align="right">{Number(row.rate)}%</DataTableCell>
                      <DataTableCell>{row.applies_to.replace(/_/g, " ")}</DataTableCell>
                      <DataTableCell>{row.is_active ? "Active" : "Inactive"}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ReportSection>
      )}
    </div>
  );
}

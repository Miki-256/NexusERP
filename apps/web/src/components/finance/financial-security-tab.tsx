"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Shield, ShieldCheck } from "lucide-react";

export type FinancialSecuritySettings = {
  je_requires_approval: boolean;
  je_dual_approval_enabled: boolean;
  je_dual_approval_threshold: number | null;
  ap_dual_approval_enabled: boolean;
  ap_dual_approval_threshold: number | null;
  sod_enforcement_enabled: boolean;
};

export type SodConflictRule = {
  id: string;
  name: string;
  action_create: string;
  action_approve: string;
  block_same_user: boolean;
  severity: string;
  is_active: boolean;
};

export type PendingApprovalItem = {
  id: string;
  entity_type: string;
  reference: string;
  amount: number;
  date: string;
  dual_approval_required: boolean;
  approvals_received: number;
  created_by?: string | null;
  status?: string;
};

export type PendingFinancialApprovals = {
  journal_entries: PendingApprovalItem[];
  payment_runs: PendingApprovalItem[];
};

export function FinancialSecurityTab({
  orgId,
  currency,
  canManage,
  settings: initialSettings,
  sodRules: initialSodRules,
  pendingApprovals: initialPending,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  settings: FinancialSecuritySettings;
  sodRules: SodConflictRule[];
  pendingApprovals: PendingFinancialApprovals;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currency);

  const [settings, setSettings] = useState(initialSettings);
  const [sodRules, setSodRules] = useState(initialSodRules);
  const [pending, setPending] = useState(initialPending);
  const [busy, setBusy] = useState(false);

  const pendingItems = [
    ...(pending.journal_entries ?? []).map((j) => ({ ...j, kind: "Journal" as const })),
    ...(pending.payment_runs ?? []).map((p) => ({ ...p, kind: "Payment run" as const })),
  ];

  async function reloadAll() {
    const supabase = createClient();
    const [{ data: sec }, { data: sod }, { data: queue }] = await Promise.all([
      supabase.rpc("get_financial_security_settings", { p_org_id: orgId }),
      supabase.rpc("list_sod_conflict_rules", { p_org_id: orgId }),
      supabase.rpc("list_pending_financial_approvals", { p_org_id: orgId }),
    ]);
    setSettings((sec as FinancialSecuritySettings) ?? settings);
    setSodRules((sod as SodConflictRule[]) ?? []);
    setPending((queue as PendingFinancialApprovals) ?? { journal_entries: [], payment_runs: [] });
    router.refresh();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_financial_security_settings", {
      p_org_id: orgId,
      p_je_requires_approval: settings.je_requires_approval,
      p_je_dual_approval_enabled: settings.je_dual_approval_enabled,
      p_je_dual_approval_threshold: settings.je_dual_approval_threshold,
      p_ap_dual_approval_enabled: settings.ap_dual_approval_enabled,
      p_ap_dual_approval_threshold: settings.ap_dual_approval_threshold,
      p_sod_enforcement_enabled: settings.sod_enforcement_enabled,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setSettings(data as FinancialSecuritySettings);
    toast({ title: "Security settings saved" });
    router.refresh();
  }

  async function approveItem(item: PendingApprovalItem) {
    setBusy(true);
    const supabase = createClient();
    const { error } =
      item.entity_type === "journal_entry"
        ? await supabase.rpc("approve_journal_entry", { p_entry_id: item.id })
        : await supabase.rpc("approve_payment_run", { p_run_id: item.id });
    setBusy(false);
    if (error) {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: item.dual_approval_required && item.approvals_received < 1
        ? "First approval recorded"
        : "Approved",
    });
    await reloadAll();
  }

  async function toggleSodRule(rule: SodConflictRule) {
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_sod_conflict_rule", {
      p_org_id: orgId,
      p_rule_id: rule.id,
      p_name: rule.name,
      p_action_create: rule.action_create,
      p_action_approve: rule.action_approve,
      p_is_active: !rule.is_active,
      p_severity: rule.severity,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    await reloadAll();
  }

  function approvalLabel(item: PendingApprovalItem) {
    if (!item.dual_approval_required) return "Approve";
    if (item.approvals_received < 1) return "First approval";
    return "Final approval";
  }

  return (
    <div className="space-y-6">
      <ReportSection
        title="Approval controls"
        subtitle="Journal entry workflow, dual approval thresholds, and SoD enforcement"
      >
        {canManage ? (
          <form onSubmit={saveSettings} className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-lg border border-border/60 px-4 py-3">
              <input
                type="checkbox"
                checked={settings.je_requires_approval}
                onChange={(e) => setSettings((s) => ({ ...s, je_requires_approval: e.target.checked }))}
              />
              <span className="text-sm">Require approval for manual journal entries</span>
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-border/60 px-4 py-3">
              <input
                type="checkbox"
                checked={settings.je_dual_approval_enabled}
                onChange={(e) => setSettings((s) => ({ ...s, je_dual_approval_enabled: e.target.checked }))}
              />
              <span className="text-sm">Dual approval for journal entries</span>
            </label>
            <div className="space-y-2">
              <Label>JE dual-approval threshold (blank = all drafts)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={settings.je_dual_approval_threshold ?? ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    je_dual_approval_threshold: e.target.value ? parseFloat(e.target.value) : null,
                  }))
                }
                placeholder="All amounts"
              />
            </div>
            <label className="flex items-center gap-3 rounded-lg border border-border/60 px-4 py-3">
              <input
                type="checkbox"
                checked={settings.ap_dual_approval_enabled}
                onChange={(e) => setSettings((s) => ({ ...s, ap_dual_approval_enabled: e.target.checked }))}
              />
              <span className="text-sm">Dual approval for AP payment runs</span>
            </label>
            <div className="space-y-2">
              <Label>AP dual-approval threshold</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={settings.ap_dual_approval_threshold ?? ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    ap_dual_approval_threshold: e.target.value ? parseFloat(e.target.value) : null,
                  }))
                }
              />
            </div>
            <label className="flex items-center gap-3 rounded-lg border border-border/60 px-4 py-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={settings.sod_enforcement_enabled}
                onChange={(e) => setSettings((s) => ({ ...s, sod_enforcement_enabled: e.target.checked }))}
              />
              <span className="text-sm">Enforce segregation of duties (block creator self-approval)</span>
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Save security settings
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">JE approval required</dt><dd>{settings.je_requires_approval ? "Yes" : "No"}</dd></div>
            <div><dt className="text-muted-foreground">JE dual approval</dt><dd>{settings.je_dual_approval_enabled ? "Yes" : "No"}</dd></div>
            <div><dt className="text-muted-foreground">AP dual approval</dt><dd>{settings.ap_dual_approval_enabled ? "Yes" : "No"}</dd></div>
            <div><dt className="text-muted-foreground">SoD enforcement</dt><dd>{settings.sod_enforcement_enabled ? "Active" : "Off"}</dd></div>
          </dl>
        )}
      </ReportSection>

      <ReportSection
        title="Pending approvals"
        subtitle="Journal drafts and AP payment runs awaiting action"
      >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead>Type</DataTableHead>
                <DataTableHead>Reference</DataTableHead>
                <DataTableHead>Date</DataTableHead>
                <DataTableHead className="text-right">Amount</DataTableHead>
                <DataTableHead>Progress</DataTableHead>
                {canManage && <DataTableHead className="text-right">Action</DataTableHead>}
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {pendingItems.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="No pending financial approvals." />
              ) : (
                pendingItems.map((item) => (
                  <DataTableRow key={`${item.entity_type}-${item.id}`}>
                    <DataTableCell>{item.kind}</DataTableCell>
                    <DataTableCell className="max-w-xs truncate">{item.reference}</DataTableCell>
                    <DataTableCell>{item.date}</DataTableCell>
                    <DataTableCell className="text-right tabular-nums">{money(item.amount)}</DataTableCell>
                    <DataTableCell>
                      {item.dual_approval_required
                        ? `${item.approvals_received}/2 approvals`
                        : `${item.approvals_received}/1`}
                    </DataTableCell>
                    {canManage && (
                      <DataTableCell className="text-right">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => approveItem(item)}>
                          {approvalLabel(item)}
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
        title="Segregation of duties rules"
        subtitle="Prevent the same user from creating and approving the same transaction"
      >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead>Rule</DataTableHead>
                <DataTableHead>Create action</DataTableHead>
                <DataTableHead>Blocked action</DataTableHead>
                <DataTableHead>Severity</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                {canManage && <DataTableHead className="text-right">Action</DataTableHead>}
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {sodRules.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 6 : 5} message="No SoD rules configured." />
              ) : (
                sodRules.map((rule) => (
                  <DataTableRow key={rule.id}>
                    <DataTableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        {rule.is_active ? (
                          <ShieldCheck className="h-4 w-4 text-success" />
                        ) : (
                          <Shield className="h-4 w-4 text-muted-foreground" />
                        )}
                        {rule.name}
                      </span>
                    </DataTableCell>
                    <DataTableCell className="font-mono text-xs">{rule.action_create}</DataTableCell>
                    <DataTableCell className="font-mono text-xs">{rule.action_approve}</DataTableCell>
                    <DataTableCell>{rule.severity}</DataTableCell>
                    <DataTableCell>{rule.is_active ? "Active" : "Inactive"}</DataTableCell>
                    {canManage && (
                      <DataTableCell className="text-right">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggleSodRule(rule)}>
                          {rule.is_active ? "Disable" : "Enable"}
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

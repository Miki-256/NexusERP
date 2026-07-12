"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { StatCard } from "@/components/layout/stat-card";
import { formatCurrency } from "@/lib/utils";
import { AlertTriangle, Layers } from "lucide-react";

export type ConsolidationGroup = {
  id: string;
  name: string;
  reporting_currency?: string;
  elimination_method?: string;
  members: {
    id: string;
    name: string;
    currency?: string;
    ownership_percent?: number;
    member_role?: string;
  }[];
};

export type OrgOption = { id: string; name: string; currency: string };

export type IntercompanyRelationship = {
  id: string;
  from_org_id: string;
  from_org_name: string;
  to_org_id: string;
  to_org_name: string;
};

export type IntercompanyTransaction = {
  id: string;
  from_org_name: string;
  to_org_name: string;
  transaction_date: string;
  amount: number;
  currency: string;
  description: string | null;
  status: string;
};

export function ConsolidationTab({
  orgId,
  currency,
  canManage,
  from,
  to,
  groups: initialGroups,
  myOrganizations,
  consolidatedPnl,
  consolidatedBs,
  intercompanyRelationships: initialIcRels,
  intercompanyTransactions: initialIcTx,
}: {
  orgId: string;
  currency: string;
  canManage: boolean;
  from: string;
  to: string;
  groups: ConsolidationGroup[];
  myOrganizations: OrgOption[];
  consolidatedPnl: {
    revenue?: number;
    net_profit?: number;
    reporting_currency?: string;
    mixed_currency?: boolean;
    translation_applied?: boolean;
    organizations?: {
      name: string;
      currency?: string;
      translated_net_profit?: number;
      original_net_profit?: number;
    }[];
  } | null;
  consolidatedBs: {
    total_assets?: number;
    total_equity?: number;
    reporting_currency?: string;
    mixed_currency?: boolean;
    ic_elimination?: number;
    organizations?: {
      name: string;
      currency?: string;
      translated_total_assets?: number;
    }[];
  } | null;
  intercompanyRelationships: IntercompanyRelationship[];
  intercompanyTransactions: IntercompanyTransaction[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const reportingCurrency = consolidatedPnl?.reporting_currency ?? consolidatedBs?.reporting_currency ?? currency;
  const money = (n: number | undefined) => formatCurrency(n ?? 0, reportingCurrency);

  const [groups, setGroups] = useState(initialGroups);
  const [selectedId, setSelectedId] = useState(initialGroups[0]?.id ?? "");
  const [groupName, setGroupName] = useState("");
  const [reportingCurrencyInput, setReportingCurrencyInput] = useState(currency);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [icMatrix, setIcMatrix] = useState<{
    total_ic_receivable?: number;
    total_ic_payable?: number;
    elimination_amount?: number;
    organizations?: { name: string; ic_receivable: number; ic_payable: number }[];
  } | null>(null);
  const [icTx, setIcTx] = useState(initialIcTx);
  const [icFromOrg, setIcFromOrg] = useState("");
  const [icToOrg, setIcToOrg] = useState("");
  const [icAmount, setIcAmount] = useState("");
  const [icDate, setIcDate] = useState(to);
  const [icDescription, setIcDescription] = useState("");

  const selectedGroup = groups.find((g) => g.id === selectedId);
  const otherOrgs = useMemo(
    () => myOrganizations.filter((o) => o.id !== orgId),
    [myOrganizations, orgId]
  );

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function saveGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !groupName.trim() || memberIds.length === 0) return;
    setBusy("group");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("upsert_consolidation_group", {
      p_org_id: orgId,
      p_group_id: null,
      p_name: groupName.trim(),
      p_member_org_ids: memberIds.map((id) => {
        const org = myOrganizations.find((o) => o.id === id);
        return { id, ownership_percent: 100, member_role: "subsidiary", currency: org?.currency };
      }),
      p_reporting_currency: reportingCurrencyInput.toUpperCase(),
      p_elimination_method: "virtual",
    });
    setBusy("");
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Consolidation group created" });
    setGroupName("");
    setMemberIds([]);
    const { data: list } = await supabase.rpc("list_consolidation_groups", { p_org_id: orgId });
    const next = (list as ConsolidationGroup[]) ?? [];
    setGroups(next);
    if (data) setSelectedId(data as string);
    router.refresh();
  }

  async function loadIcMatrix() {
    if (!selectedId) return;
    setBusy("matrix");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("preview_consolidation_eliminations", {
      p_group_id: selectedId,
      p_as_of: to,
    });
    setBusy("");
    if (error) {
      toast({ title: "Load failed", description: error.message, variant: "destructive" });
      return;
    }
    setIcMatrix(data as typeof icMatrix);
  }

  async function postIcInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !icFromOrg || !icToOrg || !icAmount) return;
    const amount = parseFloat(icAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    setBusy("ic");
    const supabase = createClient();
    const { error } = await supabase.rpc("post_intercompany_invoice", {
      p_org_id: orgId,
      p_from_org_id: icFromOrg,
      p_to_org_id: icToOrg,
      p_amount: amount,
      p_transaction_date: icDate,
      p_description: icDescription || null,
    });
    setBusy("");
    if (error) {
      toast({ title: "IC invoice failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Intercompany invoice posted" });
    setIcAmount("");
    setIcDescription("");
    const { data: txList } = await supabase.rpc("list_intercompany_transactions", { p_org_id: orgId });
    setIcTx((txList as IntercompanyTransaction[]) ?? []);
    router.refresh();
  }

  const mixedCurrency = consolidatedPnl?.mixed_currency || consolidatedBs?.mixed_currency;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Groups" value={String(groups.length)} icon={Layers} />
        <StatCard
          label="Consolidated revenue"
          value={money(consolidatedPnl?.revenue)}
          sub={`${from} → ${to} · ${reportingCurrency}`}
          icon={Layers}
        />
        <StatCard label="Consolidated net profit" value={money(consolidatedPnl?.net_profit)} icon={Layers} />
      </div>

      {mixedCurrency && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            Member orgs use different currencies. Consolidated figures are translated to{" "}
            <strong>{reportingCurrency}</strong> using exchange rates on the parent org. Ensure rates exist in{" "}
            <strong>Financials → FX</strong>.
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Label className="sr-only">Group</Label>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.reporting_currency ?? currency})
              </option>
            ))}
          </select>
        </div>
      )}

      {canManage && otherOrgs.length > 0 && (
        <ReportSection title="New consolidation group" subtitle="Reporting currency, member orgs, and virtual IC elimination">
          <form onSubmit={saveGroup} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
              <div className="space-y-2">
                <Label>Group name</Label>
                <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Retail group" required />
              </div>
              <div className="space-y-2">
                <Label>Reporting currency</Label>
                <Input
                  value={reportingCurrencyInput}
                  onChange={(e) => setReportingCurrencyInput(e.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder={currency}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Member organizations</Label>
              <div className="flex flex-wrap gap-2">
                {otherOrgs.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={memberIds.includes(o.id)}
                      onChange={() => toggleMember(o.id)}
                      className="rounded border-input"
                    />
                    {o.name}
                    <span className="text-xs text-muted-foreground">({o.currency})</span>
                  </label>
                ))}
              </div>
            </div>
            <Button type="submit" disabled={busy === "group"}>
              Create group
            </Button>
          </form>
        </ReportSection>
      )}

      {selectedGroup && (
        <ReportSection title="Group members" subtitle={`${selectedGroup.elimination_method ?? "virtual"} elimination · ${selectedGroup.reporting_currency ?? currency}`}>
          <ul className="space-y-2 text-sm">
            {selectedGroup.members.map((m) => (
              <li key={m.id} className="flex justify-between border-b border-border/40 py-2">
                <span>
                  {m.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    {m.currency} · {m.ownership_percent ?? 100}% · {m.member_role ?? "subsidiary"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </ReportSection>
      )}

      <ReportSection title="Consolidated P&amp;L" subtitle={selectedGroup?.name ?? "Select a group"}>
        {(consolidatedPnl?.organizations ?? []).length > 0 ? (
          <ul className="space-y-2 text-sm">
            {(consolidatedPnl?.organizations ?? []).map((o, i) => (
              <li key={i} className="flex justify-between border-b border-border/40 py-2">
                <span>
                  {o.name}
                  {o.currency && <span className="ml-1 text-xs text-muted-foreground">({o.currency})</span>}
                </span>
                <span className="font-mono">{money(Number(o.translated_net_profit ?? o.original_net_profit))}</span>
              </li>
            ))}
            <li className="flex justify-between py-2 font-semibold">
              <span>Combined net profit ({reportingCurrency})</span>
              <span className="font-mono">{money(consolidatedPnl?.net_profit)}</span>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Create a group with member orgs to see consolidated results.</p>
        )}
      </ReportSection>

      <ReportSection title="Consolidated balance sheet" subtitle={`As of ${to}${consolidatedBs?.ic_elimination ? ` · IC elimination ${money(consolidatedBs.ic_elimination)}` : ""}`}>
        {(consolidatedBs?.organizations ?? []).length > 0 ? (
          <ul className="space-y-2 text-sm">
            {(consolidatedBs?.organizations ?? []).map((o, i) => (
              <li key={i} className="flex justify-between border-b border-border/40 py-2">
                <span>{o.name}</span>
                <span className="font-mono">{money(Number(o.translated_total_assets))}</span>
              </li>
            ))}
            <li className="flex justify-between py-2 font-semibold">
              <span>Total assets ({reportingCurrency})</span>
              <span className="font-mono">{money(consolidatedBs?.total_assets)}</span>
            </li>
            <li className="flex justify-between py-2 font-semibold">
              <span>Total equity</span>
              <span className="font-mono">{money(consolidatedBs?.total_equity)}</span>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No consolidated balance sheet data.</p>
        )}
      </ReportSection>

      {selectedId && (
        <ReportSection title="Intercompany elimination" subtitle="IC receivable (1150) vs payable (2150) across group members">
          <div className="mb-4">
            <Button variant="outline" size="sm" disabled={!!busy} onClick={loadIcMatrix}>
              Preview eliminations
            </Button>
          </div>
          {icMatrix && (
            <div className="space-y-3 text-sm">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="IC receivable" value={money(icMatrix.total_ic_receivable)} />
                <StatCard label="IC payable" value={money(icMatrix.total_ic_payable)} />
                <StatCard label="Elimination" value={money(icMatrix.elimination_amount)} />
              </div>
              <ul className="space-y-1">
                {(icMatrix.organizations ?? []).map((o, i) => (
                  <li key={i} className="flex justify-between border-b border-border/30 py-1">
                    <span>{o.name}</span>
                    <span className="font-mono text-xs">
                      AR {money(o.ic_receivable)} · AP {money(o.ic_payable)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ReportSection>
      )}

      {canManage && otherOrgs.length >= 2 && (
        <ReportSection title="Post intercompany invoice" subtitle="Creates matching IC AR/AP journals in both orgs">
          <form onSubmit={postIcInvoice} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>From (seller)</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={icFromOrg} onChange={(e) => setIcFromOrg(e.target.value)} required>
                <option value="">Select…</option>
                {myOrganizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>To (buyer)</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={icToOrg} onChange={(e) => setIcToOrg(e.target.value)} required>
                <option value="">Select…</option>
                {myOrganizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0" value={icAmount} onChange={(e) => setIcAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <DatePicker value={icDate} onChange={setIcDate} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Description</Label>
              <Input value={icDescription} onChange={(e) => setIcDescription(e.target.value)} placeholder="Management fee" />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={busy === "ic"}>Post IC invoice</Button>
            </div>
          </form>
        </ReportSection>
      )}

      {icTx.length > 0 && (
        <ReportSection title="Intercompany transactions" subtitle={`${initialIcRels.length} relationship(s) configured`}>
          <ul className="space-y-2 text-sm">
            {icTx.slice(0, 10).map((t) => (
              <li key={t.id} className="flex justify-between border-b border-border/40 py-2">
                <span>
                  {t.from_org_name} → {t.to_org_name} · {t.transaction_date}
                </span>
                <span className="font-mono">
                  {formatCurrency(Number(t.amount), t.currency)} · {t.status}
                </span>
              </li>
            ))}
          </ul>
        </ReportSection>
      )}
    </div>
  );
}

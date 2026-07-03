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
import { formatCurrency } from "@/lib/utils";
import { Layers } from "lucide-react";

export type ConsolidationGroup = {
  id: string;
  name: string;
  members: { id: string; name: string }[];
};

export type OrgOption = { id: string; name: string; currency: string };

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
    organizations?: { name: string; net_profit: number }[];
  } | null;
  consolidatedBs: {
    total_assets?: number;
    total_equity?: number;
    organizations?: { name: string; total_assets: number }[];
  } | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number | undefined) => formatCurrency(n ?? 0, currency);
  const [groups, setGroups] = useState(initialGroups);
  const [selectedId, setSelectedId] = useState(initialGroups[0]?.id ?? "");
  const [groupName, setGroupName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("upsert_consolidation_group", {
      p_org_id: orgId,
      p_group_id: null,
      p_name: groupName.trim(),
      p_member_org_ids: memberIds,
    });
    setBusy(false);
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Groups" value={String(groups.length)} icon={Layers} />
        <StatCard label="Consolidated revenue" value={money(consolidatedPnl?.revenue)} sub={from + " → " + to} icon={Layers} />
        <StatCard label="Consolidated net profit" value={money(consolidatedPnl?.net_profit)} icon={Layers} />
      </div>

      {canManage && otherOrgs.length > 0 && (
        <ReportSection title="New consolidation group" subtitle="Combine P&amp;L and balance sheet across orgs you can access">
          <form onSubmit={saveGroup} className="space-y-4">
            <div className="space-y-2 max-w-md">
              <Label>Group name</Label>
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Retail group" required />
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
                  </label>
                ))}
              </div>
            </div>
            <Button type="submit" disabled={busy}>Create group</Button>
          </form>
        </ReportSection>
      )}

      <ReportSection title="Consolidated P&amp;L" subtitle={selectedId ? groups.find((g) => g.id === selectedId)?.name : "Select a group"}>
        {(consolidatedPnl?.organizations ?? []).length > 0 ? (
          <ul className="space-y-2 text-sm">
            {(consolidatedPnl?.organizations ?? []).map((o, i) => (
              <li key={i} className="flex justify-between border-b border-border/40 py-2">
                <span>{o.name}</span>
                <span className="font-mono">{money(Number(o.net_profit))}</span>
              </li>
            ))}
            <li className="flex justify-between py-2 font-semibold">
              <span>Combined net profit</span>
              <span className="font-mono">{money(consolidatedPnl?.net_profit)}</span>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Create a group with member orgs to see consolidated results.</p>
        )}
      </ReportSection>

      <ReportSection title="Consolidated balance sheet" subtitle={`As of ${to}`}>
        {(consolidatedBs?.organizations ?? []).length > 0 ? (
          <ul className="space-y-2 text-sm">
            {(consolidatedBs?.organizations ?? []).map((o, i) => (
              <li key={i} className="flex justify-between border-b border-border/40 py-2">
                <span>{o.name}</span>
                <span className="font-mono">{money(Number(o.total_assets))}</span>
              </li>
            ))}
            <li className="flex justify-between py-2 font-semibold">
              <span>Total assets</span>
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
    </div>
  );
}

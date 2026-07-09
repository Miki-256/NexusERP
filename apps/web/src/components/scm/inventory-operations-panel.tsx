"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormCard } from "@/components/layout/form-card";
import { StatusBadge } from "@/components/layout/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { useToast } from "@/components/ui/toast";
import { SELECT_CLS } from "@/lib/ui-classes";
import type {
  CycleCountLineRow,
  CycleCountSessionRow,
  QualityHoldRow,
} from "@/lib/scm/types";
import { ClipboardList, ShieldAlert } from "lucide-react";

type OpsTab = "counts" | "quality";

export function InventoryOperationsPanel({
  organizationId,
  storeId,
  stores,
  variantOptions,
  canManage,
}: {
  organizationId: string;
  storeId: string;
  stores: { id: string; name: string }[];
  variantOptions: { variant_id: string; label: string }[];
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [opsTab, setOpsTab] = useState<OpsTab>("counts");
  const [loading, setLoading] = useState(false);

  const [sessions, setSessions] = useState<CycleCountSessionRow[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [countLines, setCountLines] = useState<CycleCountLineRow[]>([]);
  const [countName, setCountName] = useState("");
  const [countDrafts, setCountDrafts] = useState<Record<string, string>>({});

  const [holds, setHolds] = useState<QualityHoldRow[]>([]);
  const [holdsLoaded, setHoldsLoaded] = useState(false);
  const [holdVariant, setHoldVariant] = useState("");
  const [holdReason, setHoldReason] = useState("");

  async function loadSessions() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_cycle_count_sessions", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
    });
    if (error) {
      toast({ title: "Could not load counts", description: error.message, variant: "destructive" });
      return;
    }
    setSessions((data ?? []) as CycleCountSessionRow[]);
    setSessionsLoaded(true);
  }

  async function loadSessionDetail(sessionId: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_cycle_count_session", {
      p_session_id: sessionId,
    });
    if (error) {
      toast({ title: "Could not load count", description: error.message, variant: "destructive" });
      return;
    }
    const parsed = (data ?? {}) as { lines?: CycleCountLineRow[] };
    setCountLines(parsed.lines ?? []);
    setActiveSessionId(sessionId);
    const drafts: Record<string, string> = {};
    for (const line of parsed.lines ?? []) {
      if (line.counted_qty != null) drafts[line.variant_id] = String(line.counted_qty);
    }
    setCountDrafts(drafts);
  }

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !storeId || !countName.trim()) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_cycle_count_session", {
      p_org_id: organizationId,
      p_store_id: storeId,
      p_name: countName.trim(),
    });
    setLoading(false);
    if (error) {
      toast({ title: "Could not start count", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Cycle count started", description: "Enter counted quantities below." });
    setCountName("");
    setSessionsLoaded(false);
    void loadSessions();
    if (data) void loadSessionDetail(data as string);
  }

  async function saveCountLine(variantId: string) {
    if (!canManage || !activeSessionId) return;
    const qty = parseFloat(countDrafts[variantId] ?? "");
    if (Number.isNaN(qty)) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("record_cycle_count_line", {
      p_session_id: activeSessionId,
      p_variant_id: variantId,
      p_counted_qty: qty,
    });
    if (error) {
      toast({ title: "Could not save count", description: error.message, variant: "destructive" });
      return;
    }
    void loadSessionDetail(activeSessionId);
  }

  async function finalizeSession() {
    if (!canManage || !activeSessionId) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("finalize_cycle_count", {
      p_session_id: activeSessionId,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Finalize failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = (data ?? {}) as { lines_adjusted?: number };
    toast({
      title: "Cycle count finalized",
      description: `${result.lines_adjusted ?? 0} variance line(s) posted to the ledger.`,
    });
    setActiveSessionId("");
    setCountLines([]);
    setSessionsLoaded(false);
    void loadSessions();
  }

  async function loadHolds() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_quality_holds", {
      p_org_id: organizationId,
      p_store_id: storeId || null,
      p_active_only: true,
    });
    if (error) {
      toast({ title: "Could not load holds", description: error.message, variant: "destructive" });
      return;
    }
    setHolds((data ?? []) as QualityHoldRow[]);
    setHoldsLoaded(true);
  }

  async function placeHold(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !storeId || !holdVariant || !holdReason.trim()) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("place_quality_hold", {
      p_org_id: organizationId,
      p_store_id: storeId,
      p_variant_id: holdVariant,
      p_reason: holdReason.trim(),
    });
    setLoading(false);
    if (error) {
      toast({ title: "Could not place hold", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Quality hold placed", description: "Outbound moves for this SKU are blocked." });
    setHoldReason("");
    setHoldVariant("");
    setHoldsLoaded(false);
    void loadHolds();
  }

  async function releaseHold(holdId: string) {
    if (!canManage) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("release_quality_hold", { p_hold_id: holdId });
    if (error) {
      toast({ title: "Release failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Hold released" });
    void loadHolds();
  }

  function switchTab(tab: OpsTab) {
    setOpsTab(tab);
    if (tab === "counts" && !sessionsLoaded) void loadSessions();
    if (tab === "quality" && !holdsLoaded) void loadHolds();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={opsTab === "counts" ? "default" : "outline"}
          size="sm"
          onClick={() => switchTab("counts")}
        >
          <ClipboardList className="mr-2 h-4 w-4" />
          Cycle counts
        </Button>
        <Button
          type="button"
          variant={opsTab === "quality" ? "default" : "outline"}
          size="sm"
          onClick={() => switchTab("quality")}
        >
          <ShieldAlert className="mr-2 h-4 w-4" />
          Quality holds
        </Button>
      </div>

      {opsTab === "counts" && (
        <>
          {canManage && (
            <FormCard title="New cycle count">
              <form onSubmit={createSession} className="flex flex-wrap items-end gap-4">
                <div className="space-y-2 min-w-[200px]">
                  <Label>Store</Label>
                  <select className={SELECT_CLS} value={storeId} disabled>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2 flex-1 min-w-[200px]">
                  <Label>Session name</Label>
                  <Input value={countName} onChange={(e) => setCountName(e.target.value)} placeholder="e.g. March aisle audit" required />
                </div>
                <Button type="submit" disabled={loading || !storeId}>Start count</Button>
              </form>
            </FormCard>
          )}

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead align="right">Lines</DataTableHead>
                <DataTableHead align="right">Counted</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {sessions.length === 0 ? (
                  <DataTableEmpty colSpan={4} message="No cycle count sessions yet." />
                ) : (
                  sessions.map((s) => (
                    <DataTableRow key={s.id} selected={activeSessionId === s.id}>
                      <DataTableCell>
                        <button type="button" className="font-medium hover:underline" onClick={() => void loadSessionDetail(s.id)}>
                          {s.name}
                        </button>
                      </DataTableCell>
                      <DataTableCell><StatusBadge status={s.status} /></DataTableCell>
                      <DataTableCell align="right">{s.line_count}</DataTableCell>
                      <DataTableCell align="right">{s.counted_lines}</DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>

          {activeSessionId && countLines.length > 0 && (
            <FormCard title="Count lines">
              <DataTable>
                <table className="w-full">
                  <DataTableHeader>
                    <DataTableHead>Product</DataTableHead>
                    <DataTableHead align="right">Expected</DataTableHead>
                    <DataTableHead align="right">Counted</DataTableHead>
                    <DataTableHead align="right">Variance</DataTableHead>
                  </DataTableHeader>
                  <DataTableBody>
                    {countLines.map((line) => (
                      <DataTableRow key={line.id}>
                        <DataTableCell>{line.product_name}{line.variant_name !== "Default" ? ` (${line.variant_name})` : ""}</DataTableCell>
                        <DataTableCell align="right" className="font-mono">{line.expected_qty}</DataTableCell>
                        <DataTableCell align="right">
                          {canManage ? (
                            <Input
                              type="number"
                              className="ml-auto w-24 text-right"
                              value={countDrafts[line.variant_id] ?? ""}
                              onChange={(e) => setCountDrafts((d) => ({ ...d, [line.variant_id]: e.target.value }))}
                              onBlur={() => void saveCountLine(line.variant_id)}
                            />
                          ) : (
                            line.counted_qty ?? "—"
                          )}
                        </DataTableCell>
                        <DataTableCell align="right" className="font-mono">{line.variance_qty ?? "—"}</DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </table>
              </DataTable>
              {canManage && (
                <Button className="mt-4" onClick={() => void finalizeSession()} disabled={loading}>
                  Finalize & post variances
                </Button>
              )}
            </FormCard>
          )}
        </>
      )}

      {opsTab === "quality" && (
        <>
          {canManage && (
            <FormCard title="Place quality hold">
              <form onSubmit={placeHold} className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2 sm:col-span-2">
                  <Label>Product</Label>
                  <select className={SELECT_CLS} value={holdVariant} onChange={(e) => setHoldVariant(e.target.value)} required>
                    <option value="">Select…</option>
                    {variantOptions.map((v) => (
                      <option key={v.variant_id} value={v.variant_id}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2 sm:col-span-3">
                  <Label>Reason</Label>
                  <Input value={holdReason} onChange={(e) => setHoldReason(e.target.value)} required />
                </div>
                <Button type="submit" disabled={loading || !storeId}>Place hold</Button>
              </form>
            </FormCard>
          )}

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Product</DataTableHead>
                <DataTableHead>Reason</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                {canManage && <DataTableHead>&nbsp;</DataTableHead>}
              </DataTableHeader>
              <DataTableBody>
                {holds.length === 0 ? (
                  <DataTableEmpty colSpan={canManage ? 4 : 3} message="No active quality holds." />
                ) : (
                  holds.map((h) => (
                    <DataTableRow key={h.id}>
                      <DataTableCell>
                        {h.product_name}
                        {h.variant_name !== "Default" && ` (${h.variant_name})`}
                      </DataTableCell>
                      <DataTableCell className="text-sm text-muted-foreground">{h.reason}</DataTableCell>
                      <DataTableCell><StatusBadge status={h.status} /></DataTableCell>
                      {canManage && (
                        <DataTableCell align="right">
                          <Button size="sm" variant="outline" onClick={() => void releaseHold(h.id)}>Release</Button>
                        </DataTableCell>
                      )}
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </>
      )}
    </div>
  );
}

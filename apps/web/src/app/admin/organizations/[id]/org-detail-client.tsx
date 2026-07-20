"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import { StatCard } from "@/components/layout/stat-card";
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
import { OrgOpsInspector } from "@/components/admin/org-ops-inspector";
import { OrgFeatureFlagsPanel } from "@/components/admin/org-feature-flags-panel";
import { startSupportSession } from "@/app/actions/support-session";
import { formatAuditAction, type OrgDetail, type OrgPlanUsage, type PlatformPlan } from "@/lib/admin-types";
import { formatPlanName } from "@/lib/format-plan";
import { formatCurrency } from "@/lib/utils";
import { Building2, DollarSign, Download, Store, Users } from "lucide-react";

function LimitCell({
  used,
  max,
  ok,
}: {
  used: number;
  max: number | null;
  ok: boolean;
}) {
  const label = max == null ? `${used} / ∞` : `${used} / ${max}`;
  return (
    <span className={ok ? "text-foreground" : "font-medium text-red-600"}>
      {label}
      {!ok && " · over limit"}
    </span>
  );
}

export function OrgDetailClient({
  detail,
  planUsage,
  plans,
  canWrite,
}: {
  detail: OrgDetail;
  planUsage: OrgPlanUsage | null;
  plans: PlatformPlan[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [supportReason, setSupportReason] = useState("");
  const [supportPending, startSupportTransition] = useTransition();
  const [sensitiveReason, setSensitiveReason] = useState("");
  const org = detail.organization;

  function openTenantWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (supportReason.trim().length < 8) {
      toast({
        title: "Reason required",
        description: "Enter at least 8 characters describing why you need access.",
        variant: "destructive",
      });
      return;
    }
    startSupportTransition(async () => {
      try {
        await startSupportSession(org.id, supportReason.trim());
      } catch (err) {
        const digest = typeof err === "object" && err && "digest" in err ? String((err as { digest?: string }).digest) : "";
        if (digest.startsWith("NEXT_REDIRECT")) throw err;
        toast({
          title: "Could not start support session",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      }
    });
  }

  async function setStatus(status: "active" | "suspended" | "pending") {
    setBusy(true);
    const supabase = createClient();

    if (status === "suspended") {
      const reason = sensitiveReason.trim() || window.prompt("Reason for suspend (min 8 characters)") || "";
      if (reason.trim().length < 8) {
        setBusy(false);
        toast({
          title: "Reason required",
          description: "Suspend requires a reason (and dual-control approval when enabled).",
          variant: "destructive",
        });
        return;
      }
      const { data, error } = await supabase.rpc("admin_request_sensitive_action", {
        p_action: "org.suspend",
        p_org_id: org.id,
        p_reason: reason.trim(),
      });
      setBusy(false);
      if (error) {
        toast({ title: "Suspend failed", description: error.message, variant: "destructive" });
        return;
      }
      const result = data as { status?: string; dual_control?: boolean };
      if (result.status === "pending") {
        toast({
          title: "Suspend submitted for approval",
          description: "A second write admin must approve on Approvals.",
        });
        router.push("/admin/approvals");
        return;
      }
      toast({ title: "Organization suspended" });
      router.refresh();
      return;
    }

    const { error } = await supabase.rpc("admin_set_org_status", {
      p_org_id: org.id,
      p_status: status,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Organization updated" });
    router.refresh();
  }

  async function requestExport() {
    setBusy(true);
    const supabase = createClient();
    const reason = sensitiveReason.trim() || window.prompt("Reason for export (min 8 characters)") || "";
    if (reason.trim().length < 8) {
      setBusy(false);
      toast({
        title: "Reason required",
        description: "Export requires a reason when dual control is active.",
        variant: "destructive",
      });
      return;
    }
    const { data, error } = await supabase.rpc("admin_request_sensitive_action", {
      p_action: "org.export",
      p_org_id: org.id,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      toast({ title: "Export request failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as { status?: string; download_path?: string; dual_control?: boolean };
    if (result.status === "pending") {
      toast({
        title: "Export submitted for approval",
        description: "After approval, download from Approvals.",
      });
      router.push("/admin/approvals");
      return;
    }
    window.location.href = result.download_path ?? `/api/admin/organizations/${org.id}/export`;
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_add_org_support_note", {
      p_org_id: org.id,
      p_note: noteText.trim(),
    });
    setNoteBusy(false);
    if (error) {
      toast({ title: "Could not save note", description: error.message, variant: "destructive" });
      return;
    }
    setNoteText("");
    toast({ title: "Support note added" });
    router.refresh();
  }

  async function setPlan(planId: string) {
    if (planId === org.plan) return;
    setPlanBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_set_org_plan", {
      p_org_id: org.id,
      p_plan: planId,
    });
    setPlanBusy(false);
    if (error) {
      toast({ title: "Plan update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Plan updated" });
    router.refresh();
  }

  const supportNotes = detail.support_notes ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
            <StatusBadge status={org.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Created {new Date(org.created_at).toLocaleString()} · {org.currency} · {org.timezone}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {canWrite && (
            <Input
              value={sensitiveReason}
              onChange={(e) => setSensitiveReason(e.target.value)}
              placeholder="Reason for suspend/export (min 8 chars)"
              className="w-full sm:w-80"
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy || !canWrite} onClick={() => void requestExport()}>
              <Download className="mr-1.5 h-4 w-4" />
              Export backup
            </Button>
            {canWrite && (
              <>
                {org.status !== "active" && (
                  <Button size="sm" disabled={busy} onClick={() => void setStatus("active")}>
                    Approve
                  </Button>
                )}
                {org.status === "active" && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus("pending")}>
                    Mark pending
                  </Button>
                )}
                {org.status !== "suspended" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600"
                    disabled={busy}
                    onClick={() => void setStatus("suspended")}
                  >
                    Suspend
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {canWrite && org.status !== "suspended" && (
        <FormCard
          title="Open tenant workspace"
          description="Temporary manager access (up to 4 hours), fully audited. Use for support only."
        >
          <form onSubmit={openTenantWorkspace} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <label htmlFor="supportReason" className="text-xs font-medium text-muted-foreground">
                Reason (required, min 8 chars)
              </label>
              <Input
                id="supportReason"
                value={supportReason}
                onChange={(e) => setSupportReason(e.target.value)}
                placeholder="e.g. Investigate missing GL posts for ticket #123"
                disabled={supportPending}
              />
            </div>
            <Button type="submit" size="sm" disabled={supportPending}>
              {supportPending ? "Opening…" : "Open workspace"}
            </Button>
          </form>
        </FormCard>
      )}

      <OrgOpsInspector
        organizationId={org.id}
        organizationName={org.name}
        canWrite={canWrite}
        embedded
      />

      <OrgFeatureFlagsPanel organizationId={org.id} canWrite={canWrite} />

      {planUsage && (
        <FormCard title="Plan & usage" description={`Current plan: ${formatPlanName(planUsage.plan, planUsage.plan_name)}`}>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            {canWrite && plans.length > 0 ? (
              <div className="space-y-1">
                <label htmlFor="orgPlan" className="text-xs font-medium text-muted-foreground">
                  Assign plan
                </label>
                <select
                  id="orgPlan"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={org.plan}
                  disabled={planBusy}
                  onChange={(e) => setPlan(e.target.value)}
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm capitalize">
                Plan: <span className="font-medium">{formatPlanName(planUsage.plan, planUsage.plan_name)}</span>
              </p>
            )}
          </div>
          <ul className="grid gap-2 text-sm sm:grid-cols-3">
            <li>
              Stores:{" "}
              <LimitCell
                used={planUsage.usage.stores}
                max={planUsage.limits.max_stores}
                ok={planUsage.within_limits.stores}
              />
            </li>
            <li>
              Members:{" "}
              <LimitCell
                used={planUsage.usage.members}
                max={planUsage.limits.max_members}
                ok={planUsage.within_limits.members}
              />
            </li>
            <li>
              Sales this month:{" "}
              <LimitCell
                used={planUsage.usage.sales_this_month}
                max={planUsage.limits.max_sales_per_month}
                ok={planUsage.within_limits.sales}
              />
            </li>
          </ul>
        </FormCard>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Members" value={detail.members.length} icon={Users} />
        <StatCard label="Stores" value={detail.stores.length} icon={Store} />
        <StatCard label="Completed sales" value={detail.stats.sales_count} icon={Building2} />
        <StatCard
          label="Sales volume"
          value={formatCurrency(detail.stats.sales_total, org.currency)}
          icon={DollarSign}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <FormCard title="Members">
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Email</DataTableHead>
                <DataTableHead>Role</DataTableHead>
                <DataTableHead>Joined</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {detail.members.length === 0 ? (
                  <DataTableEmpty colSpan={3} message="No members." />
                ) : (
                  detail.members.map((m) => (
                    <DataTableRow key={m.member_id}>
                      <DataTableCell>{m.email}</DataTableCell>
                      <DataTableCell className="capitalize">{m.role}</DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {new Date(m.joined_at).toLocaleDateString()}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </FormCard>

        <FormCard title="Stores">
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead>Created</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {detail.stores.length === 0 ? (
                  <DataTableEmpty colSpan={2} message="No stores." />
                ) : (
                  detail.stores.map((s) => (
                    <DataTableRow key={s.store_id}>
                      <DataTableCell>{s.name}</DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString()}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </FormCard>
      </div>

      <FormCard title="Status history" description="Platform admin actions on this organization.">
        {detail.status_history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No status changes recorded yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {detail.status_history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <span className="font-medium capitalize">{formatAuditAction(entry.action)}</span>
                  <span className="text-muted-foreground"> by {entry.actor_email ?? "unknown"}</span>
                  {entry.payload?.from != null && entry.payload?.to != null && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({String(entry.payload.from)} → {String(entry.payload.to)})
                    </span>
                  )}
                </div>
                <time className="text-xs text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </FormCard>

      <FormCard title="Support notes" description="Internal notes visible only to platform admins.">
        {canWrite && (
          <form onSubmit={addNote} className="mb-4 flex gap-2">
            <Input
              placeholder="Add a support note…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <Button type="submit" disabled={noteBusy || !noteText.trim()}>
              {noteBusy ? "Saving…" : "Add"}
            </Button>
          </form>
        )}
        {supportNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No support notes yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {supportNotes.map((n) => (
              <li key={n.id} className="px-4 py-3 text-sm">
                <p>{n.note}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {n.author_email ?? "unknown"} · {new Date(n.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </FormCard>

      <Button variant="outline" size="sm" asChild>
        <Link href="/admin/organizations">← All organizations</Link>
      </Button>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
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
import type { AdminOrg } from "@/lib/admin-types";
import { OrgHealthBadge } from "@/components/admin/org-health-badge";

const FILTERS = ["all", "pending", "active", "suspended", "offboarded"] as const;

export function OrganizationsClient({
  orgs,
  canWrite,
  initialStatus,
}: {
  orgs: AdminOrg[];
  canWrite: boolean;
  initialStatus?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof FILTERS)[number]>(
    FILTERS.includes(initialStatus as (typeof FILTERS)[number])
      ? (initialStatus as (typeof FILTERS)[number])
      : "all"
  );

  const filtered = useMemo(() => {
    return orgs.filter((o) => {
      const isOffboarded = !!o.offboarded_at || o.health?.grade === "offboarded";
      const matchesStatus =
        status === "all" ||
        (status === "offboarded" ? isOffboarded : o.status === status && !isOffboarded);
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || o.name.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [orgs, query, status]);

  async function setOrgStatus(orgId: string, next: AdminOrg["status"]) {
    setBusy(orgId);
    const supabase = createClient();

    if (next === "suspended") {
      const reason = window.prompt("Reason for suspend (min 8 characters)") || "";
      if (reason.trim().length < 8) {
        setBusy(null);
        toast({
          title: "Reason required",
          description: "Suspend requires a reason (dual-control may apply).",
          variant: "destructive",
        });
        return;
      }
      const { data, error } = await supabase.rpc("admin_request_sensitive_action", {
        p_action: "org.suspend",
        p_org_id: orgId,
        p_reason: reason.trim(),
      });
      setBusy(null);
      if (error) {
        toast({ title: "Suspend failed", description: error.message, variant: "destructive" });
        return;
      }
      if ((data as { status?: string } | null)?.status === "pending") {
        toast({ title: "Suspend submitted for approval" });
        router.push("/admin/approvals");
        return;
      }
      toast({ title: "Organization suspended" });
      router.refresh();
      return;
    }

    const { error } = await supabase.rpc("admin_set_org_status", {
      p_org_id: orgId,
      p_status: next,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Organization updated", description: `Status set to ${next}.` });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Search organizations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={status === f ? "default" : "outline"}
              className="h-8 capitalize"
              onClick={() => setStatus(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead>Health</DataTableHead>
            <DataTableHead>Plan</DataTableHead>
            <DataTableHead align="right">Members</DataTableHead>
            <DataTableHead>Created</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={7} message="No organizations match your filters." />
            ) : (
              filtered.map((o) => (
                <DataTableRow key={o.id}>
                  <DataTableCell>
                    <Link href={`/admin/organizations/${o.id}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={o.status} />
                  </DataTableCell>
                  <DataTableCell>
                    {o.health ? (
                      <OrgHealthBadge score={o.health.score} grade={o.health.grade} compact />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </DataTableCell>
                  <DataTableCell className="capitalize text-muted-foreground">{o.plan}</DataTableCell>
                  <DataTableCell align="right">{o.member_count}</DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {new Date(o.created_at).toLocaleDateString()}
                  </DataTableCell>
                  <DataTableCell align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                        <Link href={`/admin/organizations/${o.id}`}>Open</Link>
                      </Button>
                      {canWrite && o.status !== "active" && !o.offboarded_at && (
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={busy === o.id}
                          onClick={() => void setOrgStatus(o.id, "active")}
                        >
                          Approve
                        </Button>
                      )}
                      {canWrite && o.status !== "suspended" && !o.offboarded_at && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-red-600"
                          disabled={busy === o.id}
                          onClick={() => void setOrgStatus(o.id, "suspended")}
                        >
                          Suspend
                        </Button>
                      )}
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>
    </div>
  );
}

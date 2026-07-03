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

const FILTERS = ["all", "pending", "active", "suspended"] as const;

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
      const matchesStatus = status === "all" || o.status === status;
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || o.name.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [orgs, query, status]);

  async function setOrgStatus(orgId: string, next: AdminOrg["status"]) {
    setBusy(orgId);
    const supabase = createClient();
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
            <DataTableHead>Plan</DataTableHead>
            <DataTableHead align="right">Members</DataTableHead>
            <DataTableHead>Created</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={6} message="No organizations match your filters." />
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
                      {canWrite && o.status !== "active" && (
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={busy === o.id}
                          onClick={() => setOrgStatus(o.id, "active")}
                        >
                          Approve
                        </Button>
                      )}
                      {canWrite && o.status !== "suspended" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-red-600"
                          disabled={busy === o.id}
                          onClick={() => setOrgStatus(o.id, "suspended")}
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

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
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
import type { PendingOrg } from "@/lib/admin-types";

export function PendingQueue({
  orgs,
  canWrite,
}: {
  orgs: PendingOrg[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function approve(orgId: string) {
    setBusy(orgId);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_set_org_status", {
      p_org_id: orgId,
      p_status: "active",
    });
    setBusy(null);
    if (error) {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Organization approved" });
    router.refresh();
  }

  if (orgs.length === 0) {
    return (
      <FormCard title="Pending approvals" description="No organizations waiting for review.">
        <p className="text-sm text-muted-foreground">All caught up.</p>
      </FormCard>
    );
  }

  return (
    <FormCard
      title="Pending approvals"
      description={`${orgs.length} organization${orgs.length === 1 ? "" : "s"} awaiting super admin review.`}
    >
      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Business</DataTableHead>
            <DataTableHead>Owner</DataTableHead>
            <DataTableHead>Submitted</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {orgs.map((o) => (
              <DataTableRow key={o.id}>
                <DataTableCell>
                  <Link href={`/admin/organizations/${o.id}`} className="font-medium hover:underline">
                    {o.name}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge status={o.status} />
                    <span>{o.currency}</span>
                  </div>
                </DataTableCell>
                <DataTableCell className="text-muted-foreground">{o.owner_email ?? "—"}</DataTableCell>
                <DataTableCell className="text-muted-foreground">
                  {new Date(o.created_at).toLocaleString()}
                </DataTableCell>
                <DataTableCell align="right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                      <Link href={`/admin/organizations/${o.id}`}>Review</Link>
                    </Button>
                    {canWrite && (
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={busy === o.id}
                        onClick={() => approve(o.id)}
                      >
                        Approve
                      </Button>
                    )}
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </table>
      </DataTable>
    </FormCard>
  );
}

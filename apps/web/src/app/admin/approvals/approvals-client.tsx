"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FormCard } from "@/components/layout/form-card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatAuditAction, type AdminApproval } from "@/lib/admin-types";

function ApprovalTable({
  rows,
  canWrite,
  onChanged,
}: {
  rows: AdminApproval[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function review(id: string, approve: boolean) {
    setBusy(`${approve ? "a" : "r"}-${id}`);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_review_approval", {
      p_approval_id: id,
      p_approve: approve,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Review failed", description: error.message, variant: "destructive" });
      return;
    }
    const status = (data as { status?: string } | null)?.status;
    toast({
      title: approve ? "Approved" : "Rejected",
      description: status === "executed" ? "Action executed." : status === "approved" ? "Ready to download." : undefined,
    });
    onChanged();
  }

  async function cancel(id: string) {
    setBusy(`c-${id}`);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_cancel_approval", { p_approval_id: id });
    setBusy(null);
    if (error) {
      toast({ title: "Cancel failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Request cancelled" });
    onChanged();
  }

  return (
    <DataTable>
      <table className="w-full">
        <DataTableHeader>
          <DataTableHead>Action</DataTableHead>
          <DataTableHead>Organization</DataTableHead>
          <DataTableHead>Requester</DataTableHead>
          <DataTableHead>Reason</DataTableHead>
          <DataTableHead>Status</DataTableHead>
          <DataTableHead>Expires</DataTableHead>
          {canWrite && <DataTableHead align="right">Actions</DataTableHead>}
        </DataTableHeader>
        <DataTableBody>
          {rows.length === 0 ? (
            <DataTableEmpty colSpan={canWrite ? 7 : 6} message="No approvals in this list." />
          ) : (
            rows.map((row) => (
              <DataTableRow key={row.id}>
                <DataTableCell className="font-medium">{formatAuditAction(row.action_type)}</DataTableCell>
                <DataTableCell>
                  <Link
                    href={`/admin/organizations/${row.organization_id}`}
                    className="text-primary hover:underline"
                  >
                    {row.organization_name}
                  </Link>
                </DataTableCell>
                <DataTableCell className="text-sm">{row.requested_by_email}</DataTableCell>
                <DataTableCell className="max-w-xs truncate text-sm text-muted-foreground">
                  {row.reason}
                </DataTableCell>
                <DataTableCell className="capitalize">{row.status}</DataTableCell>
                <DataTableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(row.expires_at).toLocaleString()}
                </DataTableCell>
                {canWrite && (
                  <DataTableCell align="right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {row.download_path && row.status === "approved" && (
                        <Button size="sm" variant="outline" asChild>
                          <a href={row.download_path}>Download</a>
                        </Button>
                      )}
                      {row.can_review && (
                        <>
                          <Button
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => void review(row.id, true)}
                          >
                            {busy === `a-${row.id}` ? "…" : "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => void review(row.id, false)}
                          >
                            {busy === `r-${row.id}` ? "…" : "Reject"}
                          </Button>
                        </>
                      )}
                      {row.can_cancel && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => void cancel(row.id)}
                        >
                          {busy === `c-${row.id}` ? "…" : "Cancel"}
                        </Button>
                      )}
                    </div>
                  </DataTableCell>
                )}
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </table>
    </DataTable>
  );
}

export function ApprovalsClient({
  pending,
  recent,
  canWrite,
}: {
  pending: AdminApproval[];
  recent: AdminApproval[];
  canWrite: boolean;
}) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <FormCard title="Pending" description="Requests waiting for a second write admin.">
        <ApprovalTable rows={pending} canWrite={canWrite} onChanged={() => router.refresh()} />
      </FormCard>
      <FormCard title="Recent" description="Latest approval activity across all statuses.">
        <ApprovalTable rows={recent} canWrite={canWrite} onChanged={() => router.refresh()} />
      </FormCard>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FormCard } from "@/components/layout/form-card";
import { StatCard } from "@/components/layout/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import type { PlatformPlan } from "@/lib/admin-types";
import { useToast } from "@/components/ui/toast";
import { Building2, Check, Package, Users, X } from "lucide-react";

export type PlanChangeRequestRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  current_plan: string;
  requested_plan: string;
  status: string;
  note: string | null;
  requester_email: string;
  created_at: string;
};

function formatLimit(value: number | null, suffix = "") {
  if (value == null) return "Unlimited";
  return `${value.toLocaleString()}${suffix}`;
}

export function PlansClient({
  plans,
  pendingRequests,
  canWrite,
}: {
  plans: PlatformPlan[];
  pendingRequests: PlanChangeRequestRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  async function reviewRequest(requestId: string, approve: boolean) {
    setReviewingId(requestId);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_review_plan_change_request", {
      p_request_id: requestId,
      p_approve: approve,
      p_review_note: reviewNotes[requestId]?.trim() || null,
    });
    setReviewingId(null);
    if (error) {
      toast({ title: "Review failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: approve ? "Plan upgraded" : "Request rejected",
      description: approve ? "Organization plan was updated." : "The tenant was notified via status.",
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {!canWrite && (
        <p className="text-sm text-muted-foreground">
          Read-only. Assign plans from an organization detail page.
        </p>
      )}

      {pendingRequests.length > 0 && (
        <FormCard
          title="Pending upgrade requests"
          description="Tenants requested a manual plan change (no Stripe)."
        >
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Organization</DataTableHead>
                <DataTableHead>Plan change</DataTableHead>
                <DataTableHead>Requester</DataTableHead>
                <DataTableHead>Note</DataTableHead>
                {canWrite && <DataTableHead align="right">Actions</DataTableHead>}
              </DataTableHeader>
              <DataTableBody>
                {pendingRequests.map((r) => (
                  <DataTableRow key={r.id}>
                    <DataTableCell>
                      <Link
                        href={`/admin/organizations/${r.organization_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.organization_name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="capitalize">
                      {r.current_plan} → {r.requested_plan}
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">{r.requester_email}</DataTableCell>
                    <DataTableCell className="max-w-[200px] truncate text-muted-foreground">
                      {r.note ?? "—"}
                    </DataTableCell>
                    {canWrite && (
                      <DataTableCell align="right">
                        <div className="flex flex-col items-end gap-2">
                          <Input
                            className="h-8 w-48 text-xs"
                            placeholder="Review note (optional)"
                            value={reviewNotes[r.id] ?? ""}
                            onChange={(e) =>
                              setReviewNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={reviewingId === r.id}
                              onClick={() => void reviewRequest(r.id, false)}
                            >
                              <X className="mr-1 h-3.5 w-3.5" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              disabled={reviewingId === r.id}
                              onClick={() => void reviewRequest(r.id, true)}
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Approve
                            </Button>
                          </div>
                        </div>
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))}
              </DataTableBody>
            </table>
          </DataTable>
        </FormCard>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((plan) => (
          <StatCard
            key={plan.id}
            label={plan.name}
            value={plan.org_count}
            icon={Building2}
            sub={`${plan.org_count} organization${plan.org_count === 1 ? "" : "s"}`}
          />
        ))}
      </div>

      <FormCard title="Plan limits" description="Default caps applied when checking org usage.">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Plan</DataTableHead>
              <DataTableHead>Stores</DataTableHead>
              <DataTableHead>Members</DataTableHead>
              <DataTableHead>Sales / month</DataTableHead>
              <DataTableHead>Modules</DataTableHead>
              <DataTableHead>Orgs</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {plans.map((plan) => (
                <DataTableRow key={plan.id}>
                  <DataTableCell className="font-medium capitalize">{plan.name}</DataTableCell>
                  <DataTableCell>{formatLimit(plan.max_stores)}</DataTableCell>
                  <DataTableCell>{formatLimit(plan.max_members)}</DataTableCell>
                  <DataTableCell>{formatLimit(plan.max_sales_per_month)}</DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {plan.modules?.length ? plan.modules.join(", ") : "All modules"}
                  </DataTableCell>
                  <DataTableCell>{plan.org_count}</DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </table>
        </DataTable>
      </FormCard>

      <FormCard
        title="Assign plans"
        description="Open an organization to change its plan and view usage against these limits."
      >
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/admin/organizations" className="inline-flex items-center gap-2 text-primary hover:underline">
            <Building2 className="h-4 w-4" />
            Browse organizations
          </Link>
          <span className="text-muted-foreground">·</span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" />
            Member limits enforced in usage panel
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Package className="h-4 w-4" />
            Sales counted per calendar month
          </span>
        </div>
      </FormCard>
    </div>
  );
}

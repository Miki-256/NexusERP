"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ResponsiveTableLayout } from "@/components/layout/responsive-table-layout";
import { formatCurrency } from "@/lib/utils";
import { runHrMutation } from "@/lib/hr/mutations";
import type { MyBenefitRow, PendingPolicyRow } from "@/lib/hr/types";
import { CheckCircle2 } from "lucide-react";

export function BenefitsEssTab({
  organizationId,
  currency,
  benefits,
  pendingPolicies,
}: {
  organizationId: string;
  currency: string;
  benefits: MyBenefitRow[];
  pendingPolicies: PendingPolicyRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function acknowledge(policyId: string) {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("acknowledge_hr_policy", { p_policy_id: policyId });
        return { error };
      },
      { successTitle: "Policy acknowledged" }
    );
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      {pendingPolicies.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-semibold">Action required — policy acknowledgements</h3>
          {pendingPolicies.map((p) => (
            <div key={p.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">Version {p.version} · effective {p.effective_date}</p>
                </div>
              </div>
              {p.summary && <p className="mb-3 text-sm text-muted-foreground">{p.summary}</p>}
              {p.content_url && (
                <p className="mb-3 text-sm">
                  <a href={p.content_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Read full policy
                  </a>
                </p>
              )}
              <Button size="sm" disabled={busy} onClick={() => void acknowledge(p.id)}>
                <CheckCircle2 className="h-4 w-4" />
                I acknowledge
              </Button>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="font-semibold">My benefits</h3>
        <ResponsiveTableLayout
          mobile={
            benefits.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No active benefit enrollments.</p>
            ) : (
              benefits.map((b) => (
                <MobileRecordCard key={b.id}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="font-semibold">{b.plan_name}</p>
                    <StatusBadge status={b.status} />
                  </div>
                  <div className="space-y-1.5">
                    <MobileRecordCardRow label="Type">
                      <span className="capitalize">{b.plan_type}</span>
                    </MobileRecordCardRow>
                    <MobileRecordCardRow label="Coverage">{b.coverage_level ?? "—"}</MobileRecordCardRow>
                    <MobileRecordCardRow label="Effective">{b.effective_date}</MobileRecordCardRow>
                    <MobileRecordCardRow label="Cost">
                      {formatCurrency(b.employee_cost_monthly, currency)}/mo
                    </MobileRecordCardRow>
                  </div>
                </MobileRecordCard>
              ))
            )
          }
        >
          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Plan</DataTableHead>
                <DataTableHead>Type</DataTableHead>
                <DataTableHead>Coverage</DataTableHead>
                <DataTableHead>Effective</DataTableHead>
                <DataTableHead align="right">Cost/mo</DataTableHead>
                <DataTableHead>Status</DataTableHead>
              </DataTableHeader>
              <DataTableBody>
                {benefits.length === 0 ? (
                  <DataTableEmpty colSpan={6} message="No active benefit enrollments." />
                ) : (
                  benefits.map((b) => (
                    <DataTableRow key={b.id}>
                      <DataTableCell className="font-medium">{b.plan_name}</DataTableCell>
                      <DataTableCell className="capitalize">{b.plan_type}</DataTableCell>
                      <DataTableCell>{b.coverage_level ?? "—"}</DataTableCell>
                      <DataTableCell>{b.effective_date}</DataTableCell>
                      <DataTableCell align="right" className="font-mono">
                        {formatCurrency(b.employee_cost_monthly, currency)}
                      </DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={b.status} />
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </table>
          </DataTable>
        </ResponsiveTableLayout>
      </section>
    </div>
  );
}

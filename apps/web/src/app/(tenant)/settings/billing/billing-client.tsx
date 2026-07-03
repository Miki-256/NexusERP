"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FormCard } from "@/components/layout/form-card";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PAGE_SHELL } from "@/lib/ui-classes";
import type { OrgPlanUsage, PlatformPlan } from "@/lib/admin-types";
import { formatPlanName } from "@/lib/format-plan";
import { ArrowLeft, CheckCircle2, Clock, CreditCard, Mail, XCircle } from "lucide-react";

export type PlanChangeRequest = {
  id: string;
  current_plan: string;
  requested_plan: string;
  status: string;
  note: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

function formatLimit(value: number | null) {
  if (value == null) return "Unlimited";
  return value.toLocaleString();
}

function UsageMeter({
  label,
  used,
  max,
  ok,
}: {
  label: string;
  used: number;
  max: number | null;
  ok: boolean;
}) {
  const pct = max == null || max === 0 ? 0 : Math.min(100, Math.round((used / max) * 100));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={ok ? "text-muted-foreground" : "font-medium text-red-600"}>
          {used.toLocaleString()}
          {max != null ? ` / ${max.toLocaleString()}` : " / ∞"}
          {!ok && " · over limit"}
        </span>
      </div>
      {max != null && (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${ok ? "bg-primary" : "bg-red-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function RequestStatus({ status }: { status: string }) {
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700">
        <Clock className="h-4 w-4" />
        Pending review
      </span>
    );
  }
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <CheckCircle2 className="h-4 w-4" />
        Approved
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 text-red-700">
        <XCircle className="h-4 w-4" />
        Rejected
      </span>
    );
  }
  return <span className="capitalize text-muted-foreground">{status}</span>;
}

export function BillingClient({
  organizationId,
  usage,
  plans,
  requests,
  canManage,
}: {
  organizationId: string;
  usage: OrgPlanUsage;
  plans: PlatformPlan[];
  requests: PlanChangeRequest[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const currentPlan = plans.find((p) => p.id === usage.plan);
  const upgradePlans = plans.filter((p) => p.id !== usage.plan);
  const pendingRequest = requests.find((r) => r.status === "pending");

  async function requestUpgrade(planId: string) {
    setLoadingPlan(planId);
    const supabase = createClient();
    const { error } = await supabase.rpc("request_plan_change", {
      p_organization_id: organizationId,
      p_requested_plan: planId,
      p_note: note.trim() || null,
    });
    setLoadingPlan(null);
    if (error) {
      toast({ title: "Request failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Upgrade requested", description: "A platform admin will review your request." });
    setNote("");
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <div className="mb-6">
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" asChild>
          <Link href="/settings">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <PageHeader
          title="Billing & plan"
          description="Your subscription tier and usage against plan limits."
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <FormCard title="Current plan">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-2xl font-semibold tracking-tight">
                {formatPlanName(usage.plan, usage.plan_name)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatPlanName(usage.plan, usage.plan_name)} plan
              </p>
            </div>
            <CreditCard className="h-8 w-8 text-muted-foreground" />
          </div>
          {currentPlan?.modules?.length ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Includes: {currentPlan.modules.join(", ")}
            </p>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">All ERP modules included.</p>
          )}
        </FormCard>

        <FormCard title="Usage this month">
          <div className="space-y-5">
            <UsageMeter
              label="Stores"
              used={usage.usage.stores}
              max={usage.limits.max_stores}
              ok={usage.within_limits.stores}
            />
            <UsageMeter
              label="Team members"
              used={usage.usage.members}
              max={usage.limits.max_members}
              ok={usage.within_limits.members}
            />
            <UsageMeter
              label="Completed sales"
              used={usage.usage.sales_this_month}
              max={usage.limits.max_sales_per_month}
              ok={usage.within_limits.sales}
            />
          </div>
        </FormCard>
      </div>

      {requests.length > 0 && (
        <FormCard className="mt-6" title="Plan change requests">
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {formatPlanName(r.current_plan)} → {formatPlanName(r.requested_plan)}
                  </span>
                  <RequestStatus status={r.status} />
                </div>
                {r.note && <p className="mt-2 text-muted-foreground">Your note: {r.note}</p>}
                {r.review_note && (
                  <p className="mt-1 text-muted-foreground">Admin: {r.review_note}</p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </FormCard>
      )}

      {canManage && upgradePlans.length > 0 && (
        <FormCard
          className="mt-6"
          title="Request an upgrade"
          description="Submit a request for a higher plan. A platform admin will approve it manually."
        >
          {pendingRequest ? (
            <p className="text-sm text-amber-800">
              You already have a pending request for the{" "}
              <span className="font-medium">{formatPlanName(pendingRequest.requested_plan)}</span> plan.
            </p>
          ) : (
            <>
              <div className="mb-4 space-y-2">
                <Label htmlFor="upgrade-note">Note for admin (optional)</Label>
                <Input
                  id="upgrade-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Need more stores for new branch"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {upgradePlans.map((plan) => (
                  <div
                    key={plan.id}
                    className="rounded-lg border border-border bg-muted/30 p-4"
                  >
                    <p className="font-semibold">{formatPlanName(plan.id, plan.name)}</p>
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      <li>Stores: {formatLimit(plan.max_stores)}</li>
                      <li>Members: {formatLimit(plan.max_members)}</li>
                      <li>Sales / month: {formatLimit(plan.max_sales_per_month)}</li>
                    </ul>
                    <Button
                      className="mt-4"
                      size="sm"
                      disabled={loadingPlan !== null}
                      onClick={() => void requestUpgrade(plan.id)}
                    >
                      {loadingPlan === plan.id ? "Submitting…" : `Request ${formatPlanName(plan.id, plan.name)}`}
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4 shrink-0" />
            Online payments via Stripe are not enabled yet — upgrades are manual.
          </p>
        </FormCard>
      )}
    </div>
  );
}

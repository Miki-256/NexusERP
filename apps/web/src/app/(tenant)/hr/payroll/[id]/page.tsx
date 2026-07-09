import { getMemberPermissions } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import type { PayrollRunDetail } from "@/lib/hr/types";
import { PayrollRunClient } from "./payroll-run-client";

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getMemberPermissions();
  if (!ctx) redirect("/onboarding");
  if (!ctx.canAccessApp("hr") && !ctx.canAccessApp("timeoff")) redirect("/dashboard");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_payroll_run_detail", { p_run_id: id });
  if (error || !data) notFound();

  const detail = data as PayrollRunDetail;

  return (
    <PayrollRunClient
      organizationId={ctx.organization.id}
      currency={ctx.organization.currency}
      detail={detail}
      backHref={detail.can_manage ? "/hr" : "/time-off?tab=payslips"}
    />
  );
}

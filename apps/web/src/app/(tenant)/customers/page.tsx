import { getCurrentMembership } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CustomersClient } from "./customers-client";

export type ContactSummary = {
  customer_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  total_spent: number;
  order_count: number;
  last_order: string | null;
};

export default async function CustomersPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const { data } = await supabase.rpc("customer_summary", {
    p_org_id: ctx.organization.id,
  });

  return (
    <CustomersClient
      organizationId={ctx.organization.id}
      currency={ctx.organization.currency}
      contacts={(data as ContactSummary[]) ?? []}
    />
  );
}

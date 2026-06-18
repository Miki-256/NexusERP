import { getCurrentMembership } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CrmClient } from "./crm-client";

export type Opportunity = {
  id: string;
  title: string;
  contact_name: string | null;
  contact_phone: string | null;
  stage: "lead" | "qualified" | "proposal" | "won" | "lost";
  expected_value: number;
  probability: number;
  customer_id: string | null;
};

export default async function CrmPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: opps }, { data: customers }] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id, title, contact_name, contact_phone, stage, expected_value, probability, customer_id")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("customers").select("id, name").eq("organization_id", orgId).order("name"),
  ]);

  return (
    <CrmClient
      organizationId={orgId}
      currency={ctx.organization.currency}
      opportunities={(opps as Opportunity[]) ?? []}
      customers={(customers as { id: string; name: string | null }[]) ?? []}
    />
  );
}

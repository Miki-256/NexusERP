import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { CreditsClient } from "./credits-client";

export type CreditRow = {
  id: string;
  balance: number;
  customer_id: string;
  customers: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null;
};

export type CreditTx = {
  id: string;
  amount: number;
  reason: string | null;
  created_at: string;
  customers: { name: string | null } | { name: string | null }[] | null;
};

export default async function CreditsPage() {
  const ctx = await requireAppAccess("credits");

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: credits }, { data: txs }, { data: customers }] = await Promise.all([
    supabase
      .from("customer_credits")
      .select("id, balance, customer_id, customers(name, phone)")
      .eq("organization_id", orgId)
      .order("balance", { ascending: false }),
    supabase
      .from("credit_transactions")
      .select("id, amount, reason, created_at, customers(name)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("customers").select("id, name").eq("organization_id", orgId).order("name"),
  ]);

  return (
    <CreditsClient
      organizationId={orgId}
      currency={ctx.organization.currency}
      canManage={ctx.canManageApp("credits")}
      credits={(credits as unknown as CreditRow[]) ?? []}
      transactions={(txs as unknown as CreditTx[]) ?? []}
      customers={(customers as { id: string; name: string | null }[]) ?? []}
    />
  );
}

import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { ReceivablesClient } from "./receivables-client";

export type ReceivableRow = {
  id: string;
  balance: number;
  customer_id: string;
  customers: {
    name: string | null;
    phone: string | null;
    on_account_enabled: boolean;
    credit_limit: number | null;
  } | {
    name: string | null;
    phone: string | null;
    on_account_enabled: boolean;
    credit_limit: number | null;
  }[] | null;
};

export type ReceivableTx = {
  id: string;
  amount: number;
  reason: string | null;
  payment_method: string | null;
  created_at: string;
  customers: { name: string | null } | { name: string | null }[] | null;
};

export default async function ReceivablesPage() {
  const ctx = await requireAppAccess("receivables");

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: receivables }, { data: txs }, { data: customers }] = await Promise.all([
    supabase
      .from("customer_receivables")
      .select("id, balance, customer_id, customers(name, phone, on_account_enabled, credit_limit)")
      .eq("organization_id", orgId)
      .order("balance", { ascending: false }),
    supabase
      .from("receivable_transactions")
      .select("id, amount, reason, payment_method, created_at, customers(name)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("customers")
      .select("id, name, on_account_enabled, credit_limit")
      .eq("organization_id", orgId)
      .order("name"),
  ]);

  return (
    <ReceivablesClient
      organizationId={orgId}
      currency={ctx.organization.currency}
      canManage={ctx.canManageApp("receivables")}
      receivables={(receivables as unknown as ReceivableRow[]) ?? []}
      transactions={(txs as unknown as ReceivableTx[]) ?? []}
      customers={(customers as { id: string; name: string | null; on_account_enabled: boolean; credit_limit: number | null }[]) ?? []}
    />
  );
}

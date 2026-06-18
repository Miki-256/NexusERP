import { getCurrentMembership, canManage } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PurchasingClient } from "./purchasing-client";

export type VendorRow = { id: string; name: string; phone: string | null; email: string | null };
export type PORow = {
  id: string;
  status: "draft" | "ordered" | "received" | "cancelled";
  order_date: string;
  total: number;
  vendors: { name: string } | { name: string }[] | null;
  stores: { name: string } | { name: string }[] | null;
};
export type BillRow = {
  id: string;
  bill_date: string;
  amount: number;
  status: "open" | "paid";
  vendors: { name: string } | { name: string }[] | null;
};
export type VariantOption = {
  id: string;
  name: string;
  cost_price: number | null;
  products: { name: string } | { name: string }[] | null;
};

export default async function PurchasingPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: vendors }, { data: stores }, { data: pos }, { data: bills }, { data: variants }] =
    await Promise.all([
      supabase.from("vendors").select("id, name, phone, email").eq("organization_id", orgId).order("name"),
      supabase.from("stores").select("id, name").eq("organization_id", orgId).order("name"),
      supabase
        .from("purchase_orders")
        .select("id, status, order_date, total, vendors(name), stores(name)")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("vendor_bills")
        .select("id, bill_date, amount, status, vendors(name)")
        .eq("organization_id", orgId)
        .order("bill_date", { ascending: false })
        .limit(100),
      supabase
        .from("product_variants")
        .select("id, name, cost_price, products(name)")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .limit(500),
    ]);

  return (
    <PurchasingClient
      organizationId={orgId}
      currency={ctx.organization.currency}
      canManage={canManage(ctx.member.role)}
      vendors={(vendors as VendorRow[]) ?? []}
      stores={(stores as { id: string; name: string }[]) ?? []}
      purchaseOrders={(pos as unknown as PORow[]) ?? []}
      bills={(bills as unknown as BillRow[]) ?? []}
      variants={(variants as unknown as VariantOption[]) ?? []}
    />
  );
}

import { getCurrentMembership, canManage } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProductsClient } from "./products-client";

export default async function ProductsPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select(
      "*, categories(name), product_variants(id, name, sell_price, barcode)"
    )
    .eq("organization_id", ctx.organization.id)
    .order("name");

  const { data: categories } = await supabase
    .from("categories")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .order("sort_order");

  const { data: stores } = await supabase
    .from("stores")
    .select("id, name")
    .eq("organization_id", ctx.organization.id)
    .eq("is_active", true);

  return (
    <ProductsClient
      products={products ?? []}
      categories={categories ?? []}
      stores={stores ?? []}
      organizationId={ctx.organization.id}
      currency={ctx.organization.currency}
      canManage={canManage(ctx.member.role)}
    />
  );
}

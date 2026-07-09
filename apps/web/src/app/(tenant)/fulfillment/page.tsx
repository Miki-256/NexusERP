import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { FulfillmentClient } from "./fulfillment-client";

export default async function FulfillmentPage() {
  const ctx = await requireAppAccess("inventory");
  const orgId = ctx.organization.id;

  const supabase = await createClient();
  const { data: stores } = await supabase
    .from("stores")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("is_active", true);

  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, name, products(name)")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name")
    .limit(500);

  const variantOptions = (variants ?? []).map((v) => {
    const product = Array.isArray(v.products) ? v.products[0] : v.products;
    const productName = (product as { name?: string } | null)?.name ?? "Product";
    return {
      variant_id: v.id,
      label: v.name === "Default" ? productName : `${productName} (${v.name})`,
    };
  });

  return (
    <FulfillmentClient
      organizationId={orgId}
      stores={stores ?? []}
      variants={variantOptions}
      canManage={ctx.canManageApp("inventory")}
    />
  );
}

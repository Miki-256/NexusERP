import { getCurrentMembership, canManage } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { InventoryClient } from "./inventory-client";

export default async function InventoryPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const { data: stores } = await supabase
    .from("stores")
    .select("id, name")
    .eq("organization_id", ctx.organization.id)
    .eq("is_active", true);

  const storeId = stores?.[0]?.id;
  let inventory: unknown[] = [];

  if (storeId) {
    const { data } = await supabase
      .from("inventory_levels")
      .select(
        "id, quantity, variant_id, product_variants(id, name, barcode, products(name, sell_price))"
      )
      .eq("store_id", storeId);
    inventory = (data as unknown as InventoryRow[]) ?? [];
  }

  return (
    <InventoryClient
      stores={stores ?? []}
      initialInventory={inventory as InventoryRow[]}
      canManage={canManage(ctx.member.role)}
    />
  );
}

export type InventoryRow = {
  id: string;
  quantity: number;
  variant_id: string;
  product_variants: {
    id: string;
    name: string;
    barcode: string | null;
    products: { name: string; sell_price: number };
  };
};

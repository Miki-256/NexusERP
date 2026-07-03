import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { InventoryClient } from "./inventory-client";

export default async function InventoryPage() {
  const ctx = await requireAppAccess("inventory");

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
        "id, quantity, variant_id, product_variants(id, name, barcode, products(name, sell_price, reorder_point))"
      )
      .eq("store_id", storeId);
    inventory = (data as unknown as InventoryRow[]) ?? [];
  }

  return (
    <InventoryClient
      organizationId={ctx.organization.id}
      stores={stores ?? []}
      initialInventory={inventory as InventoryRow[]}
      canManage={ctx.canManageApp("inventory")}
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
    products: { name: string; sell_price: number; reorder_point?: number };
  };
};

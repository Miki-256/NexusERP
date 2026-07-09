import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { parsePaginatedRpc } from "@/lib/hr/mutations";
import { INVENTORY_PAGE_SIZE, type InventoryLevelPageRow } from "@/lib/scm/types";
import { InventoryClient } from "./inventory-client";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; store?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireAppAccess("inventory");
  const orgId = ctx.organization.id;

  const supabase = await createClient();
  const { data: stores } = await supabase
    .from("stores")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("is_active", true);

  const storeList = stores ?? [];
  const storeId =
    storeList.find((s) => s.id === params.store)?.id ?? storeList[0]?.id ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const search = params.q?.trim() || "";

  let inventoryParsed = { items: [] as InventoryLevelPageRow[], total_count: 0 };
  if (storeId) {
    const { data } = await supabase.rpc("list_inventory_levels_page", {
      p_org_id: orgId,
      p_store_id: storeId,
      p_search: search || null,
      p_limit: INVENTORY_PAGE_SIZE,
      p_offset: (page - 1) * INVENTORY_PAGE_SIZE,
    });
    inventoryParsed = parsePaginatedRpc<InventoryLevelPageRow>(data);
  }

  return (
    <InventoryClient
      organizationId={orgId}
      stores={storeList}
      storeId={storeId}
      inventory={inventoryParsed.items}
      inventoryTotal={inventoryParsed.total_count}
      page={page}
      pageSize={INVENTORY_PAGE_SIZE}
      search={search}
      canManage={ctx.canManageApp("inventory")}
      currency={ctx.organization.currency ?? "USD"}
    />
  );
}

/** @deprecated Use InventoryLevelPageRow from @/lib/scm/types */
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

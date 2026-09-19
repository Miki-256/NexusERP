import { createClient } from "@/lib/supabase/client";
import { cachePosCatalog } from "@/lib/offline/pos-cache";
import type { PosCatalogItem } from "@/components/pos/product-card";
import { perfTime } from "@/lib/perf";

type StockLevelRow = { variantId: string; stock: number };

/**
 * Targeted stock refresh — updates quantity only for the given variants.
 * Avoids unbounded get_pos_catalog after every sale/void.
 */
export async function fetchPosStockLevels(
  registerId: string,
  variantIds: string[]
): Promise<Map<string, number>> {
  const ids = [...new Set(variantIds.filter(Boolean))];
  const map = new Map<string, number>();
  if (ids.length === 0) return map;

  const supabase = createClient();
  const { data, error } = await perfTime("pos.stock_levels", async () =>
    supabase.rpc("get_pos_stock_levels", {
      p_register_id: registerId,
      p_variant_ids: ids,
    })
  );

  if (error || !data) return map;

  for (const row of data as StockLevelRow[]) {
    if (row?.variantId != null) map.set(row.variantId, Number(row.stock) || 0);
  }
  return map;
}

export function applyStockLevels(
  catalog: PosCatalogItem[],
  levels: Map<string, number>
): PosCatalogItem[] {
  if (levels.size === 0) return catalog;
  return catalog.map((item) => {
    if (!levels.has(item.variantId)) return item;
    return { ...item, stock: levels.get(item.variantId)! };
  });
}

export async function refreshCatalogStock(
  registerId: string,
  catalog: PosCatalogItem[],
  variantIds: string[],
  persist = true
): Promise<PosCatalogItem[]> {
  const levels = await fetchPosStockLevels(registerId, variantIds);
  const next = applyStockLevels(catalog, levels);
  if (persist && levels.size > 0) {
    void cachePosCatalog(registerId, next);
  }
  return next;
}

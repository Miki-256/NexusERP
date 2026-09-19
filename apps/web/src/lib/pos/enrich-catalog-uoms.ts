import type { PosCatalogItem, PosSaleUom } from "@/components/pos/product-card";
import { createClient } from "@/lib/supabase/client";

type UomRow = {
  product_id: string;
  uom_code: string;
  uom_name: string;
  conversion_factor: number;
  is_base: boolean;
  is_sale: boolean;
};

/** Fill missing saleUoms from product_uoms (covers stale bootstrap / offline cache). */
export async function enrichCatalogSaleUoms(
  catalog: PosCatalogItem[]
): Promise<PosCatalogItem[]> {
  const missingProductIds = [
    ...new Set(
      catalog
        .filter((c) => !c.saleUoms?.length && c.productId)
        .map((c) => c.productId)
    ),
  ];
  if (missingProductIds.length === 0) return catalog;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("product_uoms")
    .select("product_id, uom_code, uom_name, conversion_factor, is_base, is_sale")
    .in("product_id", missingProductIds);

  if (error || !data?.length) return catalog;

  const byProduct = new Map<string, PosSaleUom[]>();
  for (const row of data as UomRow[]) {
    if (!(row.is_sale || row.is_base)) continue;
    const list = byProduct.get(row.product_id) ?? [];
    list.push({
      code: row.uom_code,
      name: row.uom_name,
      factor: Number(row.conversion_factor) || 1,
      isBase: Boolean(row.is_base),
    });
    byProduct.set(row.product_id, list);
  }

  return catalog.map((item) => {
    if (item.saleUoms?.length) return item;
    const uoms = byProduct.get(item.productId);
    if (!uoms?.length) return item;
    uoms.sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.code.localeCompare(b.code));
    return { ...item, saleUoms: uoms };
  });
}

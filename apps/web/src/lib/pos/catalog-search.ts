import type { PosCatalogItem } from "@/components/pos/product-card";

export type CatalogSearchIndex = {
  byBarcode: Map<string, string>;
  bySku: Map<string, string>;
  byVariantId: Map<string, PosCatalogItem>;
};

export function buildCatalogSearchIndex(catalog: PosCatalogItem[]): CatalogSearchIndex {
  const byBarcode = new Map<string, string>();
  const bySku = new Map<string, string>();
  const byVariantId = new Map<string, PosCatalogItem>();

  for (const item of catalog) {
    byVariantId.set(item.variantId, item);
    if (item.barcode) byBarcode.set(item.barcode, item.variantId);
    if (item.sku) bySku.set(item.sku.toLowerCase(), item.variantId);
  }

  return { byBarcode, bySku, byVariantId };
}

export function filterCatalogItems(
  catalog: PosCatalogItem[],
  index: CatalogSearchIndex,
  opts: {
    search: string;
    category: string;
    viewFavorites: boolean;
    viewRecent: boolean;
    favorites: Set<string>;
    recentVariantIds: string[];
  }
): PosCatalogItem[] {
  let items = catalog;

  if (opts.viewFavorites) {
    items = items.filter((p) => opts.favorites.has(p.variantId));
  } else if (opts.viewRecent) {
    const recent = new Set(opts.recentVariantIds);
    items = items.filter((p) => recent.has(p.variantId));
  } else if (opts.category !== "all") {
    items = items.filter((p) => p.categoryName === opts.category);
  }

  const q = opts.search.trim();
  if (!q) return items;

  const lower = q.toLowerCase();

  // Exact barcode / SKU match (O(1))
  const byBarcode = index.byBarcode.get(q) ?? index.byBarcode.get(lower);
  if (byBarcode) {
    const hit = index.byVariantId.get(byBarcode);
    return hit ? [hit] : items;
  }
  const bySku = index.bySku.get(lower);
  if (bySku) {
    const hit = index.byVariantId.get(bySku);
    return hit ? [hit] : items;
  }

  // Name prefix / contains — still client-side but scoped to category-filtered set
  return items.filter(
    (p) =>
      p.name.toLowerCase().includes(lower) ||
      (p.variantName && p.variantName.toLowerCase().includes(lower)) ||
      (p.sku && p.sku.toLowerCase().includes(lower)) ||
      (p.barcode && p.barcode.includes(q))
  );
}

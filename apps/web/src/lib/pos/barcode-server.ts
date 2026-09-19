import { fetchPosCatalogPage } from "@/lib/pos/catalog-page";
import { enrichCatalogSaleUoms } from "@/lib/pos/enrich-catalog-uoms";
import { barcodeLookupVariants, isValidBarcode, normalizeBarcode } from "@/lib/pos/barcode-scan";
import { perfTime } from "@/lib/perf";
import type { PosCatalogItem } from "@/components/pos/product-card";

/**
 * Exact barcode / SKU server lookup when local catalog misses (truncated catalogs).
 * Never uses fuzzy name search — only barcode equality / SKU ILIKE exact via page RPC.
 */
export async function fetchProductByBarcode(
  registerId: string,
  rawCode: string
): Promise<PosCatalogItem | null> {
  const code = normalizeBarcode(rawCode);
  if (!code || !isValidBarcode(code)) return null;

  const variants = barcodeLookupVariants(code);

  return perfTime("pos.barcode.server", async () => {
    for (const candidate of variants) {
      const page = await fetchPosCatalogPage(registerId, {
        search: candidate,
        limit: 5,
        offset: 0,
      });
      const exact = page.items.find((item) => {
        const bc = (item.barcode ?? "").trim();
        const sku = (item.sku ?? "").trim();
        return (
          bc === candidate ||
          sku.toLowerCase() === candidate.toLowerCase() ||
          barcodeLookupVariants(bc).includes(candidate)
        );
      });
      if (exact) {
        const [enriched] = await enrichCatalogSaleUoms([exact]);
        return enriched ?? exact;
      }
    }
    return null;
  });
}

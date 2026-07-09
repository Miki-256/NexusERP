import { createClient } from "@/lib/supabase/client";
import type { PosCatalogItem } from "@/components/pos/product-card";

export type CatalogPageResult = {
  items: PosCatalogItem[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

/** Server-side catalog page for large SKU lists and search fallback. */
export async function fetchPosCatalogPage(
  registerId: string,
  opts: {
    search?: string;
    category?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<CatalogPageResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_pos_catalog_page", {
    p_register_id: registerId,
    p_search: opts.search?.trim() || null,
    p_category: opts.category && opts.category !== "all" ? opts.category : null,
    p_limit: opts.limit ?? 200,
    p_offset: opts.offset ?? 0,
  });

  if (error) throw error;

  const row = data as {
    items?: PosCatalogItem[];
    total?: number;
    offset?: number;
    limit?: number;
    has_more?: boolean;
  };

  const items = (row?.items ?? []).filter((c) => c.variantId);
  return {
    items,
    total: row?.total ?? items.length,
    offset: row?.offset ?? 0,
    limit: row?.limit ?? items.length,
    hasMore: row?.has_more ?? false,
  };
}

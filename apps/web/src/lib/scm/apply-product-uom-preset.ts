import { createClient } from "@/lib/supabase/client";
import { buildUomPreset, type UomPresetKind } from "@/lib/scm/uom-pricing";

type Supabase = ReturnType<typeof createClient>;

/** Apply a fixed UOM preset to a product via upsert_product_uom (idempotent). */
export async function applyProductUomPreset(
  supabase: Supabase,
  productId: string,
  kind: UomPresetKind,
  packSize = 24
): Promise<{ error: string | null }> {
  const ctx = buildUomPreset(kind, packSize);
  const { data: existing } = await supabase
    .from("product_uoms")
    .select("id, uom_code")
    .eq("product_id", productId);

  const byCode = new Map(
    ((existing as { id: string; uom_code: string }[] | null) ?? []).map((r) => [
      r.uom_code.toLowerCase(),
      r.id,
    ])
  );

  for (const spec of ctx.specs) {
    const { error } = await supabase.rpc("upsert_product_uom", {
      p_product_id: productId,
      p_uom_code: spec.code,
      p_uom_name: spec.name,
      p_conversion_factor: spec.factor,
      p_is_base: spec.isBase,
      p_is_sale: spec.isSale,
      p_is_purchase: spec.isPurchase,
      p_uom_id: byCode.get(spec.code.toLowerCase()) ?? null,
    });
    if (error) return { error: error.message };
  }
  return { error: null };
}

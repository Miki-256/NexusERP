import { getCurrentMembership } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { PosScreen } from "@/components/pos/pos-screen";

export default async function PosRegisterPage({
  params,
}: {
  params: Promise<{ registerId: string }>;
}) {
  const { registerId } = await params;
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const { data: register } = await supabase
    .from("registers")
    .select("*, stores(id, name)")
    .eq("id", registerId)
    .eq("organization_id", ctx.organization.id)
    .single();

  if (!register) notFound();

  const storeRaw = register.stores as
    | { id: string; name: string }
    | { id: string; name: string }[];
  const store = Array.isArray(storeRaw) ? storeRaw[0] : storeRaw;
  if (!store) notFound();

  const { data: products } = await supabase
    .from("products")
    .select(
      "id, name, sell_price, barcode, product_variants(id, name, sell_price, barcode)"
    )
    .eq("organization_id", ctx.organization.id)
    .eq("is_active", true)
    .order("name");

  const variantIds =
    products?.flatMap((p) =>
      (p.product_variants as { id: string }[]).map((v) => v.id)
    ) ?? [];

  const { data: inventory } = await supabase
    .from("inventory_levels")
    .select("variant_id, quantity")
    .eq("store_id", store.id)
    .in("variant_id", variantIds.length ? variantIds : ["00000000-0000-0000-0000-000000000000"]);

  const { data: openSession } = await supabase
    .from("register_sessions")
    .select("*")
    .eq("register_id", registerId)
    .is("closed_at", null)
    .maybeSingle();

  const catalog = (products ?? []).map((p) => {
    const variants = p.product_variants as {
      id: string;
      name: string;
      sell_price: number | null;
      barcode: string | null;
    }[];
    const variant = variants[0];
    const stock =
      inventory?.find((i) => i.variant_id === variant?.id)?.quantity ?? 0;
    return {
      productId: p.id,
      variantId: variant?.id ?? "",
      name: p.name,
      variantName: variant?.name ?? "Default",
      sellPrice: variant?.sell_price ?? p.sell_price,
      barcode: variant?.barcode ?? p.barcode,
      stock: Number(stock),
    };
  });

  return (
    <PosScreen
      registerId={registerId}
      registerName={register.name}
      storeId={store.id}
      storeName={store.name}
      organizationId={ctx.organization.id}
      currency={ctx.organization.currency}
      taxRate={ctx.organization.tax_rate}
      taxInclusive={ctx.organization.tax_inclusive}
      orgName={ctx.organization.name}
      receiptFooter={ctx.organization.receipt_footer}
      catalog={catalog.filter((c) => c.variantId)}
      openSession={openSession}
    />
  );
}

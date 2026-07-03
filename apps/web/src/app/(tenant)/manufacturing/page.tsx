import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { ManufacturingClient } from "./manufacturing-client";

export type BomRow = {
  id: string;
  name: string;
  output_qty: number;
  is_active: boolean;
  product_variants: { name: string; products: { name: string } | { name: string }[] | null } | null;
};

export type MoRow = {
  id: string;
  status: string;
  quantity: number;
  scheduled_date: string | null;
  boms: { name: string } | { name: string }[] | null;
  stores: { name: string } | { name: string }[] | null;
};

export type VariantOption = {
  id: string;
  name: string;
  products: { name: string } | { name: string }[] | null;
};

export default async function ManufacturingPage() {
  const ctx = await requireAppAccess("manufacturing");

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: boms }, { data: mos }, { data: variants }, { data: stores }] = await Promise.all([
    supabase
      .from("boms")
      .select("id, name, output_qty, is_active, product_variants(name, products(name))")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    supabase
      .from("manufacturing_orders")
      .select("id, status, quantity, scheduled_date, boms(name), stores(name)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("product_variants")
      .select("id, name, products(name)")
      .eq("organization_id", orgId)
      .order("name"),
    supabase.from("stores").select("id, name").eq("organization_id", orgId).order("name"),
  ]);

  return (
    <ManufacturingClient
      organizationId={orgId}
      boms={(boms as unknown as BomRow[]) ?? []}
      orders={(mos as unknown as MoRow[]) ?? []}
      variants={(variants as unknown as VariantOption[]) ?? []}
      stores={(stores as { id: string; name: string }[]) ?? []}
    />
  );
}

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const ORG_ID = "bc3717ca-62e9-4cfd-b0da-019499953072";

const SAMPLE_PRODUCTS = [
  { category: "Beverages", name: "Bottled Water 1.5L", sku: "BEV-001", barcode: "1001001001001", sell: 25, cost: 15, qty: 120 },
  { category: "Beverages", name: "Coca-Cola 500ml", sku: "BEV-002", barcode: "1001001001002", sell: 35, cost: 22, qty: 80 },
  { category: "Groceries", name: "Coffee Bun (250g)", sku: "GRO-001", barcode: "2001001001001", sell: 180, cost: 120, qty: 45 },
  { category: "Groceries", name: "White Bread Loaf", sku: "GRO-002", barcode: "2001001001002", sell: 40, cost: 25, qty: 60 },
  { category: "Groceries", name: "Sugar 1kg", sku: "GRO-003", barcode: "2001001001003", sell: 95, cost: 70, qty: 100 },
  { category: "Groceries", name: "Cooking Oil 1L", sku: "GRO-004", barcode: "2001001001004", sell: 220, cost: 165, qty: 35 },
  { category: "Groceries", name: "Rice 1kg", sku: "GRO-005", barcode: "2001001001005", sell: 85, cost: 60, qty: 90 },
  { category: "Groceries", name: "Fresh Milk 1L", sku: "GRO-006", barcode: "2001001001006", sell: 75, cost: 55, qty: 40 },
  { category: "Household", name: "Laundry Soap Bar", sku: "HOU-001", barcode: "3001001001001", sell: 35, cost: 20, qty: 75 },
  { category: "Household", name: "Detergent Powder 500g", sku: "HOU-002", barcode: "3001001001002", sell: 120, cost: 85, qty: 50 },
];

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        error: "Add SUPABASE_SERVICE_ROLE_KEY to apps/web/.env.local",
        sqlFile: "supabase/seeds/sample_products_bc3717ca.sql",
      },
      { status: 500 }
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: store, error: storeErr } = await admin
    .from("stores")
    .select("id")
    .eq("organization_id", ORG_ID)
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (storeErr || !store) {
    return NextResponse.json(
      { error: storeErr?.message ?? "No store found for organization" },
      { status: 400 }
    );
  }

  const categoryIds = new Map<string, string>();
  const created: string[] = [];

  for (const item of SAMPLE_PRODUCTS) {
    if (!categoryIds.has(item.category)) {
      const { data: cat, error: catErr } = await admin
        .from("categories")
        .insert({ organization_id: ORG_ID, name: item.category, sort_order: categoryIds.size + 1 })
        .select("id")
        .single();
      if (catErr) {
        return NextResponse.json({ error: catErr.message, step: "category" }, { status: 500 });
      }
      categoryIds.set(item.category, cat.id);
    }

    const { data: product, error: prodErr } = await admin
      .from("products")
      .insert({
        organization_id: ORG_ID,
        category_id: categoryIds.get(item.category)!,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        sell_price: item.sell,
        cost_price: item.cost,
      })
      .select("id")
      .single();

    if (prodErr) {
      return NextResponse.json({ error: prodErr.message, product: item.name }, { status: 500 });
    }

    const { data: variant, error: varErr } = await admin
      .from("product_variants")
      .insert({
        product_id: product.id,
        organization_id: ORG_ID,
        name: "Default",
        sku: item.sku,
        barcode: item.barcode,
        sell_price: item.sell,
        cost_price: item.cost,
      })
      .select("id")
      .single();

    if (varErr) {
      return NextResponse.json({ error: varErr.message, product: item.name }, { status: 500 });
    }

    const { error: invErr } = await admin.from("inventory_levels").upsert(
      {
        store_id: store.id,
        variant_id: variant.id,
        organization_id: ORG_ID,
        quantity: item.qty,
      },
      { onConflict: "store_id,variant_id" }
    );

    if (invErr) {
      return NextResponse.json({ error: invErr.message, product: item.name }, { status: 500 });
    }

    created.push(item.name);
  }

  return NextResponse.json({
    ok: true,
    organizationId: ORG_ID,
    storeId: store.id,
    productsCreated: created.length,
    products: created,
  });
}

/**
 * Seed sample products for a user by email (service role required).
 *
 * Add to apps/web/.env.local:
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 *
 * Run:
 *   node scripts/seed-sample-products.mjs mikiyas256@gmail.com
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const EMAIL = process.argv[2] ?? "mikiyas256@gmail.com";

const SAMPLE_PRODUCTS = [
  { category: "Beverages", name: "Bottled Water 1.5L", sku: "SMP-BEV-001", barcode: "1001001002001", sell: 25, cost: 15, qty: 120 },
  { category: "Beverages", name: "Coca-Cola 500ml", sku: "SMP-BEV-002", barcode: "1001001002002", sell: 35, cost: 22, qty: 80 },
  { category: "Beverages", name: "Orange Juice 1L", sku: "SMP-BEV-003", barcode: "1001001002003", sell: 55, cost: 38, qty: 45 },
  { category: "Beverages", name: "Mineral Water 500ml", sku: "SMP-BEV-004", barcode: "1001001002004", sell: 15, cost: 8, qty: 200 },
  { category: "Groceries", name: "Coffee Bun (250g)", sku: "SMP-GRO-001", barcode: "2001001002001", sell: 180, cost: 120, qty: 45 },
  { category: "Groceries", name: "White Bread Loaf", sku: "SMP-GRO-002", barcode: "2001001002002", sell: 40, cost: 25, qty: 60 },
  { category: "Groceries", name: "Sugar 1kg", sku: "SMP-GRO-003", barcode: "2001001002003", sell: 95, cost: 70, qty: 100 },
  { category: "Groceries", name: "Cooking Oil 1L", sku: "SMP-GRO-004", barcode: "2001001002004", sell: 220, cost: 165, qty: 35 },
  { category: "Groceries", name: "Rice 1kg", sku: "SMP-GRO-005", barcode: "2001001002005", sell: 85, cost: 60, qty: 90 },
  { category: "Groceries", name: "Pasta 500g", sku: "SMP-GRO-006", barcode: "2001001002006", sell: 65, cost: 45, qty: 70 },
  { category: "Groceries", name: "Tomato Paste 70g", sku: "SMP-GRO-007", barcode: "2001001002007", sell: 28, cost: 18, qty: 85 },
  { category: "Groceries", name: "Black Tea 25 bags", sku: "SMP-GRO-008", barcode: "2001001002008", sell: 120, cost: 85, qty: 40 },
  { category: "Groceries", name: "Salt 1kg", sku: "SMP-GRO-009", barcode: "2001001002009", sell: 30, cost: 18, qty: 110 },
  { category: "Groceries", name: "Honey 500g", sku: "SMP-GRO-010", barcode: "2001001002010", sell: 250, cost: 180, qty: 25 },
  { category: "Household", name: "Laundry Soap Bar", sku: "SMP-HOU-001", barcode: "3001001002001", sell: 35, cost: 20, qty: 75 },
  { category: "Household", name: "Detergent Powder 500g", sku: "SMP-HOU-002", barcode: "3001001002002", sell: 120, cost: 85, qty: 50 },
  { category: "Household", name: "Toilet Paper 4-roll", sku: "SMP-HOU-003", barcode: "3001001002003", sell: 95, cost: 65, qty: 55 },
  { category: "Household", name: "Dish Soap 500ml", sku: "SMP-HOU-004", barcode: "3001001002004", sell: 45, cost: 28, qty: 65 },
  { category: "Dairy & Proteins", name: "Fresh Milk 1L", sku: "SMP-DAI-001", barcode: "4001001002001", sell: 75, cost: 55, qty: 40 },
  { category: "Dairy & Proteins", name: "Chicken Eggs (30 pack)", sku: "SMP-DAI-002", barcode: "4001001002002", sell: 320, cost: 250, qty: 30 },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, "apps/web/.env.local");

function loadEnv() {
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local\n");
  console.error("Quick alternative: Supabase Dashboard → SQL Editor → run:");
  console.error("  supabase/seeds/sample_products_mikiyas256.sql");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: users, error: userErr } = await admin.auth.admin.listUsers();
if (userErr) {
  console.error("Auth lookup failed:", userErr.message);
  process.exit(1);
}

const user = users.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
if (!user) {
  console.error(`No user found for ${EMAIL}`);
  process.exit(1);
}

const { data: member, error: memErr } = await admin
  .from("organization_members")
  .select("organization_id")
  .eq("user_id", user.id)
  .eq("is_active", true)
  .limit(1)
  .maybeSingle();

if (memErr || !member) {
  console.error("No active organization:", memErr?.message ?? "not found");
  process.exit(1);
}

const orgId = member.organization_id;

const { data: store, error: storeErr } = await admin
  .from("stores")
  .select("id")
  .eq("organization_id", orgId)
  .eq("is_active", true)
  .order("created_at")
  .limit(1)
  .maybeSingle();

if (storeErr || !store) {
  console.error("No store:", storeErr?.message ?? "not found");
  process.exit(1);
}

const categoryIds = new Map();
const created = [];
const skipped = [];

for (const item of SAMPLE_PRODUCTS) {
  const { data: existing } = await admin
    .from("products")
    .select("id")
    .eq("organization_id", orgId)
    .eq("sku", item.sku)
    .maybeSingle();

  if (existing) {
    skipped.push(item.name);
    continue;
  }

  if (!categoryIds.has(item.category)) {
    const { data: existingCat } = await admin
      .from("categories")
      .select("id")
      .eq("organization_id", orgId)
      .eq("name", item.category)
      .maybeSingle();

    if (existingCat) {
      categoryIds.set(item.category, existingCat.id);
    } else {
      const { data: cat, error: catErr } = await admin
        .from("categories")
        .insert({ organization_id: orgId, name: item.category, sort_order: categoryIds.size + 1 })
        .select("id")
        .single();
      if (catErr) {
        console.error("Category error:", catErr.message);
        process.exit(1);
      }
      categoryIds.set(item.category, cat.id);
    }
  }

  const { data: product, error: prodErr } = await admin
    .from("products")
    .insert({
      organization_id: orgId,
      category_id: categoryIds.get(item.category),
      name: item.name,
      sku: item.sku,
      barcode: item.barcode,
      sell_price: item.sell,
      cost_price: item.cost,
    })
    .select("id")
    .single();

  if (prodErr) {
    console.error("Product error:", prodErr.message, item.name);
    process.exit(1);
  }

  const { data: variant, error: varErr } = await admin
    .from("product_variants")
    .insert({
      product_id: product.id,
      organization_id: orgId,
      name: "Default",
      sku: item.sku,
      barcode: item.barcode,
      sell_price: item.sell,
      cost_price: item.cost,
    })
    .select("id")
    .single();

  if (varErr) {
    console.error("Variant error:", varErr.message, item.name);
    process.exit(1);
  }

  const { error: invErr } = await admin.from("inventory_levels").upsert(
    {
      store_id: store.id,
      variant_id: variant.id,
      organization_id: orgId,
      quantity: item.qty,
    },
    { onConflict: "store_id,variant_id" }
  );

  if (invErr) {
    console.error("Inventory error:", invErr.message, item.name);
    process.exit(1);
  }

  created.push(item.name);
}

console.log(JSON.stringify({
  ok: true,
  email: EMAIL,
  organizationId: orgId,
  storeId: store.id,
  created: created.length,
  skipped: skipped.length,
  products: created,
}, null, 2));

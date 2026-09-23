/**
 * Seed ~35 each-sold products + ~5 weight (g/kg) products for Hammer gebeya.
 *
 *   node scripts/seed-hammer-gebeya-products.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const ORG_NAME = "Hammer gebeya";

/** 35 each-based catalog items (prices ETB, qty in ea). */
const EACH_PRODUCTS = [
  { category: "Beverages", name: "Bottled Water 1.5L", sku: "HG-BEV-001", barcode: "8100100100001", sell: 25, cost: 15, qty: 120 },
  { category: "Beverages", name: "Coca-Cola 500ml", sku: "HG-BEV-002", barcode: "8100100100002", sell: 35, cost: 22, qty: 90 },
  { category: "Beverages", name: "Fanta Orange 500ml", sku: "HG-BEV-003", barcode: "8100100100003", sell: 35, cost: 22, qty: 80 },
  { category: "Beverages", name: "Sprite 500ml", sku: "HG-BEV-004", barcode: "8100100100004", sell: 35, cost: 22, qty: 75 },
  { category: "Beverages", name: "Mineral Water 500ml", sku: "HG-BEV-005", barcode: "8100100100005", sell: 15, cost: 8, qty: 200 },
  { category: "Beverages", name: "Orange Juice 1L", sku: "HG-BEV-006", barcode: "8100100100006", sell: 55, cost: 38, qty: 40 },
  { category: "Beverages", name: "Malt Drink 330ml", sku: "HG-BEV-007", barcode: "8100100100007", sell: 40, cost: 28, qty: 60 },
  { category: "Groceries", name: "White Bread Loaf", sku: "HG-GRO-001", barcode: "8200100100001", sell: 40, cost: 25, qty: 55 },
  { category: "Groceries", name: "Sugar 1kg Pack", sku: "HG-GRO-002", barcode: "8200100100002", sell: 95, cost: 70, qty: 100 },
  { category: "Groceries", name: "Cooking Oil 1L", sku: "HG-GRO-003", barcode: "8200100100003", sell: 220, cost: 165, qty: 45 },
  { category: "Groceries", name: "Rice 1kg Pack", sku: "HG-GRO-004", barcode: "8200100100004", sell: 85, cost: 60, qty: 90 },
  { category: "Groceries", name: "Pasta 500g", sku: "HG-GRO-005", barcode: "8200100100005", sell: 65, cost: 45, qty: 70 },
  { category: "Groceries", name: "Tomato Paste 70g", sku: "HG-GRO-006", barcode: "8200100100006", sell: 28, cost: 18, qty: 85 },
  { category: "Groceries", name: "Black Tea 25 bags", sku: "HG-GRO-007", barcode: "8200100100007", sell: 120, cost: 85, qty: 40 },
  { category: "Groceries", name: "Salt 1kg Pack", sku: "HG-GRO-008", barcode: "8200100100008", sell: 30, cost: 18, qty: 110 },
  { category: "Groceries", name: "Honey 500g Jar", sku: "HG-GRO-009", barcode: "8200100100009", sell: 250, cost: 180, qty: 25 },
  { category: "Groceries", name: "Lentils 1kg Pack", sku: "HG-GRO-010", barcode: "8200100100010", sell: 110, cost: 80, qty: 50 },
  { category: "Groceries", name: "Chickpeas 1kg Pack", sku: "HG-GRO-011", barcode: "8200100100011", sell: 130, cost: 95, qty: 40 },
  { category: "Groceries", name: "Injera Flour 1kg", sku: "HG-GRO-012", barcode: "8200100100012", sell: 75, cost: 55, qty: 60 },
  { category: "Household", name: "Laundry Soap Bar", sku: "HG-HOU-001", barcode: "8300100100001", sell: 35, cost: 20, qty: 75 },
  { category: "Household", name: "Detergent Powder 500g", sku: "HG-HOU-002", barcode: "8300100100002", sell: 120, cost: 85, qty: 50 },
  { category: "Household", name: "Toilet Paper 4-roll", sku: "HG-HOU-003", barcode: "8300100100003", sell: 95, cost: 65, qty: 55 },
  { category: "Household", name: "Dish Soap 500ml", sku: "HG-HOU-004", barcode: "8300100100004", sell: 45, cost: 28, qty: 65 },
  { category: "Household", name: "Hand Sanitizer 250ml", sku: "HG-HOU-005", barcode: "8300100100005", sell: 85, cost: 55, qty: 35 },
  { category: "Household", name: "Trash Bags 20pc", sku: "HG-HOU-006", barcode: "8300100100006", sell: 70, cost: 45, qty: 40 },
  { category: "Dairy & Proteins", name: "Fresh Milk 1L", sku: "HG-DAI-001", barcode: "8400100100001", sell: 75, cost: 55, qty: 40 },
  { category: "Dairy & Proteins", name: "Chicken Eggs (30 pack)", sku: "HG-DAI-002", barcode: "8400100100002", sell: 320, cost: 250, qty: 30 },
  { category: "Dairy & Proteins", name: "Yogurt Cup 150g", sku: "HG-DAI-003", barcode: "8400100100003", sell: 35, cost: 22, qty: 50 },
  { category: "Dairy & Proteins", name: "Butter 200g", sku: "HG-DAI-004", barcode: "8400100100004", sell: 180, cost: 130, qty: 25 },
  { category: "Snacks", name: "Biscuits Pack", sku: "HG-SNK-001", barcode: "8500100100001", sell: 45, cost: 28, qty: 80 },
  { category: "Snacks", name: "Potato Chips 50g", sku: "HG-SNK-002", barcode: "8500100100002", sell: 30, cost: 18, qty: 90 },
  { category: "Snacks", name: "Chocolate Bar 40g", sku: "HG-SNK-003", barcode: "8500100100003", sell: 55, cost: 35, qty: 70 },
  { category: "Snacks", name: "Peanut Butter 350g", sku: "HG-SNK-004", barcode: "8500100100004", sell: 195, cost: 140, qty: 20 },
  { category: "Personal Care", name: "Toothpaste 100ml", sku: "HG-PER-001", barcode: "8600100100001", sell: 65, cost: 40, qty: 45 },
  { category: "Personal Care", name: "Bath Soap 100g", sku: "HG-PER-002", barcode: "8600100100002", sell: 40, cost: 25, qty: 60 },
];

/**
 * Weight-sold products: catalog prices are per gram (base).
 * Stock qty is in grams. POS can sell by g or kg.
 */
const WEIGHT_PRODUCTS = [
  {
    category: "Bulk / Measured",
    name: "Coffee Weight (Arabica)",
    sku: "HG-WGT-001",
    barcode: "8700100100001",
    sellPerKg: 850,
    costPerKg: 620,
    qtyKg: 25,
  },
  {
    category: "Bulk / Measured",
    name: "Coffee Weight (Robusta Blend)",
    sku: "HG-WGT-002",
    barcode: "8700100100002",
    sellPerKg: 720,
    costPerKg: 510,
    qtyKg: 18,
  },
  {
    category: "Bulk / Measured",
    name: "Berbere Spice (bulk)",
    sku: "HG-WGT-003",
    barcode: "8700100100003",
    sellPerKg: 480,
    costPerKg: 320,
    qtyKg: 12,
  },
  {
    category: "Bulk / Measured",
    name: "Loose Black Tea Leaf",
    sku: "HG-WGT-004",
    barcode: "8700100100004",
    sellPerKg: 390,
    costPerKg: 260,
    qtyKg: 15,
  },
  {
    category: "Bulk / Measured",
    name: "Sesame Seeds (bulk)",
    sku: "HG-WGT-005",
    barcode: "8700100100005",
    sellPerKg: 280,
    costPerKg: 190,
    qtyKg: 20,
  },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, "apps/web/.env.local");

function loadEnv() {
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: org, error: orgErr } = await admin
  .from("organizations")
  .select("id, name")
  .ilike("name", ORG_NAME)
  .maybeSingle();

if (orgErr || !org) {
  console.error("Organization not found:", orgErr?.message ?? ORG_NAME);
  process.exit(1);
}

const { data: store, error: storeErr } = await admin
  .from("stores")
  .select("id, name")
  .eq("organization_id", org.id)
  .eq("is_active", true)
  .order("created_at")
  .limit(1)
  .maybeSingle();

if (storeErr || !store) {
  console.error("No active store:", storeErr?.message ?? "not found");
  process.exit(1);
}

const categoryIds = new Map();
const created = [];
const skipped = [];
const errors = [];

async function ensureCategory(name) {
  if (categoryIds.has(name)) return categoryIds.get(name);

  const { data: existingCat } = await admin
    .from("categories")
    .select("id")
    .eq("organization_id", org.id)
    .eq("name", name)
    .maybeSingle();

  if (existingCat) {
    categoryIds.set(name, existingCat.id);
    return existingCat.id;
  }

  const { data: cat, error: catErr } = await admin
    .from("categories")
    .insert({
      organization_id: org.id,
      name,
      sort_order: categoryIds.size + 1,
    })
    .select("id")
    .single();

  if (catErr) throw new Error(`Category ${name}: ${catErr.message}`);
  categoryIds.set(name, cat.id);
  return cat.id;
}

async function upsertWeightUoms(productId) {
  const specs = [
    { code: "g", name: "Gram", factor: 1, isBase: true, isSale: true, isPurchase: true },
    { code: "kg", name: "Kilogram", factor: 1000, isBase: false, isSale: true, isPurchase: true },
  ];

  const { data: existing } = await admin
    .from("product_uoms")
    .select("id, uom_code")
    .eq("product_id", productId);

  const byCode = new Map(
    ((existing ?? []).map((r) => [String(r.uom_code).toLowerCase(), r.id]))
  );

  for (const spec of specs) {
    const { error } = await admin.rpc("upsert_product_uom", {
      p_product_id: productId,
      p_uom_code: spec.code,
      p_uom_name: spec.name,
      p_conversion_factor: spec.factor,
      p_is_base: spec.isBase,
      p_is_sale: spec.isSale,
      p_is_purchase: spec.isPurchase,
      p_uom_id: byCode.get(spec.code) ?? null,
    });
    if (error) {
      // Service-role path: direct upsert if RPC is authenticated-only without service grant.
      const row = {
        organization_id: org.id,
        product_id: productId,
        uom_code: spec.code,
        uom_name: spec.name,
        conversion_factor: spec.factor,
        is_base: spec.isBase,
        is_sale: spec.isSale,
        is_purchase: spec.isPurchase,
      };
      const existingId = byCode.get(spec.code);
      if (existingId) {
        const { error: updErr } = await admin.from("product_uoms").update(row).eq("id", existingId);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: insErr } = await admin.from("product_uoms").insert(row);
        if (insErr) throw new Error(insErr.message);
      }
    }
  }

  const { error: baseErr } = await admin
    .from("products")
    .update({ base_uom_code: "g" })
    .eq("id", productId);
  if (baseErr) throw new Error(baseErr.message);
}

async function createProduct({
  category,
  name,
  sku,
  barcode,
  sell,
  cost,
  qty,
  baseUom = "ea",
  weight = false,
}) {
  const { data: existing } = await admin
    .from("products")
    .select("id")
    .eq("organization_id", org.id)
    .eq("sku", sku)
    .maybeSingle();

  if (existing) {
    skipped.push(name);
    return;
  }

  const categoryId = await ensureCategory(category);

  const { data: product, error: prodErr } = await admin
    .from("products")
    .insert({
      organization_id: org.id,
      category_id: categoryId,
      name,
      sku,
      barcode,
      sell_price: sell,
      cost_price: cost,
      base_uom_code: baseUom,
    })
    .select("id")
    .single();

  if (prodErr) throw new Error(`Product ${name}: ${prodErr.message}`);

  const { data: variant, error: varErr } = await admin
    .from("product_variants")
    .insert({
      product_id: product.id,
      organization_id: org.id,
      name: "Default",
      sku,
      barcode,
      sell_price: sell,
      cost_price: cost,
    })
    .select("id")
    .single();

  if (varErr) throw new Error(`Variant ${name}: ${varErr.message}`);

  const { error: invErr } = await admin.from("inventory_levels").upsert(
    {
      store_id: store.id,
      variant_id: variant.id,
      organization_id: org.id,
      quantity: qty,
    },
    { onConflict: "store_id,variant_id" }
  );
  if (invErr) throw new Error(`Inventory ${name}: ${invErr.message}`);

  if (weight) {
    await upsertWeightUoms(product.id);
  } else {
    // Ensure ea base UOM row exists for POS consistency.
    const { error: eaErr } = await admin.from("product_uoms").upsert(
      {
        organization_id: org.id,
        product_id: product.id,
        uom_code: "ea",
        uom_name: "Each",
        conversion_factor: 1,
        is_base: true,
        is_sale: true,
        is_purchase: true,
      },
      { onConflict: "product_id,uom_code" }
    );
    if (eaErr) {
      // Non-fatal for ea-only orgs if unique constraint naming differs.
      const { data: hasEa } = await admin
        .from("product_uoms")
        .select("id")
        .eq("product_id", product.id)
        .eq("uom_code", "ea")
        .maybeSingle();
      if (!hasEa) {
        const { error: insEa } = await admin.from("product_uoms").insert({
          organization_id: org.id,
          product_id: product.id,
          uom_code: "ea",
          uom_name: "Each",
          conversion_factor: 1,
          is_base: true,
          is_sale: true,
          is_purchase: true,
        });
        if (insEa) throw new Error(`UOM ea ${name}: ${insEa.message}`);
      }
    }
  }

  created.push(name);
}

try {
  for (const item of EACH_PRODUCTS) {
    await createProduct({ ...item, baseUom: "ea", weight: false });
  }

  for (const item of WEIGHT_PRODUCTS) {
    const sell = Math.round((item.sellPerKg / 1000) * 1e8) / 1e8;
    const cost = Math.round((item.costPerKg / 1000) * 1e8) / 1e8;
    await createProduct({
      category: item.category,
      name: item.name,
      sku: item.sku,
      barcode: item.barcode,
      sell,
      cost,
      qty: Math.round(item.qtyKg * 1000),
      baseUom: "g",
      weight: true,
    });
  }
} catch (err) {
  errors.push(err instanceof Error ? err.message : String(err));
}

console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      organization: org.name,
      organizationId: org.id,
      storeId: store.id,
      storeName: store.name,
      created: created.length,
      skipped: skipped.length,
      expectedEach: EACH_PRODUCTS.length,
      expectedWeight: WEIGHT_PRODUCTS.length,
      products: created,
      skippedProducts: skipped,
      errors,
    },
    null,
    2
  )
);

if (errors.length) process.exit(1);

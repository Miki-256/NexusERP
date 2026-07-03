#!/usr/bin/env node
/**
 * Prepare fixtures for k6 POS load test.
 * Writes scripts/k6/fixtures.json (gitignored) with auth + register context.
 *
 * Required in apps/web/.env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or ANON)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   LOAD_TEST_EMAIL, LOAD_TEST_PASSWORD  (owner/manager with POS access)
 *
 * Usage:
 *   node scripts/k6/prepare-pos-load.mjs
 *   node scripts/k6/prepare-pos-load.mjs --stock 5000
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../../apps/web/.env.local");
const outPath = path.join(__dirname, "fixtures.json");

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* missing */
  }
  return out;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const env = loadEnv(envPath);
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const email = process.env.LOAD_TEST_EMAIL || arg("--email", "") || env.LOAD_TEST_EMAIL || "";
const password = process.env.LOAD_TEST_PASSWORD || arg("--password", "") || env.LOAD_TEST_PASSWORD || "";
const minStock = Number(arg("--stock", env.LOAD_TEST_MIN_STOCK ?? "2000"));

if (!supabaseUrl || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or anon/publishable key in apps/web/.env.local");
  process.exit(1);
}
if (!email || !password) {
  console.error(
    "Add LOAD_TEST_EMAIL and LOAD_TEST_PASSWORD to apps/web/.env.local (manager/owner account)."
  );
  process.exit(1);
}

async function authSignIn() {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error_description ?? body.msg ?? JSON.stringify(body));
  }
  return body.access_token;
}

async function rpc(token, name, args = {}, useService = false) {
  const key = useService ? serviceKey : anonKey;
  const auth = useService ? serviceKey : token;
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${name}: ${typeof data === "object" ? data.message ?? JSON.stringify(data) : data}`);
  }
  return data;
}

async function restGet(token, table, query) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`${table}: ${await res.text()}`);
  return res.json();
}

async function restPatchService(table, query, body) {
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY required to bump stock");
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${table}: ${await res.text()}`);
}

console.log("Preparing POS load test fixtures…\n");

const accessToken = await authSignIn();
console.log(`✓ Signed in as ${email}`);

const workspace = await rpc(accessToken, "get_my_workspace", {});
const orgId = workspace.organization?.id;
const orgName = workspace.organization?.name;
if (!orgId) throw new Error("No workspace organization found");

console.log(`✓ Organization: ${orgName} (${orgId})`);

const stores = await restGet(
  accessToken,
  "stores",
  `organization_id=eq.${orgId}&is_active=eq.true&select=id,name&order=created_at&limit=1`
);
const storeId = stores[0]?.id;
if (!storeId) throw new Error("No active store — complete onboarding first");
console.log(`✓ Store: ${stores[0].name} (${storeId})`);

const registers = await restGet(
  accessToken,
  "registers",
  `store_id=eq.${storeId}&is_active=eq.true&select=id,name&order=created_at&limit=1`
);
let registerId = registers[0]?.id;
if (!registerId) throw new Error("No register on store — add one in Stores app");
console.log(`✓ Register: ${registers[0].name} (${registerId})`);

let sessionId = null;
const openSession = await rpc(accessToken, "get_open_register_session", {
  p_register_id: registerId,
});
if (openSession?.id) {
  sessionId = openSession.id;
  console.log(`✓ Using open shift: ${sessionId}`);
} else {
  const opened = await rpc(accessToken, "open_register_session_manager", {
    p_register_id: registerId,
    p_organization_id: orgId,
    p_opening_float: 0,
    p_staff_id: null,
  });
  sessionId = opened.session_id;
  console.log(`✓ Opened new shift: ${sessionId}`);
}

const inventory = await restGet(
  accessToken,
  "inventory_levels",
  `store_id=eq.${storeId}&quantity=gt.0&select=variant_id,quantity,product_variants(id,name,sell_price,products(name,tax_rate))&order=quantity.desc&limit=1`
);
const row = inventory[0];
if (!row) throw new Error("No stocked variants — add products with inventory");

const variant = row.product_variants;
const variantId = row.variant_id;
const unitPrice = Number(variant.sell_price ?? 10);
const productName = variant.products?.name ?? "Load test product";
const variantName = variant.name ?? "Default";
let stockQty = Number(row.quantity);

const orgTaxRate = Number(workspace.organization?.tax_rate ?? 0);
const taxInclusive = !!workspace.organization?.tax_inclusive;
const lineTaxRate = Number(variant.products?.tax_rate ?? orgTaxRate);
const subtotal = unitPrice;
const lineTax = taxInclusive
  ? subtotal - subtotal / (1 + lineTaxRate / 100)
  : subtotal * (lineTaxRate / 100);
const paymentTotal = taxInclusive ? subtotal : subtotal + lineTax;

console.log(
  `✓ Product: ${productName} (${variantId}) @ ${unitPrice}, tax ${lineTaxRate}%${taxInclusive ? " incl." : ""}, pay ${paymentTotal.toFixed(2)}, stock=${stockQty}`
);

if (stockQty < minStock && serviceKey) {
  await restPatchService(
    "inventory_levels",
    `store_id=eq.${storeId}&variant_id=eq.${variantId}`,
    { quantity: minStock }
  );
  stockQty = minStock;
  console.log(`✓ Stock bumped to ${minStock} for load test`);
} else if (stockQty < minStock) {
  console.warn(`⚠ Stock (${stockQty}) < recommended ${minStock}. Add SUPABASE_SERVICE_ROLE_KEY to auto-bump.`);
}

const fixtures = {
  preparedAt: new Date().toISOString(),
  supabaseUrl,
  anonKey,
  accessToken,
  organizationId: orgId,
  organizationName: orgName,
  storeId,
  registerId,
  sessionId,
  variantId,
  productName,
  variantName,
  unitPrice,
  paymentTotal,
  taxRate: lineTaxRate,
  taxInclusive,
  stockQty,
  loadTestEmail: email,
};

writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
console.log(`\n✓ Wrote ${outPath}`);
console.log("\nNext:");
console.log("  npm run load-test:pos");
console.log("  # or: k6 run scripts/k6/pos-concurrent-sales.js");

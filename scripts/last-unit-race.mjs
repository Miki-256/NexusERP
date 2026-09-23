#!/usr/bin/env node
/**
 * Last-unit dual-cashier race validation (preprod/staging).
 * Usage: node scripts/last-unit-race.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../apps/web/.env.local");

function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv(envPath);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = env.E2E_EMAIL || env.LOAD_TEST_EMAIL;
const password = env.E2E_PASSWORD || env.LOAD_TEST_PASSWORD;
const REGISTER_ID = process.env.E2E_REGISTER_ID || "ccef8d1c-72c2-44e8-b61c-6a016656cfd3";

if (!url || !key || !email || !password) {
  console.error("Missing URL/key/E2E credentials in apps/web/.env.local");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email, password });
if (authErr) throw authErr;

const { data: ws, error: wsErr } = await sb.rpc("get_my_workspace");
if (wsErr) throw wsErr;
const orgId = ws?.organization?.id;
if (!orgId) throw new Error("no org");

const { data: reg } = await sb.from("registers").select("id, store_id").eq("id", REGISTER_ID).single();
if (!reg) throw new Error("register not found");

let session = await sb.rpc("get_open_register_session", { p_register_id: reg.id });
if (!session.data?.id) {
  await sb.rpc("open_register_session_manager", {
    p_register_id: reg.id,
    p_organization_id: orgId,
    p_opening_float: 0,
    p_staff_id: null,
  });
  session = await sb.rpc("get_open_register_session", { p_register_id: reg.id });
}
const sessionId = session.data?.id;
if (!sessionId) throw new Error("no session");

const { data: catalog } = await sb.rpc("get_pos_catalog", { p_register_id: reg.id });
const item = (catalog || []).find((c) => Number(c.stock) >= 2 && Number(c.sellPrice || c.sell_price || c.price || 0) > 0);
if (!item) throw new Error("need a product with stock>=2");

const variantId = item.variantId || item.variant_id;
const unitPrice = Number(item.sellPrice ?? item.sell_price ?? item.price ?? 1);
const productName = item.name || item.productName || "Race test";
const taxRate = Number(ws?.organization?.tax_rate ?? 0);
const taxInclusive = !!ws?.organization?.tax_inclusive;
function payTotal(price, qty) {
  const merch = price * qty;
  if (taxInclusive) return merch;
  return Math.round(merch * (1 + taxRate / 100) * 100) / 100;
}

async function setStock(qty) {
  // Read current, adjust delta via RPC
  const { data: levels } = await sb
    .from("inventory_levels")
    .select("quantity")
    .eq("store_id", reg.store_id)
    .eq("variant_id", variantId)
    .maybeSingle();
  const cur = Number(levels?.quantity ?? 0);
  const delta = qty - cur;
  if (Math.abs(delta) < 1e-9) return cur;
  const { error } = await sb.rpc("adjust_inventory", {
    p_store_id: reg.store_id,
    p_variant_id: variantId,
    p_delta: delta,
    p_reason: `last-unit-race set stock to ${qty}`,
  });
  if (error) throw error;
  return qty;
}

async function getStock() {
  const { data } = await sb
    .from("inventory_levels")
    .select("quantity")
    .eq("store_id", reg.store_id)
    .eq("variant_id", variantId)
    .maybeSingle();
  return Number(data?.quantity ?? 0);
}

async function sellOne(label) {
  const amount = payTotal(unitPrice, 1);
  const { data, error } = await sb.rpc("complete_sale", {
    p_organization_id: orgId,
    p_store_id: reg.store_id,
    p_register_id: reg.id,
    p_session_id: sessionId,
    p_idempotency_key: randomUUID(),
    p_lines: [
      {
        variantId,
        productName,
        quantity: 1,
        unitPrice,
        discountAmount: 0,
      },
    ],
    p_discount_amount: 0,
    p_customer_name: null,
    p_customer_phone: null,
    p_payments: [{ method: "cash", amount, cashTendered: amount, changeGiven: 0 }],
    p_pos_staff_id: null,
    p_pos_session_token: null,
    p_customer_id: null,
  });
  return { label, ok: !error && !!data?.sale_id, error: error?.message || null, data };
}

console.log("Variant", variantId, productName, "unitPrice", unitPrice);

// Case 1: stock=1, two parallel sales
await setStock(1);
const before1 = await getStock();
console.log("CASE1 before stock", before1);
const [a, b] = await Promise.all([sellOne("A"), sellOne("B")]);
const after1 = await getStock();
const ok1 = [a, b].filter((r) => r.ok).length;
const fail1 = [a, b].filter((r) => !r.ok);
console.log("CASE1 results", JSON.stringify({ a, b, after1, ok1 }, null, 2));

const case1Pass =
  before1 === 1 &&
  ok1 === 1 &&
  fail1.length === 1 &&
  /insufficient|stock/i.test(fail1[0].error || "") &&
  after1 === 0;

// Case 2: stock=2, two parallel qty=1 → both ok, stock=0
await setStock(2);
const before2 = await getStock();
console.log("CASE2 before stock", before2);
const [c, d] = await Promise.all([sellOne("C"), sellOne("D")]);
const after2 = await getStock();
const ok2 = [c, d].filter((r) => r.ok).length;
console.log("CASE2 results", JSON.stringify({ c, d, after2, ok2 }, null, 2));
const case2Pass = before2 === 2 && ok2 === 2 && after2 === 0;

const report = {
  measuredAt: new Date().toISOString(),
  variantId,
  case1: { pass: case1Pass, before: before1, after: after1, ok: ok1, failMsg: fail1[0]?.error },
  case2: { pass: case2Pass, before: before2, after: after2, ok: ok2 },
  overallPass: case1Pass && case2Pass,
};
writeFileSync("/tmp/nexus-last-unit-race.json", JSON.stringify(report, null, 2));
console.log("REPORT", JSON.stringify(report, null, 2));
process.exit(report.overallPass ? 0 : 2);

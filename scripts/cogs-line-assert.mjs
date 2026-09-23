#!/usr/bin/env node
/**
 * COGS consistency: sum(sale_lines × cost) == JE account 5000 debit (aggregated).
 * Usage: node scripts/cogs-line-assert.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = loadEnv(path.join(__dirname, "../apps/web/.env.local"));
const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);
await sb.auth.signInWithPassword({
  email: env.E2E_EMAIL || env.LOAD_TEST_EMAIL,
  password: env.E2E_PASSWORD || env.LOAD_TEST_PASSWORD,
});

const { data: ws } = await sb.rpc("get_my_workspace");
const orgId = ws.organization.id;
const REGISTER_ID = process.env.E2E_REGISTER_ID || "ccef8d1c-72c2-44e8-b61c-6a016656cfd3";
const { data: reg } = await sb.from("registers").select("id, store_id").eq("id", REGISTER_ID).single();

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

const { data: catalog } = await sb.rpc("get_pos_catalog", { p_register_id: reg.id });
const withCost = [];
for (const c of catalog || []) {
  const vid = c.variantId || c.variant_id;
  if (!vid || Number(c.stock) < 3) continue;
  const { data: pv } = await sb
    .from("product_variants")
    .select("id, cost_price, sell_price, products(name, cost_price)")
    .eq("id", vid)
    .single();
  const cost = Number(pv?.cost_price ?? pv?.products?.cost_price ?? 0);
  const sell = Number(c.sellPrice ?? c.sell_price ?? pv?.sell_price ?? 0);
  if (cost > 0 && sell > 0) withCost.push({ ...c, variantId: vid, cost, sell, name: c.name || pv?.products?.name });
  if (withCost.length >= 2) break;
}
if (withCost.length < 2) throw new Error("Need 2 in-stock products with cost_price > 0");

const A = withCost[0];
const B = withCost[1];
const lines = [
  { variantId: A.variantId, productName: A.name, quantity: 2, unitPrice: A.sell, discountAmount: 0 },
  { variantId: B.variantId, productName: B.name, quantity: 1, unitPrice: B.sell, discountAmount: 0 },
];
const merch = 2 * A.sell + 1 * B.sell;
const taxRate = Number(ws.organization.tax_rate ?? 0);
const taxInclusive = !!ws.organization.tax_inclusive;
const total = taxInclusive ? merch : Math.round(merch * (1 + taxRate / 100) * 100) / 100;
const expectedCogs = 2 * A.cost + 1 * B.cost;

const { data: sale, error: saleErr } = await sb.rpc("complete_sale", {
  p_organization_id: orgId,
  p_store_id: reg.store_id,
  p_register_id: reg.id,
  p_session_id: session.data.id,
  p_idempotency_key: randomUUID(),
  p_lines: lines,
  p_discount_amount: 0,
  p_customer_name: null,
  p_customer_phone: null,
  p_payments: [{ method: "cash", amount: total, cashTendered: total, changeGiven: 0 }],
  p_pos_staff_id: null,
  p_pos_session_token: null,
  p_customer_id: null,
});
if (saleErr) throw saleErr;
const saleId = sale.sale_id;

// Ensure posted
const { data: jeExisting } = await sb
  .from("journal_entries")
  .select("id")
  .eq("source_type", "sale")
  .eq("source_id", saleId)
  .maybeSingle();

if (!jeExisting) {
  // try post
  const { error: postErr } = await sb.rpc("post_sale_to_ledger", { p_sale_id: saleId });
  if (postErr) {
    // internal may only be service-role — try org auto-post wait
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const { data: je } = await sb
  .from("journal_entries")
  .select("id, journal_entry_lines(debit, credit, accounts(code, name))")
  .eq("source_type", "sale")
  .eq("source_id", saleId)
  .maybeSingle();

const { data: saleLines } = await sb
  .from("sale_lines")
  .select("quantity, qty_base, variant_id")
  .eq("sale_id", saleId);

let recomputed = 0;
for (const sl of saleLines || []) {
  const { data: pv } = await sb
    .from("product_variants")
    .select("cost_price, products(cost_price)")
    .eq("id", sl.variant_id)
    .single();
  const cost = Number(pv?.cost_price ?? pv?.products?.cost_price ?? 0);
  const qty = Number(sl.qty_base ?? sl.quantity ?? 0);
  recomputed += qty * cost;
}

const linesJe = je?.journal_entry_lines || [];
const cogsDebit = linesJe
  .filter((l) => l.accounts?.code === "5000")
  .reduce((s, l) => s + Number(l.debit || 0), 0);
const invCredit = linesJe
  .filter((l) => l.accounts?.code === "1200")
  .reduce((s, l) => s + Number(l.credit || 0), 0);

const tol = 0.02;
const match =
  je &&
  Math.abs(recomputed - expectedCogs) < tol &&
  Math.abs(cogsDebit - expectedCogs) < tol &&
  Math.abs(invCredit - expectedCogs) < tol &&
  linesJe.filter((l) => l.accounts?.code === "5000").length === 1;

const report = {
  measuredAt: new Date().toISOString(),
  architecture: "aggregated JE: one Dr 5000 + one Cr 1200 per sale (not per sale_line)",
  saleId,
  products: [
    { name: A.name, cost: A.cost, qty: 2, lineCogs: 2 * A.cost },
    { name: B.name, cost: B.cost, qty: 1, lineCogs: 1 * B.cost },
  ],
  expectedCogs,
  recomputedFromSaleLines: recomputed,
  jeCogsDebit5000: cogsDebit,
  jeInvCredit1200: invCredit,
  jeLineCount5000: linesJe.filter((l) => l.accounts?.code === "5000").length,
  jePresent: !!je,
  pass: !!match,
};
writeFileSync("/tmp/nexus-cogs-assert.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(match ? 0 : 2);

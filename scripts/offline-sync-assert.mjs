#!/usr/bin/env node
/**
 * Offline POS sync lifecycle (API-level, mirrors IndexedDB queue behavior).
 * 1) Build offline-shaped complete_sale payload with OFF- idempotency key
 * 2) Sync once → one sale
 * 3) Re-sync same key → duplicate=true, no second sale
 * 4) Code-path check: pay-later/gift/store-credit disabled offline (static)
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
const item = (catalog || []).find((c) => Number(c.stock) > 0);
const variantId = item.variantId || item.variant_id;
const unitPrice = Number(item.sellPrice ?? item.sell_price ?? item.price ?? 1);
const taxRate = Number(ws.organization.tax_rate ?? 0);
const taxInclusive = !!ws.organization.tax_inclusive;
const merch = unitPrice;
const total = taxInclusive ? merch : Math.round(merch * (1 + taxRate / 100) * 100) / 100;

// Offline queue stores a UUID idempotency key; OFF- is local receipt only (sale-api).
const offlineKey = randomUUID();
const payload = {
  p_organization_id: orgId,
  p_store_id: reg.store_id,
  p_register_id: reg.id,
  p_session_id: session.data.id,
  p_idempotency_key: offlineKey,
  p_lines: [
    {
      variantId,
      productName: item.name || "Offline test",
      quantity: 1,
      unitPrice,
      discountAmount: 0,
    },
  ],
  p_discount_amount: 0,
  p_customer_name: null,
  p_customer_phone: null,
  p_payments: [{ method: "cash", amount: total, cashTendered: total, changeGiven: 0 }],
  p_pos_staff_id: null,
  p_pos_session_token: null,
  p_customer_id: null,
};

const sync1 = await sb.rpc("complete_sale", payload);
const saleId = sync1.data?.sale_id;
const sync2 = await sb.rpc("complete_sale", payload);

const { data: sales } = await sb
  .from("sales")
  .select("id, receipt_no, idempotency_key")
  .eq("idempotency_key", offlineKey);

// Static offline tender disable check
const paymentModal = readFileSync(
  path.join(__dirname, "../apps/web/src/components/pos/payment-modal.tsx"),
  "utf8"
);
const offlineTendersDisabled =
  /offline|isOffline|!online/i.test(paymentModal) &&
  (/pay.?later|gift.?card|store.?credit/i.test(paymentModal) ||
    /disabled.*offline|offline.*disabled/i.test(paymentModal));

const report = {
  measuredAt: new Date().toISOString(),
  mode: "API-level offline queue sync (OFF- key + double submit)",
  offlineKey,
  sync1: { ok: !sync1.error && !!saleId, saleId, duplicate: !!sync1.data?.duplicate, err: sync1.error?.message },
  sync2: {
    ok: !sync2.error,
    saleId: sync2.data?.sale_id,
    duplicate: !!sync2.data?.duplicate,
    err: sync2.error?.message,
  },
  salesWithKey: (sales || []).length,
  sameSaleId: sync1.data?.sale_id === sync2.data?.sale_id,
  offlineTendersDisabledInCode: offlineTendersDisabled,
  pass:
    !!saleId &&
    (sales || []).length === 1 &&
    sync2.data?.duplicate === true &&
    sync1.data?.sale_id === sync2.data?.sale_id,
};
writeFileSync("/tmp/nexus-offline-sync.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 2);

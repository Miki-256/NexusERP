#!/usr/bin/env node
/**
 * Node fallback for POS concurrent sales (no k6 required).
 * Uses fixtures.json from prepare-pos-load.mjs
 *
 * Usage:
 *   npm run load-test:pos:prepare
 *   npm run load-test:pos:node
 *   K6_VUS=30 K6_ITERATIONS=300 npm run load-test:pos:node
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, "fixtures.json");

const concurrency = Number(process.env.LOAD_VUS || process.env.K6_VUS || 20);
const iterations = Number(process.env.LOAD_ITERATIONS || process.env.K6_ITERATIONS || 200);

let fixtures;
try {
  fixtures = JSON.parse(readFileSync(fixturesPath, "utf8"));
} catch {
  console.error("Missing fixtures.json — run: npm run load-test:pos:prepare");
  process.exit(1);
}

async function completeSale(idempotencyKey) {
  const qty = 1;
  const lineTotal = fixtures.paymentTotal;
  const start = performance.now();
  const res = await fetch(`${fixtures.supabaseUrl}/rest/v1/rpc/complete_sale`, {
    method: "POST",
    headers: {
      apikey: fixtures.anonKey,
      Authorization: `Bearer ${fixtures.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_organization_id: fixtures.organizationId,
      p_store_id: fixtures.storeId,
      p_register_id: fixtures.registerId,
      p_session_id: fixtures.sessionId,
      p_idempotency_key: idempotencyKey,
      p_lines: [
        {
          variantId: fixtures.variantId,
          productName: fixtures.productName,
          variantName: fixtures.variantName,
          quantity: qty,
          unitPrice: fixtures.unitPrice,
          discountAmount: 0,
        },
      ],
      p_discount_amount: 0,
      p_customer_name: null,
      p_customer_phone: null,
      p_payments: [
        {
          method: "cash",
          amount: lineTotal,
          cashTendered: lineTotal,
          changeGiven: 0,
        },
      ],
      p_pos_staff_id: null,
      p_pos_session_token: null,
      p_customer_id: null,
    }),
  });
  const ms = performance.now() - start;
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text.slice(0, 200) };
  }
  return { ok: res.ok && !!body.sale_id, status: res.status, ms, body, duplicate: !!body.duplicate };
}

async function runPool(tasks, poolSize) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

console.log("POS concurrent sales (Node)");
console.log(`Org: ${fixtures.organizationName}`);
console.log(`Concurrency: ${concurrency} | Iterations: ${iterations}\n`);

const tasks = Array.from({ length: iterations }, () => () => completeSale(randomUUID()));
const wallStart = performance.now();
const results = await runPool(tasks, concurrency);
const wallMs = performance.now() - wallStart;

const ok = results.filter((r) => r.ok).length;
const stock = results.filter((r) => !r.ok && String(r.body.message || "").toLowerCase().includes("stock")).length;
const other = results.filter((r) => !r.ok).length - stock;
const dup = results.filter((r) => r.duplicate).length;
const latencies = results.map((r) => r.ms).sort((a, b) => a - b);

console.log("── Results ──");
console.log(`Success:        ${ok}/${iterations} (${((ok / iterations) * 100).toFixed(1)}%)`);
console.log(`Wall time:      ${(wallMs / 1000).toFixed(1)}s`);
console.log(`Throughput:     ${((iterations / wallMs) * 1000).toFixed(1)} sales/s`);
console.log(`Latency avg:    ${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)} ms`);
console.log(`Latency p50:    ${Math.round(percentile(latencies, 50))} ms`);
console.log(`Latency p95:    ${Math.round(percentile(latencies, 95))} ms`);
console.log(`Latency max:    ${Math.round(latencies[latencies.length - 1])} ms`);
console.log(`Stock conflicts: ${stock}`);
console.log(`Duplicates:      ${dup}`);
console.log(`Other errors:    ${other}`);

if (other > 0) {
  const sample = results.find((r) => !r.ok && !String(r.body.message || "").includes("stock"));
  if (sample) console.log(`Sample error: ${sample.status} ${JSON.stringify(sample.body).slice(0, 200)}`);
}

console.log("");
if (ok / iterations >= 0.9 && stock === 0) {
  console.log("✅ PASS — concurrent complete_sale handled well");
  process.exit(0);
}
console.log("⚠️  REVIEW failures or stock conflicts above");
process.exit(stock > 0 || other > 0 ? 1 : 0);

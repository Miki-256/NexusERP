/**
 * k6 — concurrent POS complete_sale load test
 *
 * Prerequisites:
 *   brew install k6   # or https://grafana.com/docs/k6/latest/set-up/install-k6/
 *   node scripts/k6/prepare-pos-load.mjs
 *
 * Env overrides:
 *   K6_VUS=20 K6_ITERATIONS=200 k6 run scripts/k6/pos-concurrent-sales.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import exec from "k6/execution";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const fixtures = JSON.parse(open("./fixtures.json"));

const saleOk = new Rate("sale_success");
const saleDuplicate = new Counter("sale_duplicate");
const saleStockConflict = new Counter("sale_stock_conflict");
const saleOtherError = new Counter("sale_other_error");
const saleDuration = new Trend("sale_duration_ms", true);

const vus = Number(__ENV.LOAD_VUS || __ENV.K6_VUS || 20);
const iterations = Number(__ENV.LOAD_ITERATIONS || __ENV.K6_ITERATIONS || 200);
const phase3 = __ENV.PHASE3_PROFILE === "1";

export const options = {
  scenarios: {
    concurrent_pos_checkouts: {
      executor: "shared-iterations",
      vus,
      iterations,
      maxDuration: "10m",
    },
  },
  thresholds: {
    sale_success: ["rate>0.90"],
    http_req_failed: ["rate<0.10"],
    sale_duration_ms: [phase3 ? "p(95)<500" : "p(95)<5000"],
  },
};

function rpc(name, args, tags) {
  const url = `${fixtures.supabaseUrl}/rest/v1/rpc/${name}`;
  const res = http.post(url, JSON.stringify(args), {
    headers: {
      apikey: fixtures.anonKey,
      Authorization: `Bearer ${fixtures.accessToken}`,
      "Content-Type": "application/json",
    },
    tags,
  });
  return res;
}

export default function () {
  const qty = 1;
  const lineTotal = fixtures.paymentTotal;
  const idempotencyKey = uuidv4();

  const payload = {
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
  };

  const start = Date.now();
  const res = rpc("complete_sale", payload, { name: "complete_sale" });
  saleDuration.add(Date.now() - start);

  let body = {};
  try {
    body = res.json();
  } catch {
    body = { raw: res.body?.slice(0, 200) };
  }

  const httpOk = res.status === 200;
  const businessOk = httpOk && !!body.sale_id;

  if (httpOk && body.duplicate) {
    saleDuplicate.add(1);
  }

  if (!httpOk) {
    const msg = (body.message || body.error || res.body || "").toString().toLowerCase();
    if (msg.includes("stock") || msg.includes("insufficient")) {
      saleStockConflict.add(1);
    } else {
      saleOtherError.add(1);
      if (__ITER === 0) {
        console.error(`Sale failed [VU ${exec.vu.idInTest}]: ${res.status} ${res.body?.slice(0, 300)}`);
      }
    }
  }

  saleOk.add(businessOk);

  check(res, {
    "complete_sale HTTP 200": (r) => r.status === 200,
    "sale_id returned": () => !!body.sale_id,
  });

  sleep(0.05);
}

export function handleSummary(data) {
  const ok = data.metrics.sale_success?.values?.rate ?? 0;
  const p95 = data.metrics.sale_duration_ms?.values?.["p(95)"] ?? 0;
  const dup = data.metrics.sale_duplicate?.values?.count ?? 0;
  const stock = data.metrics.sale_stock_conflict?.values?.count ?? 0;
  const other = data.metrics.sale_other_error?.values?.count ?? 0;

  const lines = [
    "",
    "═══ POS concurrent sales (complete_sale) ═══",
    `Org:      ${fixtures.organizationName}`,
    `Register: ${fixtures.registerId}`,
    `Product:  ${fixtures.productName} (${fixtures.unitPrice} → pay ${fixtures.paymentTotal})`,
    `VUs:      ${vus} | Iterations: ${iterations}`,
    "",
    `Success rate:     ${(ok * 100).toFixed(1)}%`,
    `p95 latency:      ${Math.round(p95)} ms${phase3 ? " (enterprise target <500ms)" : ""}`,
    `Duplicates:       ${dup}`,
    `Stock conflicts:  ${stock}`,
    `Other errors:     ${other}`,
    "",
    ok >= 0.9 && stock === 0
      ? phase3 && p95 > 500
        ? "⚠️  PASS rate OK but p95 exceeds 500ms enterprise target"
        : "✅ PASS — system handled concurrent checkouts"
      : "⚠️  REVIEW — see k6 output and stock levels",
    "",
  ];

  return {
    stdout: lines.join("\n"),
  };
}

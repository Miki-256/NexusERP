#!/usr/bin/env node
/**
 * Concurrent request load test for NexusERP (local dev or staging).
 *
 * Usage:
 *   node scripts/load-test.mjs
 *   node scripts/load-test.mjs --base http://localhost:3003 --concurrency 30 --requests 300
 *   node scripts/load-test.mjs --supabase-only --concurrency 50 --requests 500
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../apps/web/.env.local");

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

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    base: "http://localhost:3003",
    concurrency: 25,
    requests: 200,
    supabaseOnly: false,
    timeoutMs: 30_000,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base") opts.base = args[++i];
    else if (args[i] === "--concurrency") opts.concurrency = Number(args[++i]);
    else if (args[i] === "--requests") opts.requests = Number(args[++i]);
    else if (args[i] === "--supabase-only") opts.supabaseOnly = true;
    else if (args[i] === "--timeout") opts.timeoutMs = Number(args[++i]);
  }
  return opts;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function runOne(label, fn, timeoutMs) {
  const start = performance.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs)
      ),
    ]);
    const ms = performance.now() - start;
    const status = result.status ?? 200;
    const httpOk = status >= 200 && status < 500;
    return { label, ok: httpOk, ms, status, detail: result.detail };
  } catch (err) {
    const ms = performance.now() - start;
    return {
      label,
      ok: false,
      ms,
      status: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runPool(tasks, concurrency) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function summarize(label, results) {
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const totalMs = latencies.reduce((s, n) => s + n, 0);
  const statusCounts = {};
  for (const r of results) {
    const k = r.ok ? String(r.status) : `err:${r.detail?.slice(0, 40)}`;
    statusCounts[k] = (statusCounts[k] ?? 0) + 1;
  }

  return {
    label,
    total: results.length,
    ok,
    failed,
    successRate: `${((ok / results.length) * 100).toFixed(1)}%`,
    avgMs: Math.round(totalMs / results.length),
    p50Ms: Math.round(percentile(latencies, 50)),
    p95Ms: Math.round(percentile(latencies, 95)),
    maxMs: Math.round(latencies[latencies.length - 1] ?? 0),
    statusCounts,
  };
}

function printSummary(rows) {
  console.log("\n── Results ──\n");
  console.log(
    "Scenario".padEnd(28) +
      "Total".padStart(6) +
      "OK".padStart(6) +
      "Fail".padStart(6) +
      "Rate".padStart(8) +
      "Avg".padStart(8) +
      "p50".padStart(8) +
      "p95".padStart(8) +
      "Max".padStart(8)
  );
  console.log("-".repeat(86));
  for (const r of rows) {
    console.log(
      r.label.padEnd(28) +
        String(r.total).padStart(6) +
        String(r.ok).padStart(6) +
        String(r.failed).padStart(6) +
        r.successRate.padStart(8) +
        `${r.avgMs}ms`.padStart(8) +
        `${r.p50Ms}ms`.padStart(8) +
        `${r.p95Ms}ms`.padStart(8) +
        `${r.maxMs}ms`.padStart(8)
    );
    const codes = Object.entries(r.statusCounts)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
    if (codes) console.log(`  statuses: ${codes}`);
  }
}

const opts = parseArgs();
const env = loadEnv(envPath);
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

console.log("NexusERP load test");
console.log(`Target app: ${opts.base}`);
console.log(`Concurrency: ${opts.concurrency} | Requests per scenario: ${opts.requests}`);
if (supabaseUrl) {
  console.log(`Supabase: ${supabaseUrl.replace("https://", "").split(".")[0]}.supabase.co`);
} else {
  console.log("Supabase: (no .env.local — DB tests skipped)");
}
console.log("Note: dev mode (Turbopack) is slower than production build.\n");

const scenarios = [];

if (!opts.supabaseOnly) {
  scenarios.push({
    name: "GET /login (middleware)",
    fn: async () => {
      const res = await fetch(`${opts.base}/login`, { redirect: "manual" });
      const ok = res.status === 200 || res.status === 307;
      return { status: res.status, detail: ok ? "ok" : await res.text().then((t) => t.slice(0, 80)) };
    },
  });

  scenarios.push({
    name: "GET /maintenance (static)",
    fn: async () => {
      const res = await fetch(`${opts.base}/maintenance`);
      return { status: res.status };
    },
  });

  scenarios.push({
    name: "POST /api/auth/log-failed-login",
    fn: async () => {
      const res = await fetch(`${opts.base}/api/auth/log-failed-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `loadtest-${Date.now()}@example.com` }),
      });
      return { status: res.status };
    },
  });

  scenarios.push({
    name: "GET /api/v1/catalog (no auth)",
    fn: async () => {
      const res = await fetch(`${opts.base}/api/v1/catalog`);
      return { status: res.status };
    },
  });
}

if (supabaseUrl && supabaseKey) {
  scenarios.push({
    name: "RPC get_platform_maintenance_status",
    fn: async () => {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_platform_maintenance_status`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      return { status: res.status };
    },
  });

  scenarios.push({
    name: "RPC list_public_plans",
    fn: async () => {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/list_public_plans`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      return { status: res.status };
    },
  });

  scenarios.push({
    name: "RPC dashboard_stats (anon)",
    fn: async () => {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/dashboard_stats`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_organization_id: "00000000-0000-0000-0000-000000000000" }),
      });
      return { status: res.status };
    },
  });
}

if (scenarios.length === 0) {
  console.error("No scenarios to run.");
  process.exit(1);
}

const allSummaries = [];
const wallStart = performance.now();

for (const scenario of scenarios) {
  process.stdout.write(`Running ${scenario.name}… `);
  const tasks = Array.from({ length: opts.requests }, () => () =>
    runOne(scenario.name, scenario.fn, opts.timeoutMs)
  );
  const results = await runPool(tasks, opts.concurrency);
  const summary = summarize(scenario.name, results);
  allSummaries.push(summary);
  const rps = ((summary.ok / (summary.avgMs / 1000)) * (opts.concurrency / opts.requests)).toFixed(0);
  console.log(`done (${summary.ok}/${summary.total} ok, p95 ${summary.p95Ms}ms)`);
}

const wallMs = performance.now() - wallStart;
printSummary(allSummaries);

console.log(`\nTotal wall time: ${(wallMs / 1000).toFixed(1)}s`);

const anyFailures = allSummaries.some((s) => s.failed > 0);
const slowP95 = allSummaries.some((s) => s.p95Ms > 5000);

console.log("\n── Assessment ──");
if (anyFailures) {
  console.log("⚠️  Some requests failed — check errors above (timeouts, connection refused, 5xx).");
} else {
  console.log("✅ All requests completed without transport errors.");
}

if (slowP95) {
  console.log("⚠️  p95 latency > 5s on some paths — expected in dev mode; re-test with `npm run build && npm start`.");
} else if (allSummaries.every((s) => s.p95Ms < 2000)) {
  console.log("✅ p95 under 2s for tested paths at this concurrency.");
}

console.log("\nLimits of this test:");
console.log("  • Does not simulate authenticated tenant pages (need session cookies).");
console.log("  • Does not test POS offline queue or complete_sale under load.");
console.log("  • Supabase free tier has connection/rate limits — production needs paid plan + pooling.");
console.log("  • For real load testing use staging + `npm run build` + tools like k6 or Artillery.\n");

process.exit(anyFailures ? 1 : 0);

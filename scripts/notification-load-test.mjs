#!/usr/bin/env node
/**
 * Notification enqueue throughput load test (Sprint 8).
 * Target: ~1,000 events/minute for Growth tier.
 *
 * Requires service role + org id:
 *   NOTIFICATION_LOAD_ORG_ID=<uuid> node scripts/notification-load-test.mjs
 *   node scripts/notification-load-test.mjs --org <uuid> --count 1000 --concurrency 20
 *
 * Raises org rate limit for the run, then restores it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

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
    org: process.env.NOTIFICATION_LOAD_ORG_ID || "",
    count: 1000,
    concurrency: 10,
    rateLimit: 2000,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--org") opts.org = args[++i];
    else if (args[i] === "--count") opts.count = Number(args[++i]);
    else if (args[i] === "--concurrency") opts.concurrency = Number(args[++i]);
    else if (args[i] === "--rate-limit") opts.rateLimit = Number(args[++i]);
  }
  return opts;
}

async function runPool(items, concurrency, worker) {
  let idx = 0;
  const results = [];
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
  return results;
}

async function main() {
  const env = { ...loadEnv(envPath), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const opts = parseArgs();

  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!opts.org) {
    console.error("Pass --org <uuid> or set NOTIFICATION_LOAD_ORG_ID");
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("Notification load test");
  console.log(`  org=${opts.org}`);
  console.log(`  count=${opts.count} concurrency=${opts.concurrency}`);
  console.log(`  temporary rate_limit=${opts.rateLimit}/min\n`);

  const { data: orgBefore } = await admin
    .from("organizations")
    .select("notification_rate_limit_per_minute")
    .eq("id", opts.org)
    .maybeSingle();
  const previousLimit = orgBefore?.notification_rate_limit_per_minute ?? null;

  await admin
    .from("organizations")
    .update({ notification_rate_limit_per_minute: opts.rateLimit })
    .eq("id", opts.org);

  const chunkSize = Math.ceil(opts.count / opts.concurrency);
  const chunks = Array.from({ length: opts.concurrency }, (_, i) => {
    const start = i * chunkSize;
    const n = Math.min(chunkSize, opts.count - start);
    return n > 0 ? n : 0;
  }).filter((n) => n > 0);

  const t0 = performance.now();
  const results = await runPool(chunks, opts.concurrency, async (n) => {
    const { data, error } = await admin.rpc("load_test_enqueue_notifications", {
      p_org_id: opts.org,
      p_count: n,
      p_event_type: "system.queue_backlog",
    });
    if (error) return { enqueued: 0, error: error.message };
    return data;
  });
  const elapsedMs = performance.now() - t0;

  // Restore prior rate limit
  await admin
    .from("organizations")
    .update({ notification_rate_limit_per_minute: previousLimit })
    .eq("id", opts.org);

  const enqueued = results.reduce((s, r) => s + (r?.enqueued ?? 0), 0);
  const errors = results.filter((r) => r?.error).map((r) => r.error);
  const perMinute = elapsedMs > 0 ? Math.round((enqueued / elapsedMs) * 60_000) : 0;

  console.log("Results");
  console.log(`  enqueued: ${enqueued} / ${opts.count}`);
  console.log(`  elapsed:  ${(elapsedMs / 1000).toFixed(2)}s`);
  console.log(`  throughput: ${perMinute} events/min`);
  if (errors.length) {
    console.log(`  errors: ${errors.slice(0, 3).join("; ")}`);
  }
  console.log(
    perMinute >= 1000
      ? "\n✓ Met Growth target (≥ 1,000/min enqueue)"
      : "\n○ Below 1,000/min — raise --concurrency or check DB/network limits"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Week 1 — Critical path (production stability).
 * 1. Apply migration 00054 (payments index + rollup helper + backfill)
 * 2. Verify index and rollup freshness
 * 3. Run verify:supabase
 *
 * Usage: npm run week1:production
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MIGRATION = "20260618000054_week1_critical_path.sql";

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function query(sql, label) {
  const escaped = sql.replace(/"/g, '\\"');
  run(`npx supabase@latest db query --linked "${escaped}"`, label);
}

console.log("Week 1 — Critical path (production stability)");
console.log("Requires: npx supabase link --project-ref <your-ref>\n");

run(
  `npx supabase@latest db query --linked -f supabase/migrations/${MIGRATION}`,
  `Apply ${MIGRATION}`
);

query(
  "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_payments_org_created';",
  "Verify payments index"
);

query(
  "SELECT public.refresh_org_daily_summaries(90) AS rows_refreshed;",
  "Backfill daily summaries (90 days)"
);

query(
  `SELECT count(*)::int AS stale_org_count FROM public.rollup_freshness_stale_orgs(2);`,
  "Check stale rollup orgs (lag > 2 days)"
);

run("npm run verify:supabase", "Verify RPCs");

console.log("\n✅ Week 1 database tasks complete.");
console.log("Next:");
console.log("  1. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN on Vercel (see DEPLOY.md)");
console.log("  2. Enable 5-min cron: GitHub Actions workflow or npm run cron:process-queue");

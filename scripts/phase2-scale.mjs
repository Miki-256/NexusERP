#!/usr/bin/env node
/**
 * Phase 2 — Enterprise DB scale.
 * Applies migration 00051, refreshes summaries, captures baseline.
 *
 * Usage: npm run phase2:db
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const MIGRATION = "20260618000051_phase2_enterprise_scale.sql";

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

console.log("Phase 2 — Enterprise database scale");
console.log("Requires: npx supabase link --project-ref <your-ref>\n");

run(
  `npx supabase@latest db query --linked -f supabase/migrations/${MIGRATION}`,
  `Apply ${MIGRATION}`
);

run(
  `npx supabase@latest db query --linked "SELECT public.refresh_org_daily_summaries(90) AS rows_refreshed;"`,
  "Backfill daily summaries"
);

run("npm run verify:supabase", "Verify RPCs");
run("node scripts/db-baseline.mjs", "Capture baseline");

console.log("\n✅ Phase 2 complete.");
console.log("Next: set up external cron — see DEPLOY.md § Webhook queue cron");

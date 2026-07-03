#!/usr/bin/env node
/**
 * Phase 3 — True enterprise DB scale.
 * Applies migration 00052, runs maintenance, captures baseline.
 *
 * Usage: npm run phase3:db
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const MIGRATION = "20260618000052_phase3_enterprise_archive.sql";

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

console.log("Phase 3 — Enterprise archive + scale");
console.log("Requires: npx supabase link --project-ref <your-ref>\n");

run(
  `npx supabase@latest db query --linked -f supabase/migrations/${MIGRATION}`,
  `Apply ${MIGRATION}`
);

run(
  `npx supabase@latest db query --linked "SELECT public.run_enterprise_maintenance(false) AS maintenance;"`,
  "Run enterprise maintenance (no sales archive)"
);

run("npm run verify:supabase", "Verify RPCs");
run("node scripts/db-baseline.mjs", "Capture baseline");

console.log("\n✅ Phase 3 DB complete.");
console.log("Optional: npm run phase3:load — 50 VU POS load test");
console.log("Read replica: set SUPABASE_READ_URL on Vercel (see DEPLOY.md)");

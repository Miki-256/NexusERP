#!/usr/bin/env node
/**
 * Phase 1 — Stabilize remote database schema.
 * Applies missing migrations, verifies RPCs, captures baseline.
 *
 * Usage: npm run phase1:db
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const PHASE1_MIGRATIONS = [
  "20260618000033_subscription_phase2.sql",
  "20260618000043_sales_register_advanced.sql",
  "20260618000045_phase_c_quality.sql",
  "20260618000050_product_bulk_barcode.sql",
];

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

console.log("Phase 1 — Database stabilization");
console.log("Requires: npx supabase link --project-ref <your-ref>\n");

for (const file of PHASE1_MIGRATIONS) {
  const full = `supabase/migrations/${file}`;
  run(`npx supabase@latest db query --linked -f ${full}`, `Apply ${file}`);
}

run("npm run verify:supabase", "Verify RPCs");
run("node scripts/db-baseline.mjs", "Capture baseline");

console.log("\n✅ Phase 1 complete. Review .support/db-baseline-*.md");

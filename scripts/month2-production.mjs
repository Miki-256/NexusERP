#!/usr/bin/env node
/**
 * Month 2 — Enterprise scale.
 * Applies migration 00057 (RLS, audit trim, weekly archive).
 *
 * Usage: npm run month2:production
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MIGRATION = "20260618000057_month2_enterprise_scale.sql";

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

console.log("Month 2 — Enterprise scale");
console.log("Requires: npx supabase link --project-ref <your-ref>\n");

run(
  `npx supabase@latest db query --linked -f supabase/migrations/${MIGRATION}`,
  `Apply ${MIGRATION}`
);

run("npm run verify:supabase", "Verify RPCs");

console.log("\n✅ Month 2 database tasks complete.");
console.log("Manual: set SUPABASE_READ_URL on Vercel when Supabase Pro read replica is enabled.");

#!/usr/bin/env node
/**
 * Week 2 — Query & app efficiency.
 * Applies migration 00055 and verifies new RPCs exist.
 *
 * Usage: npm run week2:production
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MIGRATION = "20260618000055_week2_query_efficiency.sql";

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

console.log("Week 2 — Query & app efficiency");
console.log("Requires: npx supabase link --project-ref <your-ref>\n");

run(
  `npx supabase@latest db query --linked -f supabase/migrations/${MIGRATION}`,
  `Apply ${MIGRATION}`
);

run("npm run verify:supabase", "Verify RPCs");

console.log("\n✅ Week 2 database tasks complete.");
console.log("Deploy app changes: npm run deploy:live");

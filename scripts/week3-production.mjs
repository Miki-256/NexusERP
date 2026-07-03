#!/usr/bin/env node
/**
 * Week 3 — Security hardening.
 * Applies migration 00056 and verifies RPC grants.
 *
 * Usage: npm run week3:production
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MIGRATION = "20260618000056_week3_security_hardening.sql";

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

console.log("Week 3 — Security hardening");
console.log("Requires: npx supabase link --project-ref <your-ref>\n");

run(
  `npx supabase@latest db query --linked -f supabase/migrations/${MIGRATION}`,
  `Apply ${MIGRATION}`
);

run("npm run verify:supabase", "Verify RPCs");

console.log("\n✅ Week 3 database tasks complete.");
console.log("Deploy app changes: npm run deploy:live");

#!/usr/bin/env node
/**
 * Verifies launch-ops workflows and production audit scripts exist.
 * Run: npm run audit:launch-ops
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const requiredFiles = [
  ".github/workflows/cron-process-queue.yml",
  ".github/workflows/cron-health-monitor.yml",
  "docs/LAUNCH-OPS.md",
  "scripts/verify-production-env.mjs",
  "scripts/setup-launch-ops.mjs",
];

const requiredScripts = [
  "verify:production-env",
  "verify:supabase",
  "audit:stable-rpcs",
  "audit:rls",
  "audit:api-auth",
  "audit:financials-scope",
  "audit:e2e",
  "test:integration",
  "test:e2e",
];

const issues = [];

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) {
    issues.push(`Missing file: ${file}`);
  }
}

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
for (const script of requiredScripts) {
  if (!pkg.scripts?.[script]) {
    issues.push(`Missing npm script: ${script}`);
  }
}

const launchOps = readFileSync(path.join(root, "docs/LAUNCH-OPS.md"), "utf8");
for (const marker of ["CRON_SECRET", "verify:supabase", "test:integration", "GET /api/health"]) {
  if (!launchOps.includes(marker)) {
    issues.push(`LAUNCH-OPS.md missing marker: ${marker}`);
  }
}

if (issues.length > 0) {
  console.error("Launch ops audit failed:\n");
  for (const issue of issues) console.error(`  ${issue}`);
  process.exit(1);
}

console.log("Launch ops audit passed.");

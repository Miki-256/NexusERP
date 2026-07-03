#!/usr/bin/env node
/**
 * Phase 3 — Enterprise load test profile.
 * Target: 50 concurrent VUs, p95 complete_sale < 500ms (stretch), >90% success.
 *
 * Prerequisites:
 *   node scripts/k6/prepare-pos-load.mjs
 *   brew install k6   # or https://grafana.com/docs/k6/latest/set-up/install-k6/
 *
 * Usage:
 *   npm run phase3:load
 *   LOAD_VUS=50 LOAD_ITERATIONS=500 npm run phase3:load
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const vus = process.env.LOAD_VUS ?? "50";
const iterations = process.env.LOAD_ITERATIONS ?? "500";

console.log("Phase 3 load test — POS concurrent sales");
console.log(`VUs: ${vus} | Iterations: ${iterations}`);
console.log("Enterprise target: p95 < 500ms, success rate > 90%\n");

try {
  execSync("node scripts/k6/prepare-pos-load.mjs", { cwd: ROOT, stdio: "inherit" });
} catch {
  console.error("Failed to prepare POS fixtures. Set E2E_EMAIL/E2E_PASSWORD in apps/web/.env.local");
  process.exit(1);
}

const env = {
  ...process.env,
  LOAD_VUS: vus,
  LOAD_ITERATIONS: iterations,
  K6_VUS: vus,
  K6_ITERATIONS: iterations,
  PHASE3_PROFILE: "1",
};

try {
  execSync("k6 run scripts/k6/pos-concurrent-sales.js", {
    cwd: path.join(ROOT, "scripts/k6"),
    stdio: "inherit",
    env,
  });
} catch {
  process.exit(1);
}

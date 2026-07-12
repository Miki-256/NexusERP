#!/usr/bin/env node
/**
 * Pre-launch production environment checklist.
 * Run before go-live: npm run verify:production-env
 *
 * Set CHECK_PRODUCTION_ENV=1 to fail on missing recommended vars (for CI on main).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const strict = process.env.CHECK_PRODUCTION_ENV === "1";

function loadEnvFile(filePath) {
  const out = {};
  try {
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
  return out;
}

const env = {
  ...loadEnvFile(path.join(__dirname, "../apps/web/.env.local")),
  ...process.env,
};

const required = [
  ["NEXT_PUBLIC_SUPABASE_URL", "Supabase project URL"],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "Supabase anon/publishable key"],
  ["SUPABASE_SERVICE_ROLE_KEY", "Service role for webhooks/cron/health probe"],
  ["NEXT_PUBLIC_APP_URL", "Public app URL for auth redirects"],
  ["CRON_SECRET", "Process-queue + health probe auth"],
  ["POS_WEBHOOK_SECRET", "Mobile-money + internal webhook auth"],
];

const recommended = [
  ["UPSTASH_REDIS_REST_URL", "Distributed login/API rate limits"],
  ["UPSTASH_REDIS_REST_TOKEN", "Upstash REST token"],
  ["SENTRY_DSN", "Error monitoring"],
  ["RESEND_API_KEY", "Notification email delivery"],
  ["NOTIFICATION_FROM_EMAIL", "Default notification sender address"],
];

const automatedGates = [
  "npm run verify:supabase",
  "npm run test:integration",
  "npm run test:e2e",
  "npm run audit:stable-rpcs",
  "npm run audit:rls",
  "npm run audit:api-auth",
  "npm run audit:launch-ops",
];

let failed = 0;
let warned = 0;

console.log("NexusERP production environment check\n");

for (const [key, label] of required) {
  const val = env[key];
  if (!val || val.includes("placeholder") || val.includes("your-")) {
    console.log(`❌ MISSING (required): ${key} — ${label}`);
    failed++;
  } else {
    console.log(`✅ ${key}`);
  }
}

for (const [key, label] of recommended) {
  const val = env[key];
  if (!val || val.includes("your-")) {
    console.log(`⚠️  MISSING (recommended): ${key} — ${label}`);
    warned++;
  } else {
    console.log(`✅ ${key}`);
  }
}

console.log("\nOperational gates (automated in CI when secrets are set):");
for (const gate of automatedGates) {
  console.log(`  • ${gate}`);
}

console.log("\nOperational gates (manual):");
console.log("  • GitHub Actions cron-process-queue.yml — APP_URL + CRON_SECRET");
console.log("  • GitHub Actions cron-health-monitor.yml — APP_URL + CRON_SECRET (detailed probe)");
console.log("  • GET /api/health — public liveness; Bearer CRON_SECRET for queue depths");
console.log("  • Supabase Dashboard → Database → Backups — confirm PITR enabled (Pro)");

if (failed > 0) {
  console.log(`\n${failed} required variable(s) missing.`);
  if (strict) process.exit(1);
  process.exit(0);
}

if (warned > 0 && strict) {
  console.log(`\n${warned} recommended variable(s) missing (strict mode).`);
  process.exit(1);
}

console.log("\nEnvironment check passed.");
process.exit(0);

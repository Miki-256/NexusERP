#!/usr/bin/env node
/**
 * Launch ops setup — validates health, process-queue cron, and documents missing secrets.
 *
 * Usage:
 *   node scripts/setup-launch-ops.mjs
 *   APP_URL=https://... CRON_SECRET=... node scripts/setup-launch-ops.mjs --apply-github-secrets
 *
 * Reads apps/web/.env.local for LOAD_TEST_* / E2E_* / UPSTASH_* when present.
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const applyGithub = process.argv.includes("--apply-github-secrets");
const generateCron = process.argv.includes("--generate-cron-secret");
const skipIntegration = process.argv.includes("--skip-integration");

function loadEnvFile(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

const fileEnv = loadEnvFile(path.join(root, "apps/web/.env.local"));
// Prefer .env.local over a stale exported shell var (e.g. after secret rotation).
const env = { ...process.env, ...fileEnv };

const APP_URL =
  env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? env.E2E_BASE_URL ?? "https://nexus-erp-preprod.vercel.app";
const CRON_SECRET = env.CRON_SECRET;
const UPSTASH_URL = env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = env.UPSTASH_REDIS_REST_TOKEN;

console.log("NexusERP launch ops setup\n");
console.log(`APP_URL: ${APP_URL}`);

if (generateCron) {
  if (CRON_SECRET && !process.argv.includes("--force")) {
    console.log("\nCRON_SECRET already exists in apps/web/.env.local.");
    console.log("Sync it to Vercel (no new secret needed):");
    console.log("  npm run vercel:launch-env");
    console.log("  npm run deploy:live");
    console.log("  npm run setup:launch-ops");
    console.log("\nTo generate a NEW secret instead: --generate-cron-secret --force");
    process.exit(0);
  }
  const secret = randomBytes(32).toString("hex");
  console.log("\nGenerated CRON_SECRET (save to Vercel + GitHub repo secrets):");
  console.log(secret);
  console.log("\nAdd to apps/web/.env.local:");
  console.log(`CRON_SECRET=${secret}`);
  console.log("\nThen:");
  console.log("  npm run vercel:launch-env");
  console.log("  npm run deploy:live");
  process.exit(0);
}

async function checkHealth() {
  const url = `${APP_URL.replace(/\/$/, "")}/api/health`;
  console.log(`\n1. Health probe: GET ${url}`);
  try {
    const res = await fetch(url);
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.log(`   HTTP ${res.status} (non-JSON — redeploy required for public /api/health)`);
      console.log(`   Preview: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
      return false;
    }
    const body = await res.json();
    console.log(`   HTTP ${res.status}`, JSON.stringify(body));
    if (res.status === 503 || body.status === "degraded") {
      console.log("   ⚠️  Degraded — ensure 5-min process-queue cron is running");
      return false;
    }
    if (!res.ok) {
      console.log("   ❌ Unhealthy");
      return false;
    }
    console.log("   ✅ Healthy");
    return true;
  } catch (err) {
    console.log(`   ❌ ${err.message}`);
    return false;
  }
}

async function checkProcessQueue() {
  if (!CRON_SECRET) {
    console.log("\n2. Process-queue: skipped (CRON_SECRET not in env)");
    console.log("   Generate: node scripts/setup-launch-ops.mjs --generate-cron-secret");
    return false;
  }
  const url = `${APP_URL.replace(/\/$/, "")}/api/webhooks/process-queue`;
  console.log(`\n2. Process-queue: POST ${url}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    console.log(`   HTTP ${res.status}`, typeof body === "object" ? JSON.stringify(body) : body);
    if (!res.ok) {
      console.log("   ❌ Cron auth failed — CRON_SECRET must match Vercel");
      console.log("   Fix: npm run vercel:launch-env && npm run deploy:live");
      return false;
    }
    console.log("   ✅ Process-queue OK");
    return true;
  } catch (err) {
    console.log(`   ❌ ${err.message}`);
    return false;
  }
}

function checkUpstash() {
  console.log("\n3. Upstash Redis (distributed rate limits)");
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    console.log("   ✅ UPSTASH_REDIS_REST_URL + TOKEN found locally");
    console.log("   → Confirm both are set on Vercel Production + redeploy");
    return true;
  }
  console.log("   ⚠️  Missing locally (optional for pilot)");
  console.log("   → Already on Vercel Production if configured earlier — local copy is for scripts only");
  console.log("   → https://upstash.com → Redis → copy REST URL + token into apps/web/.env.local");
  return true; // optional — do not fail launch ops
}

function checkGithubSecrets() {
  console.log("\n4. GitHub Actions secrets (APP_URL + CRON_SECRET)");
  try {
    execSync("gh --version", { stdio: "pipe" });
  } catch {
    console.log("   ⚠️  GitHub CLI (gh) not installed — set secrets manually:");
    console.log("   → Repo → Settings → Secrets and variables → Actions");
    console.log(`   → APP_URL = ${APP_URL}`);
    console.log("   → CRON_SECRET = (same as Vercel)");
    console.log("   Workflows: cron-process-queue.yml, cron-health-monitor.yml");
    return false;
  }
  try {
    const list = execSync("gh secret list", { cwd: root, encoding: "utf8" });
    const hasApp = /APP_URL/.test(list);
    const hasCron = /CRON_SECRET/.test(list);
    console.log(`   APP_URL: ${hasApp ? "✅ set" : "❌ missing"}`);
    console.log(`   CRON_SECRET: ${hasCron ? "✅ set" : "❌ missing"}`);
    if (applyGithub && CRON_SECRET) {
      if (!hasApp) {
        execSync(`gh secret set APP_URL --body "${APP_URL}"`, { cwd: root, stdio: "inherit" });
      }
      if (!hasCron) {
        execSync(`gh secret set CRON_SECRET --body "${CRON_SECRET}"`, { cwd: root, stdio: "inherit" });
      }
      console.log("   Applied secrets via gh");
      const listAfter = execSync("gh secret list", { cwd: root, encoding: "utf8" });
      return /APP_URL/.test(listAfter) && /CRON_SECRET/.test(listAfter);
    }
    return hasApp && hasCron;
  } catch (err) {
    console.log(`   ⚠️  gh not authenticated: ${err.message}`);
    console.log("   Run: gh auth login");
    return false;
  }
}

function runIntegrationTests() {
  console.log("\n5. Integration tests (remote Supabase RPCs)");
  if (skipIntegration) {
    console.log("   Skipped (--skip-integration). Run: npm run test:integration");
    return true;
  }
  const email = env.INTEGRATION_TEST_EMAIL ?? env.E2E_EMAIL ?? env.LOAD_TEST_EMAIL;
  const password = env.INTEGRATION_TEST_PASSWORD ?? env.E2E_PASSWORD ?? env.LOAD_TEST_PASSWORD;
  if (!email || !password) {
    console.log("   ❌ Set LOAD_TEST_EMAIL + LOAD_TEST_PASSWORD in apps/web/.env.local");
    return false;
  }
  const result = spawnSync("npm", ["run", "test:integration"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
      INTEGRATION_TEST_EMAIL: email,
      INTEGRATION_TEST_PASSWORD: password,
    },
  });
  return result.status === 0;
}

const healthOk = await checkHealth();
const queueOk = await checkProcessQueue();
const upstashOk = checkUpstash();
const githubOk = checkGithubSecrets();
const testsOk = runIntegrationTests();

console.log("\n--- Summary ---");
console.log(`Health:        ${healthOk ? "OK" : "ACTION NEEDED"}`);
console.log(`Process-queue: ${queueOk ? "OK" : "ACTION NEEDED"}`);
console.log(`Upstash:       ${upstashOk ? "OK" : "ACTION NEEDED"}`);
console.log(`GitHub secrets:${githubOk ? "OK" : "ACTION NEEDED"}`);
console.log(`Integration:   ${testsOk ? "OK" : "ACTION NEEDED"}`);

const allOk = healthOk && queueOk && upstashOk && githubOk && testsOk;
process.exit(allOk ? 0 : 1);

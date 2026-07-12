#!/usr/bin/env node
/**
 * Ensures local launch secrets exist in apps/web/.env.local (does not overwrite).
 * Run: node scripts/ensure-local-launch-env.mjs
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../apps/web/.env.local");

if (!existsSync(envPath)) {
  console.error("Missing apps/web/.env.local — copy from .env.example first.");
  process.exit(1);
}

let content = readFileSync(envPath, "utf8");
const additions = [];

function ensure(key, value) {
  if (new RegExp(`^${key}=`, "m").test(content)) return;
  additions.push(`${key}=${value}`);
}

ensure("NEXT_PUBLIC_APP_URL", "https://nexus-erp-preprod.vercel.app");
ensure("E2E_BASE_URL", "https://nexus-erp-preprod.vercel.app");
ensure("CRON_SECRET", randomBytes(32).toString("hex"));
ensure("POS_WEBHOOK_SECRET", randomBytes(32).toString("hex"));

if (additions.length === 0) {
  console.log("Local launch env already complete.");
  process.exit(0);
}

content = `${content.trim()}\n\n# Added by scripts/ensure-local-launch-env.mjs\n${additions.join("\n")}\n`;
writeFileSync(envPath, content);
console.log(`Added ${additions.length} missing launch env var(s) to apps/web/.env.local.`);
console.log("Sync CRON_SECRET and POS_WEBHOOK_SECRET to Vercel + GitHub before production cron.");

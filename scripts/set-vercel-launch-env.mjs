#!/usr/bin/env node
/** Push launch cron secrets to Vercel from apps/web/.env.local (never logs secret values). */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, "apps/web/.env.local");

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val.trim();
  }
  return out;
}

function vercelEnvAdd(name, value) {
  for (const target of ["production", "preview", "development"]) {
    const child = spawnSync(
      "npx",
      ["--yes", "vercel@latest", "env", "add", name, target, "--force", "-y"],
      {
        input: value,
        encoding: "utf8",
        cwd: root,
        stdio: ["pipe", "inherit", "inherit"],
      }
    );
    if (child.status !== 0) {
      process.exit(child.status ?? 1);
    }
    console.log(`Vercel env set: ${name} (${target})`);
  }
}

const env = parseEnv(envPath);
const cronSecret = env.CRON_SECRET?.trim();
if (!cronSecret) {
  console.error("CRON_SECRET missing in apps/web/.env.local");
  console.error("Run: node scripts/ensure-local-launch-env.mjs");
  process.exit(1);
}

console.log("Pushing launch secrets to Vercel (requires: npx vercel login)…\n");
vercelEnvAdd("CRON_SECRET", cronSecret);

const posSecret = env.POS_WEBHOOK_SECRET?.trim();
if (posSecret) {
  vercelEnvAdd("POS_WEBHOOK_SECRET", posSecret);
} else {
  console.log("Skipped POS_WEBHOOK_SECRET (not in .env.local)");
}

console.log("\nRedeploy for env changes to take effect:");
console.log("  npm run deploy:live");
console.log("\nThen verify:");
console.log("  npm run setup:launch-ops");

#!/usr/bin/env node
/**
 * Single source of truth for CRON_SECRET — local, Vercel, GitHub.
 * Usage: node scripts/sync-cron-secret.mjs [--apply-github]
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, "apps/web/.env.local");
const applyGithub = process.argv.includes("--apply-github");
const rotate = process.argv.includes("--rotate");

function parseEnv(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
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

function upsertEnvLocal(key, value) {
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${key}=${value}\n`);
    return;
  }
  const lines = readFileSync(envPath, "utf8").split("\n");
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);
  writeFileSync(envPath, next.join("\n").replace(/\n*$/, "\n"));
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
    if (child.status !== 0) process.exit(child.status ?? 1);
    console.log(`Vercel: ${name} (${target})`);
  }
}

const existing = parseEnv(envPath).CRON_SECRET;
const secret =
  rotate || !existing || existing.length < 32
    ? randomBytes(32).toString("hex")
    : existing;

console.log("Syncing CRON_SECRET across local, Vercel, and GitHub…\n");
upsertEnvLocal("CRON_SECRET", secret);
console.log("Updated apps/web/.env.local");

vercelEnvAdd("CRON_SECRET", secret);

if (applyGithub) {
  try {
    execSync(`gh secret set CRON_SECRET --body "${secret}"`, { cwd: root, stdio: "inherit" });
    console.log("GitHub: CRON_SECRET updated");
  } catch (err) {
    console.warn("GitHub secret not updated:", err.message);
  }
}

console.log("\nNext: npm run deploy:live");
console.log("Then:  npm run setup:launch-ops -- --skip-integration");

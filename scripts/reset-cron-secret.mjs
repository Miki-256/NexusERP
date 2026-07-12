#!/usr/bin/env node
/**
 * Force-reset CRON_SECRET to a fresh value on local + Vercel + GitHub.
 * Usage: node scripts/reset-cron-secret.mjs
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, "apps/web/.env.local");
const secret = randomBytes(32).toString("hex");

function upsertLocal(key, value) {
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${key}=${value}\n`);
    return;
  }
  let content = readFileSync(envPath, "utf8");
  if (new RegExp(`^${key}=`, "m").test(content)) {
    content = content.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  } else {
    content = `${content.trimEnd()}\n${key}=${value}\n`;
  }
  writeFileSync(envPath, content.endsWith("\n") ? content : `${content}\n`);
}

function vercelRm(name, target) {
  spawnSync("npx", ["--yes", "vercel@latest", "env", "rm", name, target, "-y"], {
    cwd: root,
    stdio: "inherit",
  });
}

function vercelAdd(name, target, value) {
  const child = spawnSync(
    "npx",
    ["--yes", "vercel@latest", "env", "add", name, target],
    {
      cwd: root,
      input: value,
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
    }
  );
  if (child.status !== 0) {
    console.error(`Failed to add ${name} to ${target}`);
    process.exit(child.status ?? 1);
  }
}

console.log("Resetting CRON_SECRET…");
upsertLocal("CRON_SECRET", secret);
console.log(`Local length: ${secret.length}`);

for (const target of ["production", "preview", "development"]) {
  vercelRm("CRON_SECRET", target);
}
for (const target of ["production", "preview", "development"]) {
  vercelAdd("CRON_SECRET", target, secret);
  console.log(`Vercel ${target}: set`);
}

try {
  execSync(`gh secret set CRON_SECRET --body "${secret}"`, { cwd: root, stdio: "inherit" });
  console.log("GitHub: set");
} catch {
  console.warn("GitHub: skipped");
}

console.log("\nDone. Redeploy + alias required.");

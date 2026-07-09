#!/usr/bin/env node
/** Push Telegram env vars to Vercel from apps/web/.env.local (never logs secrets). */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../apps/web/.env.local");

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
    out[key] = val;
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
        cwd: resolve(__dirname, ".."),
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
const token = env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN missing in apps/web/.env.local");
  process.exit(1);
}

vercelEnvAdd("TELEGRAM_BOT_TOKEN", token);
vercelEnvAdd("NOTIFICATION_TELEGRAM_ENABLED", env.NOTIFICATION_TELEGRAM_ENABLED?.trim() || "true");

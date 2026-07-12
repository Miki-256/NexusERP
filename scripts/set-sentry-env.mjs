#!/usr/bin/env node
/**
 * Write Sentry env vars to apps/web/.env.local and push to Vercel.
 * Usage:
 *   node scripts/set-sentry-env.mjs
 *   SENTRY_DSN=... SENTRY_ORG=... node scripts/set-sentry-env.mjs
 *
 * Reads from process.env first, then existing .env.local keys.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../apps/web/.env.local");

const KEYS = [
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
];

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

function upsertEnvFile(path, entries) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const seen = new Set();

  const updated = lines.map((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (!m || !(m[1] in entries)) return line;
    seen.add(m[1]);
    return `${m[1]}=${entries[m[1]]}`;
  });

  const block = ["", "# Sentry error monitoring"];
  for (const key of KEYS) {
    const val = entries[key];
    if (!val || seen.has(key)) continue;
    block.push(`${key}=${val}`);
    seen.add(key);
  }

  const trailing = block.length > 2 ? block.join("\n") : "";
  const body = [...updated.filter((l, i, arr) => !(i === arr.length - 1 && l === ""))];
  if (trailing) body.push(trailing);
  writeFileSync(path, `${body.join("\n").replace(/\n*$/, "\n")}`, "utf8");
}

function vercelEnvAdd(name, value, secret = false) {
  const targets = ["production", "preview", "development"];
  for (const target of targets) {
    const args = ["--yes", "vercel@latest", "env", "add", name, target, "--force", "-y"];
    if (secret && target !== "development") args.push("--sensitive");
    const child = spawnSync("npx", args, {
      input: value,
      encoding: "utf8",
      cwd: resolve(__dirname, ".."),
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (child.status !== 0) process.exit(child.status ?? 1);
    console.log(`Vercel env set: ${name} (${target})`);
  }
}

const fileEnv = parseEnv(envPath);
const values = Object.fromEntries(
  KEYS.map((key) => [key, process.env[key]?.trim() || fileEnv[key]?.trim() || ""])
);

if (!values.SENTRY_DSN) {
  console.error("Missing SENTRY_DSN. Set it in the environment or apps/web/.env.local first.");
  console.error("Get it from https://sentry.io/settings/projects/ → Client Keys (DSN)");
  process.exit(1);
}

if (!values.NEXT_PUBLIC_SENTRY_DSN) {
  values.NEXT_PUBLIC_SENTRY_DSN = values.SENTRY_DSN;
}

upsertEnvFile(envPath, values);
console.log(`Updated ${envPath}`);

const push = process.argv.includes("--push-vercel");
if (!push) {
  console.log("Local .env.local updated. Re-run with --push-vercel to sync to Vercel.");
  process.exit(0);
}

vercelEnvAdd("SENTRY_DSN", values.SENTRY_DSN, true);
vercelEnvAdd("NEXT_PUBLIC_SENTRY_DSN", values.NEXT_PUBLIC_SENTRY_DSN, false);

if (values.SENTRY_AUTH_TOKEN) vercelEnvAdd("SENTRY_AUTH_TOKEN", values.SENTRY_AUTH_TOKEN, true);
if (values.SENTRY_ORG) vercelEnvAdd("SENTRY_ORG", values.SENTRY_ORG, false);
if (values.SENTRY_PROJECT) vercelEnvAdd("SENTRY_PROJECT", values.SENTRY_PROJECT, false);

console.log("Done.");

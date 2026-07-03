#!/usr/bin/env node
/**
 * Safe Next.js dev launcher.
 *
 * Prevents "unstyled HTML only" pages caused by:
 * - multiple `next dev` processes sharing / corrupting `.next`
 * - stale webpack chunk hashes after hot reload / runtime errors
 * - wiping `.next` while another dev server is still running
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT ?? "3003";
const fresh = process.argv.includes("--fresh");

const PORTS = ["3000", "3001", "3003", PORT].filter(
  (p, i, arr) => arr.indexOf(p) === i
);

function run(cmd) {
  try {
    return execSync(cmd, { stdio: "pipe", encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function killPort(port) {
  const pids = run(`lsof -ti:${port} 2>/dev/null`);
  if (!pids) return;
  for (const pid of pids.split("\n").filter(Boolean)) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

async function killStaleDevServers() {
  console.log(`Ensuring a single dev server (ports ${PORTS.join(", ")})…`);
  for (const port of PORTS) killPort(port);
  run("pkill -f 'next dev' 2>/dev/null || true");
  await delay(600);
}

function wipeCache() {
  console.log("Removing .next and webpack cache…");
  rmSync(path.join(ROOT, ".next"), { recursive: true, force: true });
  rmSync(path.join(ROOT, "node_modules", ".cache"), { recursive: true, force: true });
}

function isCorruptNextDir() {
  const nextDir = path.join(ROOT, ".next");
  if (!existsSync(nextDir)) return false;
  const markers = ["BUILD_ID", "package.json"];
  return markers.some((m) => !existsSync(path.join(nextDir, m)));
}

async function main() {
  await killStaleDevServers();

  if (fresh) {
    wipeCache();
  } else if (isCorruptNextDir()) {
    console.warn("Detected incomplete .next cache — wiping before start…");
    wipeCache();
  }

  console.log(`Starting Next.js dev on http://localhost:${PORT} (Turbopack)…`);
  console.log("Tip: use npm run dev:fresh for a full cache reset after major changes.\n");

  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "dev", "--turbopack", "-p", PORT],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, PORT },
    }
  );

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

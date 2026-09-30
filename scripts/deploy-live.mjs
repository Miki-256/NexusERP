#!/usr/bin/env node
/**
 * Production deploy via Vercel CLI.
 *
 * Vercel CLI 61 + Node 24 often aborts with "fetch failed" AFTER the deployment
 * is created (Inspect/Production URLs printed) while the remote build continues.
 * This script:
 *  1. Forces IPv4-first DNS (avoids many AbortError/fetch failed flakes)
 *  2. Captures the deployment URL even when the CLI exits non-zero
 *  3. Polls `vercel inspect` until Ready / Error (CLI --wait caps at ~3m)
 *  4. Aliases nexus-erp-preprod.vercel.app to the Ready deployment
 */
import { spawn, spawnSync } from "node:child_process";

const token = process.env.VERCEL_TOKEN?.trim();
const PRODUCTION_HOST = process.env.VERCEL_PRODUCTION_HOST ?? "nexus-erp-preprod.vercel.app";
const MAX_DEPLOY_ATTEMPTS = Number(process.env.VERCEL_DEPLOY_ATTEMPTS ?? 3);
const POLL_MS = Number(process.env.VERCEL_POLL_MS ?? 20_000);
const POLL_MAX_MS = Number(process.env.VERCEL_POLL_MAX_MS ?? 20 * 60 * 1000);

const npxEnv = {
  ...process.env,
  VERCEL_FORCE_NO_BUILD_CACHE: "1",
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"]
    .filter(Boolean)
    .join(" "),
};

function vercelArgs(subcommand) {
  const args = ["--yes", "vercel@latest", ...subcommand];
  if (token) args.push("--token", token);
  return args;
}

function runSync(args, opts = {}) {
  return spawnSync("npx", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: npxEnv,
    ...opts,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractDeploymentUrl(text) {
  const patterns = [
    /Production\s+(https:\/\/[^\s]+\.vercel\.app)/i,
    /(https:\/\/nexus-erp-preprod-[a-z0-9-]+\.vercel\.app)/i,
    /"url"\s*:\s*"(https:\/\/[^"]+\.vercel\.app)"/,
    /Fetched deployment "(nexus-erp-preprod-[a-z0-9-]+\.vercel\.app)"/i,
    /Inspect\s+https:\/\/vercel\.com\/[^\s/]+\/[^\s/]+\/([A-Za-z0-9]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    if (m[1]?.startsWith("https://")) return m[1];
    if (m[1]?.includes(".vercel.app")) return `https://${m[1]}`;
    if (m[0].includes("Inspect") && m[1]) return m[1];
  }
  return "";
}

function isTransientCliFailure(log) {
  return /fetch failed|AbortError|ECONNRESET|ETIMEDOUT|socket hang up|UND_ERR|deploy_failed/i.test(
    log
  );
}

function aliasProduction(urlOrHost) {
  const host = urlOrHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!host.includes(".vercel.app")) {
    console.error(`Cannot alias non-vercel host: ${host}`);
    return false;
  }
  console.log(`\nAssigning ${PRODUCTION_HOST} → ${host}`);
  const result = runSync(vercelArgs(["alias", "set", host, PRODUCTION_HOST]), {
    stdio: "inherit",
  });
  return result.status === 0;
}

function inspectOnce(target) {
  const result = runSync(vercelArgs(["inspect", target]), {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const statusMatch = out.match(/status\s+[●○]\s+(\w+)/i);
  const status = (statusMatch?.[1] ?? "").toLowerCase();
  const urlMatch =
    out.match(/url\s+(https:\/\/[^\s]+\.vercel\.app)/i) ||
    out.match(/Fetched deployment "(nexus-erp-preprod-[^"]+\.vercel\.app)"/i);
  let url = urlMatch?.[1] ?? "";
  if (url && !url.startsWith("https://")) url = `https://${url}`;
  return { status, url, output: out, exitCode: result.status };
}

async function waitForDeployment(target) {
  console.log(
    `\nPolling ${target} every ${Math.round(POLL_MS / 1000)}s (max ${Math.round(POLL_MAX_MS / 60000)}m)…`
  );
  const started = Date.now();
  let lastStatus = "";

  while (Date.now() - started < POLL_MAX_MS) {
    const snap = inspectOnce(target);
    if (snap.status && snap.status !== lastStatus) {
      console.log(`  status: ${snap.status}${snap.url ? ` (${snap.url})` : ""}`);
      lastStatus = snap.status;
    } else if (!snap.status) {
      console.log("  status: (unknown / inspect flaked — retrying)");
    }

    if (snap.status === "ready") {
      return { ok: true, error: false, status: "ready", url: snap.url };
    }
    if (snap.status === "error" || snap.status === "canceled" || snap.status === "cancelled") {
      // Print last inspect block for debugging
      process.stdout.write(snap.output);
      return { ok: false, error: true, status: snap.status, url: snap.url };
    }

    await sleep(POLL_MS);
  }

  console.error("Timed out waiting for deployment to leave Building.");
  return { ok: false, error: false, status: lastStatus || "timeout", url: "" };
}

function deployOnce(attempt) {
  return new Promise((resolve) => {
    console.log(`\n── Deploy attempt ${attempt}/${MAX_DEPLOY_ATTEMPTS} ──`);
    const child = spawn("npx", vercelArgs(["deploy", "--prod", "--yes"]), {
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: npxEnv,
    });

    let fullLog = "";
    let deploymentRef = "";

    function onData(chunk, stream) {
      const text = chunk.toString();
      fullLog += text;
      stream.write(text);
      const found = extractDeploymentUrl(fullLog);
      if (found) deploymentRef = found;
    }

    child.stdout.on("data", (c) => onData(c, process.stdout));
    child.stderr.on("data", (c) => onData(c, process.stderr));
    child.on("error", (err) => resolve({ code: 1, log: String(err), deploymentRef }));
    child.on("close", (code) => {
      if (!deploymentRef) deploymentRef = extractDeploymentUrl(fullLog);
      resolve({ code: code ?? 1, log: fullLog, deploymentRef });
    });
  });
}

async function finishReady(url) {
  if (url) aliasProduction(url);
  console.log("\n✓ Deployment is live.");
  if (url) console.log(`  ${url}`);
  console.log(`  https://${PRODUCTION_HOST}`);
  process.exit(0);
}

async function main() {
  let lastRef = "";
  let lastLog = "";

  for (let attempt = 1; attempt <= MAX_DEPLOY_ATTEMPTS; attempt++) {
    const { code, log, deploymentRef } = await deployOnce(attempt);
    lastLog = log;
    if (deploymentRef) lastRef = deploymentRef;

    const target = deploymentRef || lastRef;

    if (code === 0) {
      if (target) {
        const waited = await waitForDeployment(target);
        if (waited.ok) {
          await finishReady(waited.url || (target.startsWith("http") ? target : ""));
        }
        if (waited.error) {
          console.error("\n✗ Remote build failed.");
          process.exit(1);
        }
      }
      console.log("\n✓ Deployment command finished.");
      if (target) console.log(`  ${target}`);
      console.log(`  https://${PRODUCTION_HOST}`);
      process.exit(0);
    }

    if (target && isTransientCliFailure(log)) {
      console.warn(
        "\n⚠ Vercel CLI dropped the connection after creating the deployment (known Node 24 / CLI flake)."
      );
      console.warn("  Recovering by polling the remote build…");
      const waited = await waitForDeployment(target);
      if (waited.ok) {
        await finishReady(waited.url || (target.startsWith("http") ? target : ""));
      }
      if (waited.error) {
        console.error("\n✗ Remote build failed after CLI disconnect.");
        process.exit(1);
      }
      console.error("\n✗ Could not confirm Ready status after CLI disconnect.");
      console.error(`  Check: npx vercel inspect ${target}`);
      process.exit(1);
    }

    if (!isTransientCliFailure(log)) break;
    console.warn(`Transient deploy failure on attempt ${attempt}; retrying…`);
  }

  if (!token) {
    const authLikely =
      /not authenticated|login required|No existing credentials|Unauthorized|invalid token|Not authorized/i.test(
        lastLog
      );
    if (authLikely) {
      console.error("");
      console.error("Vercel auth required. Run one of:");
      console.error("  npx vercel login");
      console.error("  VERCEL_TOKEN=<token> npm run deploy:live");
      console.error("  https://vercel.com/account/tokens");
    }
  }

  if (lastRef) {
    console.error(`\nLast known deployment: ${lastRef}`);
    console.error(`  npx vercel inspect ${lastRef}`);
  }
  console.error("\n✗ Deployment failed.");
  console.error(`  https://${PRODUCTION_HOST}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

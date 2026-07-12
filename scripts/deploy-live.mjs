#!/usr/bin/env node
/**
 * Production deploy via Vercel CLI.
 * After Ready, explicitly aliases nexus-erp-preprod.vercel.app to the new
 * deployment (CLI --prod alone often only updates the team subdomain).
 */
import { spawn, spawnSync } from "node:child_process";

const token = process.env.VERCEL_TOKEN?.trim();
const PRODUCTION_HOST = process.env.VERCEL_PRODUCTION_HOST ?? "nexus-erp-preprod.vercel.app";
const args = ["vercel@latest", "deploy", "--prod", "--yes"];
if (token) {
  args.push("--token", token);
}

const child = spawn("npx", ["--yes", ...args], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
  env: { ...process.env, VERCEL_FORCE_NO_BUILD_CACHE: "1" },
});

let buffer = "";
let ready = false;
let exitTimer = null;
let deploymentUrl = "";

function aliasProduction(url) {
  const host = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  console.log(`\nAssigning ${PRODUCTION_HOST} → ${host}`);
  const aliasArgs = ["--yes", "vercel@latest", "alias", "set", host, PRODUCTION_HOST];
  if (token) aliasArgs.push("--token", token);
  const result = spawnSync("npx", aliasArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  return result.status === 0;
}

function finish(ok) {
  if (exitTimer) clearTimeout(exitTimer);
  if (ok && deploymentUrl) {
    aliasProduction(deploymentUrl);
  }
  console.log("");
  console.log(ok ? "✓ Deployment is live." : "✗ Deployment failed.");
  if (deploymentUrl) console.log(`  ${deploymentUrl}`);
  console.log(`  https://${PRODUCTION_HOST}`);
  child.kill("SIGTERM");
  setTimeout(() => process.exit(ok ? 0 : 1), 500);
}

function onData(chunk, stream) {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    stream.write(line + "\n");

    const prodMatch = line.match(/Production\s+(https:\S+\.vercel\.app)/i);
    if (prodMatch) deploymentUrl = prodMatch[1];

    const jsonUrl = line.match(/"url":\s*"(https:[^"]+\.vercel\.app)"/);
    if (jsonUrl) deploymentUrl = jsonUrl[1];

    if (!ready && /✓ Ready|Ready in|readyState": "READY"|Deployment completed/i.test(line)) {
      ready = true;
      exitTimer = setTimeout(() => finish(true), 8_000);
    }
  }
}

child.stdout.on("data", (chunk) => onData(chunk, process.stdout));
child.stderr.on("data", (chunk) => onData(chunk, process.stderr));

child.on("close", (code) => {
  if (exitTimer) clearTimeout(exitTimer);
  if (ready) {
    if (deploymentUrl) aliasProduction(deploymentUrl);
    process.exit(0);
  }
  if (code !== 0 && !token) {
    console.error("");
    console.error("Vercel auth required. Run one of:");
    console.error("  npx vercel login");
    console.error("  VERCEL_TOKEN=<token> npm run deploy:live");
    console.error("  https://vercel.com/account/tokens");
  }
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

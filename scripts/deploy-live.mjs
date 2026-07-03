#!/usr/bin/env node
/**
 * Production deploy via Vercel CLI.
 * Exits as soon as the deployment is Ready — the CLI can hang for minutes
 * afterward on "Build cache uploaded" even though the site is already live.
 *
 * Auth (pick one):
 *   vercel login
 *   VERCEL_TOKEN=... npm run deploy:live   (token from vercel.com/account/tokens)
 */
import { spawn } from "node:child_process";

const token = process.env.VERCEL_TOKEN?.trim();
const args = ["vercel@latest", "deploy", "--prod", "--yes"];
if (token) {
  args.push("--token", token);
}

const child = spawn("npx", ["--yes", ...args], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
  env: process.env,
});

let buffer = "";
let ready = false;
let exitTimer = null;
let aliasUrl = "";

function onData(chunk, stream) {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    stream.write(line + "\n");

    const aliasMatch = line.match(/Aliased\s+(https:\S+)/);
    if (aliasMatch) aliasUrl = aliasMatch[1];

    if (!ready && /✓ Ready|Ready in|readyState": "READY"|Deployment completed/i.test(line)) {
      ready = true;
      exitTimer = setTimeout(() => {
        console.log("");
        console.log("✓ Deployment is live. Exiting (skipping slow local cache upload).");
        if (aliasUrl) console.log(`  ${aliasUrl}`);
        child.kill("SIGTERM");
        setTimeout(() => process.exit(0), 500);
      }, 1500);
    }
  }
}

child.stdout.on("data", (chunk) => onData(chunk, process.stdout));
child.stderr.on("data", (chunk) => onData(chunk, process.stderr));

child.on("close", (code) => {
  if (exitTimer) clearTimeout(exitTimer);
  if (!ready && code !== 0 && !token) {
    console.error("");
    console.error("Vercel auth required. Run one of:");
    console.error("  npx vercel login");
    console.error("  VERCEL_TOKEN=<token> npm run deploy:live");
    console.error("  https://vercel.com/account/tokens");
  }
  process.exit(ready ? 0 : code ?? 1);
});

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

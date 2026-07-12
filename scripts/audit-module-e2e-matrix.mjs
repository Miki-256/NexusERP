#!/usr/bin/env node
/**
 * Tracks E2E coverage vs ERP app registry for go-live readiness.
 * Run: npm run audit:module-e2e
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const e2eDir = path.join(root, "e2e");

const registryPath = path.join(root, "apps/web/src/lib/apps-registry.ts");
const registry = readFileSync(registryPath, "utf8");

const apps = [...registry.matchAll(/href: "(\/[^"]+)"/g)]
  .map((m) => m[1])
  .filter((href) => href !== "/dashboard" && !href.includes("["));

const specFiles = readdirSync(e2eDir).filter((f) => f.endsWith(".spec.ts"));
const specBody = specFiles
  .map((f) => readFileSync(path.join(e2eDir, f), "utf8"))
  .join("\n");

const covered = [];
const missing = [];

for (const href of apps) {
  const slug = href.replace(/^\//, "").split("/")[0];
  const hit =
    specBody.includes(`path: "${href}"`) ||
    specBody.includes(`goto("${href}`) ||
    specBody.includes(`goto('${href}`) ||
    specBody.includes(`"${href}"`) ||
    (href === "/financials" && specBody.includes("/financials"));
  if (hit) covered.push(href);
  else missing.push(href);
}

const minCovered = Number(process.env.MODULE_E2E_MIN_COVERED ?? "10");

console.log("NexusERP module E2E coverage\n");
console.log(`Apps in registry (excl. dashboard): ${apps.length}`);
console.log(`E2E specs: ${specFiles.join(", ") || "(none)"}`);
console.log(`Covered routes: ${covered.length}`);
console.log(`Missing routes: ${missing.length}\n`);

if (covered.length > 0) {
  console.log("Covered:");
  for (const href of covered) console.log(`  ✅ ${href}`);
}

if (missing.length > 0) {
  console.log("\nMissing (add Playwright smoke per module):");
  for (const href of missing) console.log(`  ⚠️  ${href}`);
}

if (covered.length < minCovered) {
  console.error(
    `\nModule E2E audit failed — ${covered.length} covered, minimum ${minCovered} required.`
  );
  process.exit(1);
}

console.log(`\nModule E2E audit passed (minimum ${minCovered} modules covered).`);

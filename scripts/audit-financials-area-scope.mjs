#!/usr/bin/env node
/**
 * Ensures financials page keeps area-scoped data loading (prevents RPC monolith regression).
 * Run: npm run audit:financials-scope
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, "../apps/web/src/app/(tenant)/financials/page.tsx");
const loaderPath = path.join(__dirname, "../apps/web/src/lib/finance/financials-page-data.ts");
const pageText = readFileSync(pagePath, "utf8");
const loaderText = readFileSync(loaderPath, "utf8");
const issues = [];

const required = [
  "fetchFinancialsPageRawData",
  "skipScopedFetch",
];

for (const marker of required) {
  if (!pageText.includes(marker) && !loaderText.includes(marker)) {
    issues.push(`Missing required area-scope marker: ${marker}`);
  }
}

const rpcCalls = [...loaderText.matchAll(/supabase\.rpc\(/g)];
const skipWrapped = [...loaderText.matchAll(/skip\(\s*scope\./g)];

if (rpcCalls.length < 20) {
  issues.push(`Expected many scoped RPC calls in financials page, found ${rpcCalls.length}`);
}

if (skipWrapped.length < 15) {
  issues.push(
    `Expected at least 15 skip(scope.*) wrappers, found ${skipWrapped.length} — unscoped fetches may have regressed`
  );
}

if (issues.length > 0) {
  console.error("Financials area-scope audit failed:\n");
  for (const issue of issues) console.error(`  ${issue}`);
  process.exit(1);
}

console.log(
  `Financials area-scope audit passed (${rpcCalls.length} RPC calls, ${skipWrapped.length} scoped via skip()).`
);

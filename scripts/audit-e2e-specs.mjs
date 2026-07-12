#!/usr/bin/env node
/**
 * Ensures critical E2E smoke specs exist for production readiness.
 * Run: npm run audit:e2e
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eDir = path.join(__dirname, "../e2e");

const required = [
  "smoke.spec.ts",
  "financials-scroll.spec.ts",
  "module-smoke.spec.ts",
  "procure-to-pay.spec.ts",
  "invoice-create.spec.ts",
  "permissions.spec.ts",
  "auth.setup.ts",
  "helpers/auth.ts",
  "helpers/credentials.ts",
  "helpers/page-smoke.ts",
];

const missing = required.filter((file) => !existsSync(path.join(e2eDir, file)));

if (missing.length > 0) {
  console.error("E2E audit failed — missing specs:\n");
  for (const file of missing) console.error(`  e2e/${file}`);
  process.exit(1);
}

console.log(`E2E audit passed (${required.length} required specs present).`);

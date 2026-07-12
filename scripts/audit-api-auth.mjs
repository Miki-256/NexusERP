#!/usr/bin/env node
/**
 * Static audit of Next.js API route auth expectations.
 * Run: npm run audit:api-auth
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.join(__dirname, "../apps/web/src/app/api");

/** route path segment → required auth pattern */
const EXPECTATIONS = [
  { prefix: "/api/notifications/process", allOf: ["verifyInternalSecret"] },
  { prefix: "/api/webhooks/process-queue", allOf: ["verifyInternalSecret"] },
  { prefix: "/api/webhooks/process-security-alerts", allOf: ["verifyInternalSecret"] },
  { prefix: "/api/webhooks/mobile-money", allOf: ["verifyInternalSecret"] },
  { prefix: "/api/health", allOf: ["verifyInternalSecret"] },
  { prefix: "/api/financials/ai/chat", allOf: ["getMemberPermissions", "accounting"] },
  { prefix: "/api/v1/catalog", allOf: ["rateLimitDistributed", "get_org_catalog_export"] },
  { prefix: "/api/dev/", allOf: ['NODE_ENV === "production"'] },
  { prefix: "/api/admin/", anyOf: ["requireSuperAdmin", "admin_my_role", "is_admin"] },
];

function collectRouteFiles(dir, base = "") {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = `${base}/${entry}`.replace(/\\/g, "/");
    if (statSync(full).isDirectory()) {
      out.push(...collectRouteFiles(full, rel));
    } else if (entry === "route.ts") {
      out.push({ file: full, route: `/api${base}` });
    }
  }
  return out;
}

const routes = collectRouteFiles(apiRoot);
const issues = [];

for (const { file, route } of routes) {
  const text = readFileSync(file, "utf8");
  const rel = path.relative(path.join(__dirname, ".."), file);

  for (const rule of EXPECTATIONS) {
    if (!route.startsWith(rule.prefix)) continue;

    if (rule.allOf) {
      const missing = rule.allOf.filter((needle) => !text.includes(needle));
      if (missing.length > 0) {
        issues.push(`${rel} (${route}): missing required auth markers: ${missing.join(", ")}`);
      }
    }

    if (rule.anyOf) {
      const matched = rule.anyOf.some((needle) => text.includes(needle));
      if (!matched) {
        issues.push(`${rel} (${route}): expected one of [${rule.anyOf.join(", ")}]`);
      }
    }
  }

  if (route.startsWith("/api/webhooks/") && route !== "/api/webhooks/whatsapp") {
    if (!text.includes("verifyInternalSecret") && !text.includes("verifyWhatsAppWebhookSignature")) {
      issues.push(`${rel} (${route}): webhook route missing verifyInternalSecret`);
    }
  }
}

if (issues.length > 0) {
  console.error("API auth audit failed:\n");
  for (const issue of issues) console.error(`  ${issue}`);
  process.exit(1);
}

console.log(`API auth audit passed (${routes.length} routes checked).`);

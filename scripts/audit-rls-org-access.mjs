#!/usr/bin/env node
/**
 * Fail when new migrations reintroduce user_organization_ids() in RLS policies.
 * Historical migrations before Phase C are grandfathered.
 *
 * Run: npm run audit:rls
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../supabase/migrations");
const MARKER = "00171_phase_c_rls_unification";

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let afterMarker = false;
const issues = [];

for (const file of files) {
  if (file.includes(MARKER)) {
    afterMarker = true;
    continue;
  }
  if (!afterMarker) continue;

  const text = readFileSync(path.join(migrationsDir, file), "utf8");
  if (!/CREATE\s+POLICY/i.test(text)) continue;
  if (!/user_organization_ids\s*\(\s*\)/i.test(text)) continue;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/user_organization_ids\s*\(\s*\)/i.test(lines[i])) {
      issues.push(`${file}:${i + 1}: uses user_organization_ids() in RLS — prefer user_has_org_access(organization_id)`);
    }
  }
}

if (issues.length > 0) {
  console.error("RLS org-access audit failed:\n");
  for (const issue of issues) console.error(`  ${issue}`);
  process.exit(1);
}

console.log("RLS org-access audit passed (no new user_organization_ids() policies after Phase C).");

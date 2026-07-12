#!/usr/bin/env node
/**
 * Find STABLE/VOLATILE mismatches: STABLE functions that perform writes.
 * Run: npm run audit:stable-rpcs
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../supabase/migrations");

const WRITE_PATTERNS = [
  { label: "INSERT", re: /\bINSERT\s+INTO\b/i },
  { label: "UPDATE", re: /\bUPDATE\s+/i },
  { label: "DELETE", re: /\bDELETE\s+FROM\b/i },
  { label: "PERFORM ensure_*", re: /PERFORM\s+public\.ensure_/i },
];

const latest = new Map();

for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
  const text = readFileSync(path.join(migrationsDir, file), "utf8");
  const chunks = text.split(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/);
  for (let i = 1; i < chunks.length; i += 2) {
    const name = chunks[i];
    const rest = chunks[i + 1] ?? "";
    const headerEnd = rest.indexOf("AS $$");
    if (headerEnd < 0) continue;
    const header = rest.slice(0, headerEnd);
    const bodyEnd = rest.indexOf("$$;", headerEnd);
    const body = bodyEnd > headerEnd ? rest.slice(headerEnd + 5, bodyEnd) : "";
    latest.set(name, { file, header, body });
  }

  for (const match of text.matchAll(/ALTER FUNCTION public\.(\w+)\([^)]*\)\s+VOLATILE/gi)) {
    const name = match[1];
    const entry = latest.get(name);
    if (!entry) continue;
    latest.set(name, {
      ...entry,
      file,
      header: entry.header.replace(/\bSTABLE\b/i, "VOLATILE"),
    });
  }
}

const issues = [];

for (const [name, { file, header, body }] of latest) {
  if (!/\bSTABLE\b/.test(header)) continue;
  const hits = WRITE_PATTERNS.filter((p) => p.re.test(body)).map((p) => p.label);
  if (hits.length) issues.push({ file, name, hits });
}

console.log("STABLE functions that perform writes:\n");
for (const { file, name, hits } of issues) {
  console.log(`  ${file}: ${name} → ${hits.join(", ")}`);
}
console.log(`\nTotal: ${issues.length}`);
if (issues.length > 0) process.exit(1);

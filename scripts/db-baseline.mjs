#!/usr/bin/env node
/**
 * Phase 1 DB baseline — table sizes, connections, index health.
 * Requires linked Supabase project: npx supabase link --project-ref <ref>
 *
 * Usage: npm run db:baseline
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, ".support");
const STAMP = new Date().toISOString().slice(0, 10);

function runQuery(sql) {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  const out = execSync(`npx supabase@latest db query --linked ${JSON.stringify(oneLine)}`, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const match = out.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function section(title, payload) {
  return `## ${title}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
}

console.log("Collecting database baseline (linked project)…\n");

const tables = runQuery(`
  SELECT relname AS table_name,
         n_live_tup AS est_rows,
         pg_size_pretty(pg_total_relation_size(relid)) AS total_size
  FROM pg_stat_user_tables
  WHERE schemaname = 'public'
  ORDER BY n_live_tup DESC
  LIMIT 30;
`);

const connections = runQuery(`
  SELECT count(*) AS total,
         count(*) FILTER (WHERE state = 'active') AS active,
         count(*) FILTER (WHERE state = 'idle') AS idle,
         count(*) FILTER (WHERE wait_event_type IS NOT NULL) AS waiting
  FROM pg_stat_activity
  WHERE datname = current_database();
`);

const dbSize = runQuery(`
  SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
`);

const unusedIndexes = runQuery(`
  SELECT schemaname, relname AS table_name, indexrelname AS index_name,
         idx_scan AS times_used
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public' AND idx_scan = 0
  ORDER BY pg_relation_size(indexrelid) DESC
  LIMIT 15;
`);

const salesIndexes = runQuery(`
  SELECT indexrelname AS index_name, idx_scan AS times_used
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public' AND relname = 'sales'
  ORDER BY idx_scan DESC;
`);

let advisors = null;
try {
  advisors = JSON.parse(
    execSync("npx supabase@latest db advisors --linked --type all --level info -o json", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    })
  );
} catch (err) {
  advisors = { error: "advisors failed — ensure supabase CLI is linked", detail: String(err.message ?? err) };
}

const summary = {
  captured_at: new Date().toISOString(),
  database_size: dbSize?.rows?.[0] ?? null,
  connections: connections?.rows?.[0] ?? null,
  top_tables: tables?.rows ?? [],
  sales_index_usage: salesIndexes?.rows ?? [],
  unused_indexes: unusedIndexes?.rows ?? [],
  advisor_count: Array.isArray(advisors) ? advisors.length : null,
  advisor_errors: Array.isArray(advisors)
    ? advisors.filter((a) => a.level === "ERROR").length
    : null,
  advisor_warnings: Array.isArray(advisors)
    ? advisors.filter((a) => a.level === "WARN").length
    : null,
};

mkdirSync(OUT_DIR, { recursive: true });
const reportPath = path.join(OUT_DIR, `db-baseline-${STAMP}.md`);
const jsonPath = path.join(OUT_DIR, `db-baseline-${STAMP}.json`);

let md = `# Database Baseline — ${STAMP}\n\n`;
md += section("Summary", summary);
md += section("Top tables by row estimate", tables?.rows ?? []);
md += section("Connections", connections?.rows ?? []);
md += section("Sales index usage", salesIndexes?.rows ?? []);
md += section("Unused indexes (candidates to review)", unusedIndexes?.rows ?? []);
if (Array.isArray(advisors)) {
  md += section(
    "Advisor findings (errors + warnings only)",
    advisors.filter((a) => a.level === "ERROR" || a.level === "WARN").slice(0, 25)
  );
}

writeFileSync(reportPath, md);
writeFileSync(jsonPath, JSON.stringify({ summary, advisors }, null, 2));

console.log("Baseline captured:");
console.log(`  ${reportPath}`);
console.log(`  ${jsonPath}`);
console.log("\nSummary:");
console.log(`  Database size: ${summary.database_size?.database_size ?? "n/a"}`);
console.log(`  Connections: ${JSON.stringify(summary.connections)}`);
console.log(`  Largest table: ${summary.top_tables[0]?.table_name ?? "n/a"} (${summary.top_tables[0]?.est_rows ?? 0} rows est.)`);
if (summary.advisor_errors != null) {
  console.log(`  Advisors: ${summary.advisor_errors} error(s), ${summary.advisor_warnings} warning(s)`);
}

#!/usr/bin/env node
/**
 * Apply notification-center migrations (00091–00098) to the linked Supabase project.
 * Requires: npx supabase login && npx supabase link --project-ref vshtfxebkqmwhgrczqbb
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FILES = [
  "supabase/migrations/20260618000092_user_can_manage_communications.sql",
  "supabase/migrations/20260618000091_communications_queue_rules_fix.sql",
  "supabase/migrations/20260618000093_notification_whatsapp_sprint4.sql",
  "supabase/migrations/20260618000094_ensure_whatsapp_default_rules.sql",
  "supabase/migrations/20260618000095_notification_schedules_sprint5.sql",
  "supabase/migrations/20260618000096_notification_center_sprint6.sql",
  "supabase/migrations/20260618000097_notification_module_rollout_sprint7.sql",
  "supabase/migrations/20260618000098_notification_hardening_sprint8.sql",
];

for (const rel of FILES) {
  const file = resolve(ROOT, rel);
  console.log(`Applying ${rel}…`);
  const result = spawnSync("npx", ["--yes", "supabase@latest", "db", "query", "--linked", "-f", file], {
    cwd: ROOT,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`Failed: ${rel}`);
    process.exit(result.status ?? 1);
  }
}

console.log("All notification migrations applied.");

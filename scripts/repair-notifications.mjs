#!/usr/bin/env node
/** Repair corrupted Telegram templates + flush pending notifications. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../apps/web/.env.local");

function loadEnv(path) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv(envPath);

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TEMPLATES = [
  {
    code: "pos.sale_completed.manager",
    channel: "telegram",
    subject: "Sale {{receipt_no}}",
    body: "Sale {{receipt_no}} completed for {{total}}.\nCustomer: {{customer_name}}\nStore: {{store_name}}",
  },
  {
    code: "inventory.low_stock.manager",
    channel: "telegram",
    subject: "Low stock: {{product_name}}",
    body: "{{product_name}} ({{variant_name}}) at {{store_name}} is low: {{quantity}} left (reorder at {{reorder_point}}).",
  },
  {
    code: "reports.daily_sales",
    channel: "telegram",
    subject: "Daily sales — {{report_date}}",
    body: "{{org_name}} — {{report_date}}\n\nTransactions: {{transaction_count}}\nTotal sales: {{sales_total}}\n\nCash: {{cash_total}}\nMobile: {{mobile_total}}\nBank: {{bank_total}}",
  },
];

async function repairTemplates() {
  const { data: repairRpc } = await admin.rpc("repair_notification_system_templates");
  if (repairRpc && typeof repairRpc === "object") {
    console.log("repair_notification_system_templates:", repairRpc);
    return;
  }

  console.log("RPC repair not available — applying direct template updates");
  for (const t of TEMPLATES) {
    const { error } = await admin
      .from("notification_templates")
      .update({
        subject_template: t.subject,
        body_template: t.body,
        updated_at: new Date().toISOString(),
      })
      .is("organization_id", null)
      .eq("code", t.code)
      .eq("channel", t.channel);
    if (error) console.error(t.code, error.message);
    else console.log(t.code, "ok");
  }
}

await repairTemplates();

const flush = spawnSync("node", [resolve(__dirname, "flush-notifications.mjs")], {
  stdio: "inherit",
  cwd: resolve(__dirname, ".."),
});
process.exit(flush.status ?? 1);

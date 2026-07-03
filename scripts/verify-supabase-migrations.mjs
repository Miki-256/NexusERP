#!/usr/bin/env node
/**
 * Verify critical Supabase RPCs exist and respond.
 * Reads apps/web/.env.local — never prints secret values.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../apps/web/.env.local");
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* missing */
  }
  return out;
}

const env = loadEnv(envPath);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or publishable/anon key in apps/web/.env.local");
  process.exit(1);
}

/** RPC probes — bodies must match PostgREST overload resolution. */
const CHECKS = [
  { rpc: "get_my_workspace", migration: "00020+", body: {} },
  { rpc: "get_my_pending_organizations", migration: "00023", body: {} },
  { rpc: "get_platform_maintenance_status", migration: "00027", body: {} },
  { rpc: "admin_my_role", migration: "00025", body: {} },
  { rpc: "admin_get_security_dashboard", migration: "00028", body: {} },
  { rpc: "get_platform_feature_flags", migration: "00029", body: {} },
  {
    rpc: "get_org_enabled_app_ids",
    migration: "00029",
    body: { p_org_id: ZERO_UUID },
  },
  { rpc: "admin_get_platform_health", migration: "00029", body: {} },
  { rpc: "get_my_org_plan_usage", migration: "00031", body: {} },
  { rpc: "list_public_plans", migration: "00031", body: {} },
  {
    rpc: "request_plan_change",
    migration: "00033",
    body: {
      p_organization_id: ZERO_UUID,
      p_requested_plan: "free",
      p_note: "rpc-probe",
    },
  },
  {
    rpc: "list_low_stock_items",
    migration: "00034",
    body: { p_organization_id: ZERO_UUID },
  },
  { rpc: "list_org_audit_logs", migration: "00037", body: { p_organization_id: ZERO_UUID } },
  { rpc: "list_promotions", migration: "00036", body: { p_organization_id: ZERO_UUID } },
  {
    rpc: "void_sale_backoffice",
    migration: "00044",
    body: { p_sale_id: ZERO_UUID, p_reason: "probe" },
  },
  {
    rpc: "list_sales_register",
    migration: "00043",
    body: {
      p_organization_id: ZERO_UUID,
      p_from: "2020-01-01T00:00:00Z",
      p_to: "2030-01-01T00:00:00Z",
      p_limit: 1,
      p_offset: 0,
    },
  },
  {
    rpc: "find_product_by_barcode",
    migration: "00050",
    body: { p_org_id: ZERO_UUID, p_barcode: "probe" },
  },
  {
    rpc: "bulk_receive_products",
    migration: "00050",
    body: { p_org_id: ZERO_UUID, p_store_id: ZERO_UUID, p_rows: [] },
  },
  {
    rpc: "financials_chart_data",
    migration: "00055",
    body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31" },
  },
  {
    rpc: "list_products_page",
    migration: "00055",
    body: { p_org_id: ZERO_UUID, p_limit: 10, p_offset: 0 },
  },
  {
    rpc: "dashboard_bundle",
    migration: "00055",
    body: { p_org_id: ZERO_UUID, p_include_accounting: true, p_include_expenses: true },
  },
  {
    rpc: "deactivate_product_catalog_item",
    migration: "00056",
    body: { p_product_id: ZERO_UUID },
  },
  {
    rpc: "count_unposted_sales",
    migration: "00059",
    body: { p_org_id: ZERO_UUID },
  },
  {
    rpc: "post_unposted_sales_batch",
    migration: "00065",
    body: { p_org_id: ZERO_UUID, p_limit: 1 },
  },
  { rpc: "get_pos_bootstrap", migration: "00066", body: { p_register_id: ZERO_UUID } },
  {
    rpc: "process_sale_ledger_post_queue",
    migration: "00066",
    body: { p_limit: 1 },
  },
  { rpc: "get_platform_health_probe", migration: "00067", body: {} },
  { rpc: "admin_get_platform_health", migration: "00068", body: {} },
  {
    rpc: "list_customers_page",
    migration: "00070",
    body: { p_org_id: ZERO_UUID, p_limit: 1, p_offset: 0 },
  },
  {
    rpc: "profit_and_loss",
    migration: "00059",
    body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31", p_mode: "gl" },
  },
  { rpc: "list_accounts", migration: "00060", body: { p_org_id: ZERO_UUID } },
  {
    rpc: "list_journal_entries_page",
    migration: "00060",
    body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31", p_limit: 5, p_offset: 0 },
  },
  {
    rpc: "accounts_receivable_aging",
    migration: "00060",
    body: { p_org_id: ZERO_UUID, p_as_of: "2026-01-31" },
  },
  {
    rpc: "accounts_payable_aging",
    migration: "00060",
    body: { p_org_id: ZERO_UUID, p_as_of: "2026-01-31" },
  },
  { rpc: "list_fiscal_periods", migration: "00061", body: { p_org_id: ZERO_UUID } },
  {
    rpc: "ensure_fiscal_year",
    migration: "00061",
    body: { p_org_id: ZERO_UUID, p_year: 2026 },
  },
  { rpc: "list_journal_entry_drafts", migration: "00061", body: { p_org_id: ZERO_UUID } },
  {
    rpc: "approve_journal_entry",
    migration: "00061",
    body: { p_entry_id: ZERO_UUID },
  },
  {
    rpc: "close_fiscal_period",
    migration: "00061",
    body: { p_period_id: ZERO_UUID },
  },
  { rpc: "list_bank_accounts", migration: "00062", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_tax_codes", migration: "00062", body: { p_org_id: ZERO_UUID } },
  {
    rpc: "tax_summary_report",
    migration: "00062",
    body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31" },
  },
  {
    rpc: "get_bank_reconciliation",
    migration: "00062",
    body: { p_bank_account_id: ZERO_UUID },
  },
  {
    rpc: "import_bank_statement",
    migration: "00062",
    body: {
      p_bank_account_id: ZERO_UUID,
      p_statement_date: "2026-01-31",
      p_opening_balance: 0,
      p_closing_balance: 0,
      p_lines: [],
    },
  },
  { rpc: "list_departments", migration: "00063", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_budgets", migration: "00063", body: { p_org_id: ZERO_UUID } },
  {
    rpc: "analytic_ledger_summary",
    migration: "00063",
    body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31", p_dimension: "store" },
  },
  {
    rpc: "comparative_profit_and_loss",
    migration: "00063",
    body: {
      p_org_id: ZERO_UUID,
      p_from: "2026-01-01",
      p_to: "2026-01-31",
      p_prior_from: "2025-12-01",
      p_prior_to: "2025-12-31",
      p_mode: "operational",
    },
  },
  {
    rpc: "comparative_balance_sheet",
    migration: "00063",
    body: { p_org_id: ZERO_UUID, p_as_of: "2026-01-31", p_prior_as_of: "2025-12-31" },
  },
  {
    rpc: "budget_vs_actual",
    migration: "00063",
    body: { p_budget_id: ZERO_UUID },
  },
  { rpc: "list_fixed_assets", migration: "00064", body: { p_org_id: ZERO_UUID } },
  {
    rpc: "register_fixed_asset",
    migration: "00064",
    body: {
      p_org_id: ZERO_UUID,
      p_name: "probe",
      p_acquisition_date: "2026-01-01",
      p_cost: 1,
    },
  },
  { rpc: "list_consolidation_groups", migration: "00064", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_my_organizations", migration: "00064", body: {} },
  {
    rpc: "consolidated_profit_and_loss",
    migration: "00064",
    body: {
      p_group_id: ZERO_UUID,
      p_from: "2026-01-01",
      p_to: "2026-01-31",
      p_mode: "operational",
    },
  },
  { rpc: "list_recurring_journal_templates", migration: "00064", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_invoices_needing_reminder", migration: "00064", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_financial_report_snapshots", migration: "00064", body: { p_org_id: ZERO_UUID } },
  {
    rpc: "run_recurring_journals",
    migration: "00064",
    body: { p_org_id: ZERO_UUID },
  },
];

/** RPC → migration file for remediation hints */
const RPC_MIGRATION_FILE = {
  request_plan_change: "20260618000033_subscription_phase2.sql",
  list_sales_register: "20260618000043_sales_register_advanced.sql",
  find_product_by_barcode: "20260618000050_product_bulk_barcode.sql",
  bulk_receive_products: "20260618000050_product_bulk_barcode.sql",
  list_low_stock_items: "20260618000034_inventory_advanced.sql",
  list_promotions: "20260618000036_promotions.sql",
  list_org_audit_logs: "20260618000037_audit_webhooks_catalog.sql",
  void_sale_backoffice: "20260618000044_phase_a_security.sql",
};

async function probeRpc(rpc, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let bodyJson;
  try {
    bodyJson = JSON.parse(text);
  } catch {
    bodyJson = text.slice(0, 200);
  }
  return { status: res.status, body: bodyJson };
}

function isMissing(status, body) {
  const msg =
    typeof body === "object" && body !== null
      ? body.message ?? body.hint ?? JSON.stringify(body)
      : String(body);
  return (
    status === 404 ||
    (typeof msg === "string" && msg.includes("Could not find the function"))
  );
}

function isExists(status, body) {
  const msg =
    typeof body === "object" && body !== null
      ? body.message ?? body.hint ?? ""
      : String(body);
  if (status < 400) return true;
  if (status === 401 || (typeof msg === "string" && msg.includes("JWT"))) return true;
  if (
    typeof msg === "string" &&
    (msg.includes("Access denied") ||
      msg.includes("permission denied") ||
      msg.includes("Not authenticated"))
  ) {
    return true;
  }
  return status >= 400 && !isMissing(status, body);
}

console.log(`Project: ${url.replace("https://", "").split(".")[0]}\n`);
console.log("RPC probe (anon key — existence + grant check):\n");

const missing = [];

for (const { rpc, migration, body } of CHECKS) {
  const { status, body: resBody } = await probeRpc(rpc, body);
  const msg =
    typeof resBody === "object" && resBody !== null
      ? resBody.message ?? resBody.hint ?? JSON.stringify(resBody)
      : String(resBody);

  if (isMissing(status, resBody)) {
    console.log(`❌ ${rpc} — MISSING (need migration ${migration})`);
    missing.push({ rpc, migration });
  } else if (isExists(status, resBody)) {
    const note =
      status >= 400 && typeof msg === "string" && msg.length > 0
        ? `, responded: ${msg.slice(0, 60)}`
        : "";
    console.log(`✅ ${rpc} — OK (${migration})${note}`);
  } else {
    console.log(`⚠️  ${rpc} — unexpected ${status} (${migration}): ${String(msg).slice(0, 80)}`);
  }
}

console.log("");
if (missing.length === 0) {
  console.log("All critical RPCs are present on the remote database.");
  process.exit(0);
}

console.log(`Missing ${missing.length} RPC(s). Apply in Supabase SQL Editor:`);
const files = new Set();
for (const { rpc } of missing) {
  const file = RPC_MIGRATION_FILE[rpc];
  if (file) files.add(file);
}
for (const f of files) {
  console.log(`  - supabase/migrations/${f}`);
}
console.log("\nOr: npx supabase db query --linked -f supabase/migrations/<file>");
process.exit(2);

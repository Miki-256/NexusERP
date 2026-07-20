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
  { rpc: "list_warehouses", migration: "00121", body: { p_org_id: ZERO_UUID } },
  {
    rpc: "list_stock_movements",
    migration: "00119",
    body: { p_org_id: ZERO_UUID, p_limit: 1, p_offset: 0 },
  },
  {
    rpc: "list_customer_invoices_page",
    migration: "00129",
    body: { p_org_id: ZERO_UUID, p_limit: 1, p_offset: 0 },
  },
  {
    rpc: "list_vendor_bills_page",
    migration: "00129",
    body: { p_org_id: ZERO_UUID, p_limit: 1, p_offset: 0 },
  },
  { rpc: "list_accounts", migration: "00060", body: { p_org_id: ZERO_UUID } },
  {
    rpc: "trial_balance",
    migration: "00061",
    body: { p_org_id: ZERO_UUID, p_to: "2026-12-31" },
  },
  {
    rpc: "list_journal_entries_page",
    migration: "00060",
    body: {
      p_org_id: ZERO_UUID,
      p_from: "2026-01-01",
      p_to: "2026-12-31",
      p_limit: 1,
      p_offset: 0,
    },
  },
  { rpc: "list_accounts_tree", migration: "00131", body: { p_org_id: ZERO_UUID } },
  {
    rpc: "reverse_journal_entry",
    migration: "00131",
    body: { p_entry_id: ZERO_UUID },
  },
  {
    rpc: "import_opening_balances",
    migration: "00131",
    body: {
      p_org_id: ZERO_UUID,
      p_date: "2026-01-01",
      p_lines: [],
      p_memo: "probe",
    },
  },
  { rpc: "list_allocation_rules", migration: "00131", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_customer_statement", migration: "00134", body: { p_org_id: ZERO_UUID, p_customer_id: ZERO_UUID } },
  { rpc: "list_customer_open_invoices", migration: "00134", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_customers_ar_summary", migration: "00134", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_ar_dunning_policies", migration: "00134", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_ar_collections_queue", migration: "00134", body: { p_org_id: ZERO_UUID } },
  { rpc: "ensure_default_ar_dunning_policy", migration: "00134", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_vendor_open_bills", migration: "00137", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_vendors_ap_summary", migration: "00137", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_payment_runs", migration: "00137", body: { p_org_id: ZERO_UUID } },
  { rpc: "validate_vendor_bill_match", migration: "00137", body: { p_bill_id: ZERO_UUID } },
  { rpc: "get_period_close_status", migration: "00139", body: { p_period_id: ZERO_UUID } },
  { rpc: "run_period_close_preflight", migration: "00139", body: { p_period_id: ZERO_UUID } },
  { rpc: "ensure_default_close_checklist", migration: "00139", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_exchange_rates", migration: "00141", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_exchange_rate", migration: "00141", body: { p_org_id: ZERO_UUID, p_currency_code: "USD" } },
  { rpc: "list_fx_revaluation_runs", migration: "00141", body: { p_org_id: ZERO_UUID } },
  { rpc: "preview_fx_revaluation", migration: "00141", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_intercompany_relationships", migration: "00143", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_intercompany_transactions", migration: "00143", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_intercompany_matrix", migration: "00143", body: { p_group_id: ZERO_UUID } },
  { rpc: "preview_consolidation_eliminations", migration: "00143", body: { p_group_id: ZERO_UUID } },
  { rpc: "get_treasury_cash_position", migration: "00145", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_treasury_liquidity_forecast", migration: "00145", body: { p_org_id: ZERO_UUID, p_days: 30 } },
  { rpc: "list_treasury_transfers", migration: "00145", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_tax_compliance_settings", migration: "00147", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_vat_liability_report", migration: "00147", body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31" } },
  { rpc: "list_tax_return_periods", migration: "00147", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_einvoice_documents", migration: "00147", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_invoices_pending_einvoice", migration: "00147", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_withholding_tax_rules", migration: "00147", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_fpa_scenarios", migration: "00149", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_fpa_dashboard", migration: "00149", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_rolling_forecasts", migration: "00149", body: { p_org_id: ZERO_UUID } },
  { rpc: "compare_fpa_scenarios", migration: "00149", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_cost_centers", migration: "00151", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_projects_job_cost", migration: "00151", body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31" } },
  { rpc: "get_cost_center_summary", migration: "00151", body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31" } },
  { rpc: "list_fa_books", migration: "00153", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_fa_book_comparison", migration: "00153", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_executive_financial_dashboard", migration: "00155", body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31" } },
  { rpc: "list_executive_kpi_targets", migration: "00155", body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31" } },
  { rpc: "get_executive_kpi_drilldown", migration: "00155", body: { p_org_id: ZERO_UUID, p_kpi_key: "revenue", p_from: "2026-01-01", p_to: "2026-01-31" } },
  { rpc: "list_financial_automation_rules", migration: "00157", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_financial_scheduled_reports", migration: "00157", body: { p_org_id: ZERO_UUID } },
  { rpc: "evaluate_financial_automation_rules", migration: "00157", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_financial_security_settings", migration: "00159", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_sod_conflict_rules", migration: "00159", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_pending_financial_approvals", migration: "00159", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_financial_performance_settings", migration: "00161", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_financial_performance_dashboard", migration: "00161", body: { p_org_id: ZERO_UUID } },
  { rpc: "fetch_financial_report", migration: "00161", body: { p_org_id: ZERO_UUID, p_report_type: "trial_balance", p_to: "2026-01-31", p_as_of: "2026-01-31" } },
  { rpc: "list_financial_partition_policies", migration: "00161", body: { p_org_id: ZERO_UUID } },
  { rpc: "get_financial_ai_settings", migration: "00163", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_financial_ai_suggested_prompts", migration: "00163", body: { p_org_id: ZERO_UUID } },
  { rpc: "build_financial_ai_context", migration: "00163", body: { p_org_id: ZERO_UUID, p_from: "2026-01-01", p_to: "2026-01-31" } },
  { rpc: "resolve_financial_ai_question", migration: "00163", body: { p_org_id: ZERO_UUID, p_question: "revenue", p_from: "2026-01-01", p_to: "2026-01-31" } },
  { rpc: "list_financial_ai_insights", migration: "00163", body: { p_org_id: ZERO_UUID } },
  { rpc: "purge_financial_ai_history", migration: "00184", body: { p_org_id: ZERO_UUID, p_older_than_days: 90 } },
  { rpc: "get_financial_shell_preferences", migration: "00165", body: { p_org_id: ZERO_UUID } },
  { rpc: "list_financial_launchpad_tiles", migration: "00165", body: { p_org_id: ZERO_UUID } },
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
  list_warehouses: "20260618000121_scm_wave1_platform_rpcs.sql",
  list_stock_movements: "20260618000119_scm_wave0_movement_rpcs.sql",
  list_customer_invoices_page: "20260618000129_efm_wave0_hardening.sql",
  list_vendor_bills_page: "20260618000129_efm_wave0_hardening.sql",
  list_accounts: "20260618000060_phase_b_accountant_essentials.sql",
  list_accounts_tree: "20260618000131_efm_wave1_enterprise_gl_rpcs.sql",
  reverse_journal_entry: "20260618000131_efm_wave1_enterprise_gl_rpcs.sql",
  import_opening_balances: "20260618000131_efm_wave1_enterprise_gl_rpcs.sql",
  list_allocation_rules: "20260618000131_efm_wave1_enterprise_gl_rpcs.sql",
  get_customer_statement: "20260618000134_efm_wave2_enterprise_ar_rpcs.sql",
  list_customer_open_invoices: "20260618000134_efm_wave2_enterprise_ar_rpcs.sql",
  list_customers_ar_summary: "20260618000134_efm_wave2_enterprise_ar_rpcs.sql",
  list_ar_dunning_policies: "20260618000134_efm_wave2_enterprise_ar_rpcs.sql",
  list_ar_collections_queue: "20260618000134_efm_wave2_enterprise_ar_rpcs.sql",
  ensure_default_ar_dunning_policy: "20260618000134_efm_wave2_enterprise_ar_rpcs.sql",
  list_vendor_open_bills: "20260618000137_efm_wave3_enterprise_ap_rpcs.sql",
  list_vendors_ap_summary: "20260618000137_efm_wave3_enterprise_ap_rpcs.sql",
  list_payment_runs: "20260618000137_efm_wave3_enterprise_ap_rpcs.sql",
  validate_vendor_bill_match: "20260618000137_efm_wave3_enterprise_ap_rpcs.sql",
  get_period_close_status: "20260618000139_efm_wave4_close_management_rpcs.sql",
  run_period_close_preflight: "20260618000139_efm_wave4_close_management_rpcs.sql",
  start_period_close: "20260618000139_efm_wave4_close_management_rpcs.sql",
  ensure_default_close_checklist: "20260618000139_efm_wave4_close_management_rpcs.sql",
  lock_period_subledgers: "20260618000139_efm_wave4_close_management_rpcs.sql",
  list_exchange_rates: "20260618000141_efm_wave5_multi_currency_rpcs.sql",
  upsert_exchange_rate: "20260618000141_efm_wave5_multi_currency_rpcs.sql",
  get_exchange_rate: "20260618000141_efm_wave5_multi_currency_rpcs.sql",
  get_foreign_currency_balances: "20260618000141_efm_wave5_multi_currency_rpcs.sql",
  preview_fx_revaluation: "20260618000141_efm_wave5_multi_currency_rpcs.sql",
  run_fx_revaluation: "20260618000141_efm_wave5_multi_currency_rpcs.sql",
  list_fx_revaluation_runs: "20260618000141_efm_wave5_multi_currency_rpcs.sql",
  post_foreign_currency_journal: "20260618000141_efm_wave5_multi_currency_rpcs.sql",
  list_intercompany_relationships: "20260618000143_efm_wave6_consolidation_rpcs.sql",
  post_intercompany_invoice: "20260618000143_efm_wave6_consolidation_rpcs.sql",
  get_intercompany_matrix: "20260618000143_efm_wave6_consolidation_rpcs.sql",
  preview_consolidation_eliminations: "20260618000143_efm_wave6_consolidation_rpcs.sql",
  get_treasury_cash_position: "20260618000145_efm_wave7_treasury_rpcs.sql",
  get_treasury_liquidity_forecast: "20260618000145_efm_wave7_treasury_rpcs.sql",
  create_treasury_transfer: "20260618000145_efm_wave7_treasury_rpcs.sql",
  list_treasury_transfers: "20260618000145_efm_wave7_treasury_rpcs.sql",
  get_tax_compliance_settings: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  update_tax_compliance_settings: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  get_vat_liability_report: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  create_tax_return_period: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  list_tax_return_periods: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  file_tax_return: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  submit_einvoice: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  list_einvoice_documents: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  list_invoices_pending_einvoice: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  list_withholding_tax_rules: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  upsert_withholding_tax_rule: "20260618000147_efm_wave8_tax_compliance_rpcs.sql",
  ensure_default_fpa_scenarios: "20260618000149_efm_wave9_fpa_rpcs.sql",
  list_fpa_scenarios: "20260618000149_efm_wave9_fpa_rpcs.sql",
  upsert_fpa_scenario: "20260618000149_efm_wave9_fpa_rpcs.sql",
  generate_rolling_forecast: "20260618000149_efm_wave9_fpa_rpcs.sql",
  get_rolling_forecast: "20260618000149_efm_wave9_fpa_rpcs.sql",
  list_rolling_forecasts: "20260618000149_efm_wave9_fpa_rpcs.sql",
  compare_fpa_scenarios: "20260618000149_efm_wave9_fpa_rpcs.sql",
  get_fpa_dashboard: "20260618000149_efm_wave9_fpa_rpcs.sql",
  list_cost_centers: "20260618000151_efm_wave10_project_cost_rpcs.sql",
  upsert_cost_center: "20260618000151_efm_wave10_project_cost_rpcs.sql",
  upsert_project_financials: "20260618000151_efm_wave10_project_cost_rpcs.sql",
  set_project_cost_budget: "20260618000151_efm_wave10_project_cost_rpcs.sql",
  list_projects_job_cost: "20260618000151_efm_wave10_project_cost_rpcs.sql",
  get_project_job_cost: "20260618000151_efm_wave10_project_cost_rpcs.sql",
  get_cost_center_summary: "20260618000151_efm_wave10_project_cost_rpcs.sql",
  post_project_cost_allocation: "20260618000151_efm_wave10_project_cost_rpcs.sql",
  ensure_default_fa_books: "20260618000153_efm_wave11_fa_multibook_rpcs.sql",
  list_fa_books: "20260618000153_efm_wave11_fa_multibook_rpcs.sql",
  upsert_fa_book: "20260618000153_efm_wave11_fa_multibook_rpcs.sql",
  upsert_asset_book_profile: "20260618000153_efm_wave11_fa_multibook_rpcs.sql",
  get_fa_book_comparison: "20260618000153_efm_wave11_fa_multibook_rpcs.sql",
  get_fixed_asset_book_detail: "20260618000153_efm_wave11_fa_multibook_rpcs.sql",
  run_depreciation_batch: "20260618000153_efm_wave11_fa_multibook_rpcs.sql",
  ensure_default_executive_layout: "20260618000155_efm_wave12_executive_dashboard_rpcs.sql",
  get_executive_dashboard_layout: "20260618000155_efm_wave12_executive_dashboard_rpcs.sql",
  upsert_executive_kpi_target: "20260618000155_efm_wave12_executive_dashboard_rpcs.sql",
  list_executive_kpi_targets: "20260618000155_efm_wave12_executive_dashboard_rpcs.sql",
  get_executive_financial_dashboard: "20260618000155_efm_wave12_executive_dashboard_rpcs.sql",
  get_executive_kpi_drilldown: "20260618000155_efm_wave12_executive_dashboard_rpcs.sql",
  ensure_default_financial_automation_rules: "20260618000157_efm_wave13_financial_automation_rpcs.sql",
  list_financial_automation_rules: "20260618000157_efm_wave13_financial_automation_rpcs.sql",
  upsert_financial_automation_rule: "20260618000157_efm_wave13_financial_automation_rpcs.sql",
  delete_financial_automation_rule: "20260618000157_efm_wave13_financial_automation_rpcs.sql",
  evaluate_financial_automation_rules: "20260618000157_efm_wave13_financial_automation_rpcs.sql",
  list_financial_scheduled_reports: "20260618000157_efm_wave13_financial_automation_rpcs.sql",
  upsert_financial_scheduled_report: "20260618000157_efm_wave13_financial_automation_rpcs.sql",
  ensure_default_financial_scheduled_reports: "20260618000157_efm_wave13_financial_automation_rpcs.sql",
  get_financial_security_settings: "20260618000159_efm_wave14_financial_security_rpcs.sql",
  update_financial_security_settings: "20260618000159_efm_wave14_financial_security_rpcs.sql",
  ensure_default_sod_rules: "20260618000159_efm_wave14_financial_security_rpcs.sql",
  list_sod_conflict_rules: "20260618000159_efm_wave14_financial_security_rpcs.sql",
  upsert_sod_conflict_rule: "20260618000159_efm_wave14_financial_security_rpcs.sql",
  list_pending_financial_approvals: "20260618000159_efm_wave14_financial_security_rpcs.sql",
  get_financial_performance_settings: "20260618000161_efm_wave15_performance_rpcs.sql",
  update_financial_performance_settings: "20260618000161_efm_wave15_performance_rpcs.sql",
  ensure_default_financial_partition_policies: "20260618000161_efm_wave15_performance_rpcs.sql",
  list_financial_partition_policies: "20260618000161_efm_wave15_performance_rpcs.sql",
  upsert_financial_partition_policy: "20260618000161_efm_wave15_performance_rpcs.sql",
  fetch_financial_report: "20260618000161_efm_wave15_performance_rpcs.sql",
  invalidate_financial_report_cache: "20260618000161_efm_wave15_performance_rpcs.sql",
  warm_financial_report_cache: "20260618000161_efm_wave15_performance_rpcs.sql",
  archive_old_journal_entries: "20260618000161_efm_wave15_performance_rpcs.sql",
  run_financial_partition_maintenance: "20260618000161_efm_wave15_performance_rpcs.sql",
  get_financial_performance_dashboard: "20260618000161_efm_wave15_performance_rpcs.sql",
  get_financial_ai_settings: "20260618000184_efm_ai_assistant_l4.sql",
  update_financial_ai_settings: "20260618000184_efm_ai_assistant_l4.sql",
  purge_financial_ai_history: "20260618000184_efm_ai_assistant_l4.sql",
  list_financial_ai_suggested_prompts: "20260618000163_efm_wave16_ai_assistant_rpcs.sql",
  build_financial_ai_context: "20260618000163_efm_wave16_ai_assistant_rpcs.sql",
  resolve_financial_ai_question: "20260618000163_efm_wave16_ai_assistant_rpcs.sql",
  generate_financial_ai_insights: "20260618000163_efm_wave16_ai_assistant_rpcs.sql",
  list_financial_ai_insights: "20260618000163_efm_wave16_ai_assistant_rpcs.sql",
  list_financial_ai_conversations: "20260618000163_efm_wave16_ai_assistant_rpcs.sql",
  create_financial_ai_conversation: "20260618000163_efm_wave16_ai_assistant_rpcs.sql",
  get_financial_ai_conversation: "20260618000163_efm_wave16_ai_assistant_rpcs.sql",
  append_financial_ai_message: "20260618000163_efm_wave16_ai_assistant_rpcs.sql",
  delete_financial_ai_conversation: "20260618000163_efm_wave16_ai_assistant_rpcs.sql",
  get_financial_shell_preferences: "20260618000165_efm_wave17_financial_shell_rpcs.sql",
  update_financial_shell_preferences: "20260618000165_efm_wave17_financial_shell_rpcs.sql",
  list_financial_launchpad_tiles: "20260618000165_efm_wave17_financial_shell_rpcs.sql",
  trial_balance: "20260618000061_phase_c_control_compliance.sql",
  list_journal_entries_page: "20260618000060_phase_b_accountant_essentials.sql",
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
    status === 405 ||
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

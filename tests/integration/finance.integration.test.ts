import { describe, expect, it } from "vitest";
import { hasIntegrationCredentials, rpc, signIn } from "./supabase-client";

const run = hasIntegrationCredentials() ? describe : describe.skip;

const today = new Date().toISOString().slice(0, 10);
const yearStart = `${today.slice(0, 4)}-01-01`;

run("Finance integration — GL probes", () => {
  it("list_accounts returns COA for the workspace org", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization?.id;
    expect(orgId).toBeTruthy();

    const accounts = await rpc<
      Array<{ code: string; name: string; is_postable?: boolean; sort_order?: number }>
    >(token, "list_accounts", {
      p_org_id: orgId,
    });
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.some((a) => a.code === "1000")).toBe(true);
    const cash = accounts.find((a) => a.code === "1000");
    expect(cash?.is_postable).not.toBe(false);
  });

  it("list_accounts_tree returns flat tree rows with depth", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const tree = await rpc<Array<{ code: string; depth: number }>>(token, "list_accounts_tree", {
      p_org_id: orgId,
    });
    expect(Array.isArray(tree)).toBe(true);
    expect(tree.length).toBeGreaterThan(0);
    expect(typeof tree[0]?.depth).toBe("number");
  });

  it("trial_balance returns balanced rows for YTD", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const lines = await rpc<
      { debit: number; credit: number; account_code: string }[]
    >(token, "trial_balance", {
      p_org_id: orgId,
      p_to: today,
    });

    expect(Array.isArray(lines)).toBe(true);
    const totalDebit = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.02);
  });

  it("list_journal_entries_page returns paginated ledger rows", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const page = await rpc<{ total: number; entries: unknown[] }>(token, "list_journal_entries_page", {
      p_org_id: orgId,
      p_from: yearStart,
      p_to: today,
      p_limit: 10,
      p_offset: 0,
    });

    expect(typeof page.total).toBe("number");
    expect(Array.isArray(page.entries)).toBe(true);
  });
});

run("Finance integration — subledger list RPCs", () => {
  it("list_customer_invoices_page returns invoices envelope", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const page = await rpc<{ total: number; invoices: unknown[] }>(token, "list_customer_invoices_page", {
      p_org_id: orgId,
      p_limit: 20,
      p_offset: 0,
    });

    expect(typeof page.total).toBe("number");
    expect(Array.isArray(page.invoices)).toBe(true);
  });

  it("list_vendor_bills_page returns bills envelope", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const page = await rpc<{ total: number; bills: unknown[] }>(token, "list_vendor_bills_page", {
      p_org_id: orgId,
      p_limit: 20,
      p_offset: 0,
    });

    expect(typeof page.total).toBe("number");
    expect(Array.isArray(page.bills)).toBe(true);
  });

  it("accounts_receivable_aging returns bucket totals", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const aging = await rpc<{
      total: number;
      buckets: { current: number; days_1_30: number };
      rows: unknown[];
    }>(token, "accounts_receivable_aging", {
      p_org_id: orgId,
      p_as_of: today,
    });

    expect(typeof aging.total).toBe("number");
    expect(aging.buckets).toBeTruthy();
    expect(Array.isArray(aging.rows)).toBe(true);
  });

  it("accounts_payable_aging returns bucket totals", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const aging = await rpc<{
      total: number;
      buckets: { current: number };
      rows: unknown[];
    }>(token, "accounts_payable_aging", {
      p_org_id: orgId,
      p_as_of: today,
    });

    expect(typeof aging.total).toBe("number");
    expect(Array.isArray(aging.rows)).toBe(true);
  });
});

run("Finance integration — enterprise AR (Wave 2)", () => {
  it("list_customer_open_invoices returns open balance envelope", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const page = await rpc<{ total: number; invoices: unknown[] }>(token, "list_customer_open_invoices", {
      p_org_id: orgId,
      p_limit: 10,
      p_offset: 0,
    });

    expect(typeof page.total).toBe("number");
    expect(Array.isArray(page.invoices)).toBe(true);
  });

  it("list_customers_ar_summary returns customer exposure rows", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_customers_ar_summary", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("list_ar_dunning_policies seeds default policy", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const policies = await rpc<Array<{ name: string; levels: unknown[] }>>(token, "list_ar_dunning_policies", {
      p_org_id: orgId,
    });
    expect(Array.isArray(policies)).toBe(true);
    expect(policies.length).toBeGreaterThan(0);
    expect(Array.isArray(policies[0]?.levels)).toBe(true);
  });
});

run("Finance integration — enterprise AP (Wave 3)", () => {
  it("list_vendor_open_bills returns open balance envelope", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const page = await rpc<{ total: number; bills: unknown[] }>(token, "list_vendor_open_bills", {
      p_org_id: orgId,
      p_limit: 10,
      p_offset: 0,
    });

    expect(typeof page.total).toBe("number");
    expect(Array.isArray(page.bills)).toBe(true);
  });

  it("list_vendors_ap_summary returns vendor exposure rows", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_vendors_ap_summary", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("list_payment_runs returns payment run array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const runs = await rpc<unknown[]>(token, "list_payment_runs", { p_org_id: orgId });
    expect(Array.isArray(runs)).toBe(true);
  });
});

run("Finance integration — fiscal periods", () => {
  it("list_fiscal_periods returns year and periods array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{
      year: number;
      periods: { period_no: number; status: string }[];
    }>(token, "list_fiscal_periods", {
      p_org_id: orgId,
    });

    expect(typeof data.year).toBe("number");
    expect(Array.isArray(data.periods)).toBe(true);
  });

  it("ensure_default_close_checklist seeds checklist templates", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const inserted = await rpc<number>(token, "ensure_default_close_checklist", { p_org_id: orgId });
    expect(typeof inserted).toBe("number");
  });

  it("get_period_close_status returns period close shape", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const fiscal = await rpc<{ periods: { id: string }[] }>(token, "list_fiscal_periods", {
      p_org_id: orgId,
    });
    const periodId = fiscal.periods?.[0]?.id;
    if (!periodId) return;

    const status = await rpc<{
      period_id: string;
      tasks: unknown[];
      blockers: unknown[];
    }>(token, "get_period_close_status", { p_period_id: periodId });

    expect(status.period_id).toBe(periodId);
    expect(Array.isArray(status.tasks)).toBe(true);
    expect(Array.isArray(status.blockers)).toBe(true);
  });
});

run("Finance integration — multi-currency", () => {
  it("list_exchange_rates returns functional currency and rates array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ functional_currency?: string; rates?: unknown[] }>(token, "list_exchange_rates", {
      p_org_id: orgId,
    });

    expect(typeof data.functional_currency).toBe("string");
    expect(Array.isArray(data.rates)).toBe(true);
  });

  it("list_fx_revaluation_runs returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const runs = await rpc<unknown[]>(token, "list_fx_revaluation_runs", { p_org_id: orgId });
    expect(Array.isArray(runs)).toBe(true);
  });

  it("preview_fx_revaluation returns accounts array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const preview = await rpc<{ accounts?: unknown[] }>(token, "preview_fx_revaluation", { p_org_id: orgId });
    expect(Array.isArray(preview.accounts)).toBe(true);
  });
});

run("Finance integration — consolidation", () => {
  it("list_intercompany_relationships returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_intercompany_relationships", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("list_intercompany_transactions returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_intercompany_transactions", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("list_consolidation_groups includes reporting currency", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const groups = await rpc<{ reporting_currency?: string; members?: unknown[] }[]>(
      token,
      "list_consolidation_groups",
      { p_org_id: orgId }
    );
    expect(Array.isArray(groups)).toBe(true);
  });
});

run("Finance integration — treasury", () => {
  it("get_treasury_cash_position returns liquid totals", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{
      total_liquid?: number;
      currency?: string;
      bank_accounts?: unknown[];
    }>(token, "get_treasury_cash_position", { p_org_id: orgId });

    expect(typeof data.currency).toBe("string");
    expect(typeof data.total_liquid).toBe("number");
    expect(Array.isArray(data.bank_accounts)).toBe(true);
  });

  it("get_treasury_liquidity_forecast returns weekly array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ weekly?: unknown[]; projected_ending_liquid?: number }>(
      token,
      "get_treasury_liquidity_forecast",
      { p_org_id: orgId, p_days: 30 }
    );

    expect(Array.isArray(data.weekly)).toBe(true);
    expect(typeof data.projected_ending_liquid).toBe("number");
  });

  it("list_treasury_transfers returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_treasury_transfers", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });
});

run("Finance integration — tax compliance", () => {
  it("get_tax_compliance_settings returns org tax config", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ einvoice_enabled?: boolean; tax_filing_frequency?: string }>(
      token,
      "get_tax_compliance_settings",
      { p_org_id: orgId }
    );

    expect(typeof data.einvoice_enabled).toBe("boolean");
    expect(typeof data.tax_filing_frequency).toBe("string");
  });

  it("get_vat_liability_report returns output and input tax", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{
      output_tax?: number;
      input_tax?: number;
      net_payable?: number;
    }>(token, "get_vat_liability_report", {
      p_org_id: orgId,
      p_from: "2026-01-01",
      p_to: "2026-12-31",
    });

    expect(typeof data.output_tax).toBe("number");
    expect(typeof data.input_tax).toBe("number");
    expect(typeof data.net_payable).toBe("number");
  });

  it("list_tax_return_periods returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_tax_return_periods", {
      p_org_id: orgId,
      p_limit: 12,
    });
    expect(Array.isArray(rows)).toBe(true);
  }, 90_000);

  it("list_einvoice_documents returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_einvoice_documents", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("list_withholding_tax_rules returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_withholding_tax_rules", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });
});

run("Finance integration — FP&A", () => {
  it("list_fpa_scenarios returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    await rpc(token, "ensure_default_fpa_scenarios", { p_org_id: orgId });
    const rows = await rpc<unknown[]>(token, "list_fpa_scenarios", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("get_fpa_dashboard returns YTD summary", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ ytd?: { revenue?: number }; scenario_count?: number }>(
      token,
      "get_fpa_dashboard",
      { p_org_id: orgId }
    );

    expect(typeof data.scenario_count).toBe("number");
    expect(typeof data.ytd?.revenue).toBe("number");
  });

  it("list_rolling_forecasts returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_rolling_forecasts", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("compare_fpa_scenarios returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "compare_fpa_scenarios", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });
});

run("Finance integration — job cost", () => {
  it("list_cost_centers returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_cost_centers", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("list_projects_job_cost returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_projects_job_cost", {
      p_org_id: orgId,
      p_from: "2026-01-01",
      p_to: "2026-12-31",
    });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("get_cost_center_summary returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "get_cost_center_summary", {
      p_org_id: orgId,
      p_from: "2026-01-01",
      p_to: "2026-12-31",
    });
    expect(Array.isArray(rows)).toBe(true);
  });
});

run("Finance integration — fixed assets multi-book", () => {
  it("list_fa_books returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    await rpc(token, "ensure_default_fa_books", { p_org_id: orgId });
    const rows = await rpc<unknown[]>(token, "list_fa_books", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("get_fa_book_comparison returns financial and tax books", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<{ book_code?: string }[]>(token, "get_fa_book_comparison", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
    const codes = rows.map((r) => r.book_code);
    expect(codes).toContain("FIN");
    expect(codes).toContain("TAX");
  });
});

run("Finance integration — executive dashboard", () => {
  it("get_executive_financial_dashboard returns KPI scorecard", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    await rpc(token, "ensure_default_executive_layout", { p_org_id: orgId });
    const data = await rpc<{ kpis?: unknown[]; monthly_trends?: unknown[] }>(
      token,
      "get_executive_financial_dashboard",
      { p_org_id: orgId, p_from: "2026-01-01", p_to: "2026-01-31" }
    );

    expect(Array.isArray(data.kpis)).toBe(true);
    expect(Array.isArray(data.monthly_trends)).toBe(true);
    expect((data.kpis ?? []).length).toBeGreaterThan(0);
  });

  it("list_executive_kpi_targets returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_executive_kpi_targets", {
      p_org_id: orgId,
      p_from: "2026-01-01",
      p_to: "2026-01-31",
    });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("get_executive_kpi_drilldown returns rows for revenue", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ rows?: unknown[]; kpi_key?: string }>(
      token,
      "get_executive_kpi_drilldown",
      {
        p_org_id: orgId,
        p_kpi_key: "revenue",
        p_from: "2026-01-01",
        p_to: "2026-01-31",
      }
    );

    expect(data.kpi_key).toBe("revenue");
    expect(Array.isArray(data.rows)).toBe(true);
  });
});

run("Finance integration — financial automation", () => {
  it("list_financial_automation_rules returns array", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    await rpc(token, "ensure_default_financial_automation_rules", { p_org_id: orgId });
    const rows = await rpc<unknown[]>(token, "list_financial_automation_rules", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("list_financial_scheduled_reports returns financial schedules", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    await rpc(token, "ensure_default_financial_scheduled_reports", { p_org_id: orgId });
    const rows = await rpc<{ report_type?: string }[]>(
      token,
      "list_financial_scheduled_reports",
      { p_org_id: orgId }
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.every((r) => (r.report_type ?? "").startsWith("financial."))).toBe(true);
  });

  it("evaluate_financial_automation_rules returns evaluation summary", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ evaluated?: number; triggered?: number }>(
      token,
      "evaluate_financial_automation_rules",
      { p_org_id: orgId }
    );
    expect(typeof data.evaluated).toBe("number");
    expect(typeof data.triggered).toBe("number");
  });
});

run("Finance integration — financial security", () => {
  it("get_financial_security_settings returns controls", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ sod_enforcement_enabled?: boolean; je_requires_approval?: boolean }>(
      token,
      "get_financial_security_settings",
      { p_org_id: orgId }
    );
    expect(typeof data.sod_enforcement_enabled).toBe("boolean");
    expect(typeof data.je_requires_approval).toBe("boolean");
  });

  it("list_sod_conflict_rules returns default rules", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    await rpc(token, "ensure_default_sod_rules", { p_org_id: orgId });
    const rows = await rpc<unknown[]>(token, "list_sod_conflict_rules", { p_org_id: orgId });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("list_pending_financial_approvals returns queue shape", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ journal_entries?: unknown[]; payment_runs?: unknown[] }>(
      token,
      "list_pending_financial_approvals",
      { p_org_id: orgId }
    );
    expect(Array.isArray(data.journal_entries)).toBe(true);
    expect(Array.isArray(data.payment_runs)).toBe(true);
  });
});

run("Finance integration — financial performance", () => {
  it("get_financial_performance_settings returns cache controls", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ financial_cache_enabled?: boolean; financial_cache_ttl_minutes?: number }>(
      token,
      "get_financial_performance_settings",
      { p_org_id: orgId }
    );
    expect(typeof data.financial_cache_enabled).toBe("boolean");
    expect(typeof data.financial_cache_ttl_minutes).toBe("number");
  });

  it("fetch_financial_report returns cached envelope", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ source?: string; data?: unknown }>(
      token,
      "fetch_financial_report",
      {
        p_org_id: orgId,
        p_report_type: "trial_balance",
        p_to: "2026-01-31",
        p_as_of: "2026-01-31",
      }
    );
    expect(["cache", "live"].includes(data.source ?? "")).toBe(true);
    expect(data.data).toBeDefined();
  });

  it("get_financial_performance_dashboard returns stats", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    await rpc(token, "ensure_default_financial_partition_policies", { p_org_id: orgId });
    const data = await rpc<{ table_counts?: { journal_entries?: number }; cache?: unknown }>(
      token,
      "get_financial_performance_dashboard",
      { p_org_id: orgId }
    );
    expect(typeof data.table_counts?.journal_entries).toBe("number");
    expect(data.cache).toBeDefined();
  });
});

run("Finance integration — financial AI assistant", () => {
  it("get_financial_ai_settings returns assistant controls", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ financial_ai_enabled?: boolean; financial_ai_provider?: string }>(
      token,
      "get_financial_ai_settings",
      { p_org_id: orgId }
    );
    expect(typeof data.financial_ai_enabled).toBe("boolean");
    expect(typeof data.financial_ai_provider).toBe("string");
  });

  it("resolve_financial_ai_question returns an answer", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ answer?: string; source?: string }>(
      token,
      "resolve_financial_ai_question",
      {
        p_org_id: orgId,
        p_question: "What is revenue this period?",
        p_from: "2026-01-01",
        p_to: "2026-01-31",
      }
    );
    expect(typeof data.answer).toBe("string");
    expect(data.source).toBe("internal");
  });

  it("list_financial_ai_suggested_prompts returns prompts", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const rows = await rpc<unknown[]>(token, "list_financial_ai_suggested_prompts", {
      p_org_id: orgId,
    });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});

run("Finance integration — financial shell", () => {
  it("get_financial_shell_preferences returns defaults", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ density?: string; show_launchpad?: boolean }>(
      token,
      "get_financial_shell_preferences",
      { p_org_id: orgId }
    );
    expect(["cozy", "compact"].includes(data.density ?? "")).toBe(true);
    expect(typeof data.show_launchpad).toBe("boolean");
  });

  it("list_financial_launchpad_tiles returns grouped catalog", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const data = await rpc<{ areas?: { id?: string; tiles?: unknown[] }[] }>(
      token,
      "list_financial_launchpad_tiles",
      { p_org_id: orgId }
    );
    expect(Array.isArray(data.areas)).toBe(true);
    expect((data.areas?.length ?? 0) > 0).toBe(true);
    expect(Array.isArray(data.areas?.[0]?.tiles)).toBe(true);
  });
});

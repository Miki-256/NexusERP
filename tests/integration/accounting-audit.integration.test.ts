/**
 * Accounting go-live controls — trial balance + unposted sales backlog.
 */
import { describe, expect, it } from "vitest";
import { hasIntegrationCredentials, rpc, signIn } from "./supabase-client";

const run = hasIntegrationCredentials() ? describe : describe.skip;
const today = new Date().toISOString().slice(0, 10);

run("Accounting audit — go-live controls", () => {
  it("trial balance is balanced for YTD", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const lines = await rpc<{ debit: number; credit: number; account_code: string }[]>(
      token,
      "trial_balance",
      { p_org_id: orgId, p_to: today }
    );

    expect(Array.isArray(lines)).toBe(true);
    const totalDebit = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
    const delta = Math.abs(totalDebit - totalCredit);
    expect(delta, `TB imbalance debit=${totalDebit} credit=${totalCredit}`).toBeLessThan(0.02);
  });

  it("unposted sales backlog is countable and batch-clearable", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const before = await rpc<number>(token, "count_unposted_sales", { p_org_id: orgId });
    expect(typeof before).toBe("number");
    expect(before).toBeGreaterThanOrEqual(0);

    if (before > 0) {
      const result = await rpc<{
        posted?: number;
        skipped?: number;
        remaining?: number;
        first_error?: string | null;
      }>(token, "post_unposted_sales_batch", {
        p_org_id: orgId,
        p_limit: 50,
      });

      expect(typeof result.posted).toBe("number");
      expect(result.first_error ?? null).toBeNull();

      const after = await rpc<number>(token, "count_unposted_sales", { p_org_id: orgId });
      expect(after).toBeLessThanOrEqual(before);
    }
  });

  it("AR and AP aging envelopes load", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const ar = await rpc<Record<string, unknown>>(token, "accounts_receivable_aging", {
      p_org_id: orgId,
      p_as_of: today,
    });
    const ap = await rpc<Record<string, unknown>>(token, "accounts_payable_aging", {
      p_org_id: orgId,
      p_as_of: today,
    });

    expect(ar).toBeTruthy();
    expect(ap).toBeTruthy();
  });

  it("period close preflight returns status for an open period", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    await rpc<number>(token, "ensure_default_close_checklist", { p_org_id: orgId });

    const fiscal = await rpc<{
      year: number;
      periods: { id: string; status?: string; period_no?: number }[];
    }>(token, "list_fiscal_periods", { p_org_id: orgId });

    expect(Array.isArray(fiscal.periods)).toBe(true);
    const open =
      fiscal.periods.find((p) => (p.status ?? "open") === "open") ?? fiscal.periods[0];
    expect(open?.id).toBeTruthy();

    const status = await rpc<{
      period_id?: string;
      tasks?: unknown[];
      blockers?: unknown[];
      can_close?: boolean;
      status?: string;
    }>(token, "run_period_close_preflight", { p_period_id: open!.id });

    expect(status.period_id ?? open!.id).toBeTruthy();
    expect(Array.isArray(status.tasks) || Array.isArray(status.blockers) || status.status).toBeTruthy();
  });
});

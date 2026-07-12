import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasIntegrationCredentials, rpc, signIn } from "./supabase-client";

const run = hasIntegrationCredentials() ? describe : describe.skip;

const FOREIGN_ORG_ID = "00000000-0000-0000-0000-000000000001";

type AccountRow = {
  id: string;
  code: string;
  name: string;
  type?: string;
  is_postable?: boolean;
};

async function workspaceOrgId(token: string) {
  const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
  const orgId = workspace.organization?.id;
  expect(orgId).toBeTruthy();
  return orgId!;
}

async function loadAccounts(token: string, orgId: string) {
  return rpc<AccountRow[]>(token, "list_accounts", { p_org_id: orgId });
}

run("Finance write — journal entry guards", () => {
  it("rejects unbalanced journal lines", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);
    const accounts = await loadAccounts(token, orgId);
    const cash = accounts.find((a) => a.code === "1000" && a.is_postable !== false);
    const revenue = accounts.find((a) => a.code.startsWith("4") && a.is_postable !== false);
    expect(cash?.id).toBeTruthy();
    expect(revenue?.id).toBeTruthy();

    await expect(
      rpc(token, "post_journal_entry", {
        p_org_id: orgId,
        p_journal_code: "GEN",
        p_date: new Date().toISOString().slice(0, 10),
        p_memo: "Integration unbalanced guard",
        p_source_type: "manual",
        p_source_id: randomUUID(),
        p_lines: [
          { accountId: cash!.id, debit: 10, credit: 0, description: "Debit" },
          { accountId: revenue!.id, debit: 0, credit: 5, description: "Credit" },
        ],
      })
    ).rejects.toThrow(/not balanced/i);
  });

  it("posts a balanced manual journal entry", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);
    const accounts = await loadAccounts(token, orgId);
    const cash = accounts.find((a) => a.code === "1000" && a.is_postable !== false);
    const revenue = accounts.find((a) => a.code.startsWith("4") && a.is_postable !== false);
    expect(cash?.id).toBeTruthy();
    expect(revenue?.id).toBeTruthy();

    const entryId = await rpc<string>(token, "post_journal_entry", {
      p_org_id: orgId,
      p_journal_code: "GEN",
      p_date: new Date().toISOString().slice(0, 10),
      p_memo: `Integration balanced JE ${randomUUID().slice(0, 8)}`,
      p_source_type: "manual",
      p_source_id: randomUUID(),
      p_lines: [
        { accountId: cash!.id, debit: 1, credit: 0, description: "Cash debit" },
        { accountId: revenue!.id, debit: 0, credit: 1, description: "Revenue credit" },
      ],
    });

    expect(entryId).toBeTruthy();
  });

  it("rejects post_journal_entry for a foreign organization", async () => {
    const token = await signIn();
    const accounts = await loadAccounts(token, await workspaceOrgId(token));
    const cash = accounts.find((a) => a.code === "1000");
    expect(cash?.id).toBeTruthy();

    await expect(
      rpc(token, "post_journal_entry", {
        p_org_id: FOREIGN_ORG_ID,
        p_journal_code: "GEN",
        p_date: new Date().toISOString().slice(0, 10),
        p_memo: "Foreign org",
        p_source_type: "manual",
        p_source_id: randomUUID(),
        p_lines: [{ accountId: cash!.id, debit: 1, credit: 1, description: "Invalid" }],
      })
    ).rejects.toThrow(/access denied|not balanced/i);
  });
});

run("Finance write — sale ledger batch", () => {
  it("count_unposted_sales returns a non-negative integer", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);
    const count = await rpc<number>(token, "count_unposted_sales", { p_org_id: orgId });
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("post_unposted_sales_batch returns posting summary envelope", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);

    const result = await rpc<{
      posted?: number;
      skipped?: number;
      remaining?: number;
      first_error?: string | null;
    }>(token, "post_unposted_sales_batch", {
      p_org_id: orgId,
      p_limit: 5,
    });

    expect(typeof result.posted).toBe("number");
    expect(typeof result.skipped).toBe("number");
    expect(typeof result.remaining).toBe("number");
    expect(result.posted! + result.skipped! + result.remaining!).toBeGreaterThanOrEqual(0);
  });
});

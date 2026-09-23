import { describe, expect, it } from "vitest";
import {
  hasIntegrationCredentials,
  integrationCredentials,
  restGet,
  rpc,
  signIn,
} from "./supabase-client";

const run = hasIntegrationCredentials() ? describe : describe.skip;

/** Org id the signed-in user must not belong to. */
const FOREIGN_ORG_ID = "00000000-0000-0000-0000-000000000001";

run("Tenant isolation — RPC guards", () => {
  it("rejects list_accounts for a foreign organization", async () => {
    const token = await signIn();
    await expect(rpc(token, "list_accounts", { p_org_id: FOREIGN_ORG_ID })).rejects.toThrow(
      /access denied|not authenticated|permission denied/i
    );
  });

  it("rejects list_products_page for a foreign organization", async () => {
    const token = await signIn();
    await expect(
      rpc(token, "list_products_page", {
        p_org_id: FOREIGN_ORG_ID,
        p_limit: 5,
        p_offset: 0,
      })
    ).rejects.toThrow(/access denied|not authenticated|permission denied/i);
  });

  it("rejects dashboard_bundle for a foreign organization", async () => {
    const token = await signIn();
    await expect(
      rpc(token, "dashboard_bundle", {
        p_org_id: FOREIGN_ORG_ID,
        p_include_accounting: true,
        p_include_expenses: true,
      })
    ).rejects.toThrow(/access denied|not authenticated|permission denied/i);
  });

  it("rejects complete_sale for a foreign organization", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const homeOrgId = workspace.organization?.id;
    expect(homeOrgId).toBeTruthy();
    expect(homeOrgId).not.toBe(FOREIGN_ORG_ID);

    const registers = await restGet<{ id: string; store_id: string }[]>(
      token,
      "registers",
      `organization_id=eq.${homeOrgId}&is_active=eq.true&select=id,store_id&limit=1`
    );
    const register = registers[0];
    expect(register).toBeTruthy();

    await expect(
      rpc(token, "complete_sale", {
        p_organization_id: FOREIGN_ORG_ID,
        p_store_id: register.store_id,
        p_register_id: register.id,
        p_session_id: null,
        p_idempotency_key: "00000000-0000-4000-8000-000000000099",
        p_lines: [
          {
            variantId: "00000000-0000-4000-8000-000000000001",
            productName: "foreign-org probe",
            quantity: 1,
            unitPrice: 1,
            discountAmount: 0,
          },
        ],
        p_discount_amount: 0,
        p_customer_name: null,
        p_customer_phone: null,
        p_payments: [{ method: "cash", amount: 1, cashTendered: 1 }],
      })
    ).rejects.toThrow(/access denied|not authenticated|permission denied|organization/i);
  });

  it("allows list_accounts only for the signed-in workspace org", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization?.id;
    expect(orgId).toBeTruthy();
    expect(orgId).not.toBe(FOREIGN_ORG_ID);

    const accounts = await rpc<unknown[]>(token, "list_accounts", { p_org_id: orgId });
    expect(Array.isArray(accounts)).toBe(true);
  });
});

run("Tenant isolation — RLS on REST", () => {
  it("returns no rows when querying products for a foreign organization", async () => {
    const token = await signIn();
    const rows = await restGet<unknown[]>(
      token,
      "products",
      `organization_id=eq.${FOREIGN_ORG_ID}&select=id&limit=5`
    );
    expect(rows).toEqual([]);
  });

  it("does not expose foreign organization_members via REST", async () => {
    const token = await signIn();
    const { supabaseUrl } = integrationCredentials();
    const res = await fetch(
      `${supabaseUrl}/rest/v1/organization_members?organization_id=eq.${FOREIGN_ORG_ID}&select=user_id&limit=5`,
      {
        headers: {
          apikey: integrationCredentials().anonKey,
          Authorization: `Bearer ${token}`,
        },
      }
    );
    expect(res.ok).toBe(true);
    const rows = (await res.json()) as unknown[];
    expect(rows).toEqual([]);
  });
});

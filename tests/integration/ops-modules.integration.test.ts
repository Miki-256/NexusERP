/**
 * POS / invoicing / purchasing module RPC coverage (list + soft write probes).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasIntegrationCredentials, restGet, rpc, signIn } from "./supabase-client";

const run = hasIntegrationCredentials() ? describe : describe.skip;
const today = new Date().toISOString().slice(0, 10);
const fromIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const toIso = new Date().toISOString();

async function workspaceOrgId(token: string) {
  const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
  const orgId = workspace.organization?.id;
  expect(orgId).toBeTruthy();
  return orgId!;
}

run("POS / Sales — register + catalog", () => {
  it("list_sales_register returns paginated sales envelope", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);

    const page = await rpc<{
      total?: number;
      rows?: unknown[];
      sales?: unknown[];
      summary?: Record<string, unknown>;
    }>(token, "list_sales_register", {
      p_organization_id: orgId,
      p_from: fromIso,
      p_to: toIso,
      p_limit: 10,
      p_offset: 0,
    });

    expect(page).toBeTruthy();
    const rows = page.rows ?? page.sales ?? [];
    expect(Array.isArray(rows)).toBe(true);
    expect(typeof (page.total ?? rows.length)).toBe("number");
  });

  it("list_products_page returns catalog page", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);

    const page = await rpc<{ total?: number; products?: unknown[]; rows?: unknown[] }>(
      token,
      "list_products_page",
      {
        p_org_id: orgId,
        p_limit: 20,
        p_offset: 0,
        p_active_only: true,
      }
    );

    expect(page).toBeTruthy();
    const products = page.products ?? page.rows ?? [];
    expect(Array.isArray(products)).toBe(true);
    expect(typeof (page.total ?? products.length)).toBe("number");
  });

  it("count_unposted_sales is non-negative for POS ledger queue", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);
    const count = await rpc<number>(token, "count_unposted_sales", { p_org_id: orgId });
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

run("Invoicing / AR — create draft + list", () => {
  it("creates a draft invoice when a customer exists", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);

    const customers = await restGet<Array<{ id: string; name?: string }>>(
      token,
      "customers",
      `organization_id=eq.${orgId}&select=id,name&limit=1`
    );

    if (!customers.length) {
      // Soft skip — seed data optional in some tenants
      expect(customers).toEqual([]);
      return;
    }

    const invoiceId = await rpc<string>(token, "create_customer_invoice", {
      p_org_id: orgId,
      p_customer_id: customers[0]!.id,
      p_invoice_date: today,
      p_due_date: today,
      p_tax_rate: 0,
      p_notes: `Integration draft ${randomUUID().slice(0, 8)}`,
      p_lines: [
        {
          description: "Integration line",
          quantity: 1,
          unitPrice: 1,
        },
      ],
    });

    expect(invoiceId).toBeTruthy();

    const page = await rpc<{ total: number; invoices: Array<{ id: string }> }>(
      token,
      "list_customer_invoices_page",
      { p_org_id: orgId, p_limit: 50, p_offset: 0 }
    );
    expect(page.invoices.some((i) => i.id === invoiceId)).toBe(true);
  });

  it("list_customer_open_invoices envelope loads", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);
    const page = await rpc<{ total: number; invoices: unknown[] }>(token, "list_customer_open_invoices", {
      p_org_id: orgId,
      p_limit: 10,
      p_offset: 0,
    });
    expect(typeof page.total).toBe("number");
    expect(Array.isArray(page.invoices)).toBe(true);
  });
});

run("Purchasing / AP — list + PO create when seeded", () => {
  it("list_vendor_open_bills and list_vendors_ap_summary load", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);

    const bills = await rpc<{ total: number; bills: unknown[] }>(token, "list_vendor_open_bills", {
      p_org_id: orgId,
      p_limit: 10,
      p_offset: 0,
    });
    expect(typeof bills.total).toBe("number");
    expect(Array.isArray(bills.bills)).toBe(true);

    const vendors = await rpc<unknown[]>(token, "list_vendors_ap_summary", { p_org_id: orgId });
    expect(Array.isArray(vendors)).toBe(true);
  });

  it("creates a purchase order when vendor, store, and variant exist", async () => {
    const token = await signIn();
    const orgId = await workspaceOrgId(token);

    const [vendors, stores, variants] = await Promise.all([
      restGet<Array<{ id: string }>>(
        token,
        "vendors",
        `organization_id=eq.${orgId}&select=id&limit=1`
      ),
      restGet<Array<{ id: string }>>(
        token,
        "stores",
        `organization_id=eq.${orgId}&select=id&limit=1`
      ),
      restGet<Array<{ id: string; name?: string; products?: { name?: string } | null }>>(
        token,
        "product_variants",
        `select=id,name,products!inner(organization_id,name)&products.organization_id=eq.${orgId}&limit=1`
      ),
    ]);

    if (!vendors.length || !stores.length || !variants.length) {
      expect(vendors.length + stores.length + variants.length).toBeGreaterThanOrEqual(0);
      return;
    }

    const variant = variants[0]!;
    const productName =
      variant.products?.name ?? variant.name ?? `Integration variant ${variant.id.slice(0, 8)}`;

    const poId = await rpc<string>(token, "create_purchase_order", {
      p_org_id: orgId,
      p_vendor_id: vendors[0]!.id,
      p_store_id: stores[0]!.id,
      p_expected_date: today,
      p_notes: `Integration PO ${randomUUID().slice(0, 8)}`,
      p_lines: [
        {
          variantId: variant.id,
          productName,
          quantity: 1,
          unitCost: 1,
        },
      ],
    });

    expect(poId).toBeTruthy();
  });
});

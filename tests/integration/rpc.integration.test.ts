import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hasIntegrationCredentials,
  rpc,
  restGet,
  signIn,
} from "./supabase-client";

const run = hasIntegrationCredentials() ? describe : describe.skip;

run("RPC integration — complete_sale idempotency", () => {
  it("rejects NULL idempotency_key", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization?.id;
    expect(orgId).toBeTruthy();

    const registers = await restGet<{ id: string; store_id: string }[]>(
      token,
      "registers",
      `organization_id=eq.${orgId}&is_active=eq.true&select=id,store_id&limit=1`
    );
    const register = registers[0];
    expect(register).toBeTruthy();

    const session = await rpc<{ id?: string }>(token, "get_open_register_session", {
      p_register_id: register.id,
    });
    let sessionId = session?.id;
    if (!sessionId) {
      await rpc(token, "open_register_session_manager", {
        p_register_id: register.id,
        p_organization_id: orgId,
        p_opening_float: 0,
        p_staff_id: null,
      });
      const opened = await rpc<{ id: string }>(token, "get_open_register_session", {
        p_register_id: register.id,
      });
      sessionId = opened.id;
    }
    expect(sessionId).toBeTruthy();

    const catalog = await rpc<Array<{ variantId: string; stock: number }>>(
      token,
      "get_pos_catalog",
      { p_register_id: register.id }
    );
    const item = catalog.find((c) => c.stock > 0);
    expect(item).toBeTruthy();

    await expect(
      rpc(token, "complete_sale", {
        p_organization_id: orgId,
        p_store_id: register.store_id,
        p_register_id: register.id,
        p_session_id: sessionId,
        p_idempotency_key: null,
        p_lines: [
          {
            variantId: item!.variantId,
            productName: "Integration test",
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
    ).rejects.toThrow(/idempotency_key is required/i);
  });

  it("returns duplicate=true when the same idempotency_key is reused", async () => {
    const token = await signIn();
    const workspace = await rpc<{
      organization?: { id?: string; tax_rate?: number; tax_inclusive?: boolean };
    }>(token, "get_my_workspace");
    const org = workspace.organization!;
    const orgId = org.id!;

    const registers = await restGet<{ id: string; store_id: string }[]>(
      token,
      "registers",
      `organization_id=eq.${orgId}&is_active=eq.true&select=id,store_id&limit=1`
    );
    const register = registers[0]!;

    const session = await rpc<{ id: string }>(token, "get_open_register_session", {
      p_register_id: register.id,
    });
    const sessionId = session.id;

    const catalog = await rpc<Array<{ variantId: string; stock: number; sellPrice: number }>>(
      token,
      "get_pos_catalog",
      { p_register_id: register.id }
    );
    const item = catalog.find((c) => c.stock > 0)!;
    const idempotencyKey = randomUUID();
    const unitPrice = Math.max(item.sellPrice, 1);
    const taxRate = org.tax_rate ?? 15;
    const taxInclusive = Boolean(org.tax_inclusive);
    const lineSubtotal = unitPrice;
    const lineTax = taxInclusive
      ? lineSubtotal - lineSubtotal / (1 + taxRate / 100)
      : lineSubtotal * (taxRate / 100);
    const saleTotal = taxInclusive ? lineSubtotal : lineSubtotal + lineTax;

    const payload = {
      p_organization_id: orgId,
      p_store_id: register.store_id,
      p_register_id: register.id,
      p_session_id: sessionId,
      p_idempotency_key: idempotencyKey,
      p_lines: [
        {
          variantId: item.variantId,
          productName: "Idempotency test",
          quantity: 1,
          unitPrice,
          discountAmount: 0,
        },
      ],
      p_discount_amount: 0,
      p_customer_name: null,
      p_customer_phone: null,
      p_payments: [{ method: "cash", amount: saleTotal, cashTendered: saleTotal }],
    };

    const first = await rpc<{ sale_id: string; duplicate?: boolean }>(token, "complete_sale", payload);
    expect(first.sale_id).toBeTruthy();
    expect(first.duplicate).not.toBe(true);

    const second = await rpc<{ sale_id: string; duplicate?: boolean }>(token, "complete_sale", payload);
    expect(second.duplicate).toBe(true);
    expect(second.sale_id).toBe(first.sale_id);
  });
});

run("RPC integration — adjust_inventory negative guard", () => {
  it("rejects adjustments that would drive stock negative", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const stores = await restGet<{ id: string }[]>(
      token,
      "stores",
      `organization_id=eq.${orgId}&is_active=eq.true&select=id&limit=1`
    );
    const storeId = stores[0]?.id;
    expect(storeId).toBeTruthy();

    const levels = await restGet<{ variant_id: string; quantity: number }[]>(
      token,
      "inventory_levels",
      `organization_id=eq.${orgId}&store_id=eq.${storeId}&select=variant_id,quantity&limit=1`
    );
    const level = levels[0];
    expect(level).toBeTruthy();

    await expect(
      rpc(token, "adjust_inventory", {
        p_store_id: storeId,
        p_variant_id: level!.variant_id,
        p_delta: -(level!.quantity + 100),
        p_reason: "Integration test negative guard",
      })
    ).rejects.toThrow(/negative stock|insufficient stock/i);
  });
});

run("RPC integration — stock movement ledger", () => {
  it("records a movement after adjust_inventory", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization!.id!;

    const stores = await restGet<{ id: string }[]>(
      token,
      "stores",
      `organization_id=eq.${orgId}&is_active=eq.true&select=id&limit=1`
    );
    const storeId = stores[0]?.id;
    expect(storeId).toBeTruthy();

    const levels = await restGet<{ variant_id: string }[]>(
      token,
      "inventory_levels",
      `organization_id=eq.${orgId}&store_id=eq.${storeId}&select=variant_id&limit=1`
    );
    const variantId = levels[0]?.variant_id;
    expect(variantId).toBeTruthy();

    const before = await rpc<{ items: unknown[]; total_count: number }>(token, "list_stock_movements", {
      p_org_id: orgId,
      p_store_id: storeId,
      p_limit: 5,
    });

    await rpc(token, "adjust_inventory", {
      p_store_id: storeId,
      p_variant_id: variantId,
      p_delta: 1,
      p_reason: "Integration test movement ledger",
    });

    const after = await rpc<{ items: { movement_type: string; lines: { quantity_delta: number }[] }[]; total_count: number }>(
      token,
      "list_stock_movements",
      {
        p_org_id: orgId,
        p_store_id: storeId,
        p_limit: 5,
      }
    );

    expect(after.total_count).toBeGreaterThanOrEqual(before.total_count);
    const latest = after.items[0];
    expect(latest?.movement_type).toBe("adjustment");
    expect(latest?.lines?.[0]?.quantity_delta).toBe(1);

    await rpc(token, "adjust_inventory", {
      p_store_id: storeId,
      p_variant_id: variantId,
      p_delta: -1,
      p_reason: "Integration test movement ledger rollback",
    });
  });

  it("records sale_shipment after complete_sale", async () => {
    const token = await signIn();
    const workspace = await rpc<{
      organization?: { id?: string; tax_rate?: number; tax_inclusive?: boolean };
    }>(token, "get_my_workspace");
    const org = workspace.organization!;
    const orgId = org.id!;

    const registers = await restGet<{ id: string; store_id: string }[]>(
      token,
      "registers",
      `organization_id=eq.${orgId}&is_active=eq.true&select=id,store_id&limit=1`
    );
    const register = registers[0]!;

    const session = await rpc<{ id: string }>(token, "get_open_register_session", {
      p_register_id: register.id,
    });
    const sessionId = session.id;

    const catalog = await rpc<Array<{ variantId: string; stock: number; sellPrice: number }>>(
      token,
      "get_pos_catalog",
      { p_register_id: register.id }
    );
    const item = catalog.find((c) => c.stock > 0)!;
    const unitPrice = Math.max(item.sellPrice, 1);
    const taxRate = org.tax_rate ?? 15;
    const taxInclusive = Boolean(org.tax_inclusive);
    const lineSubtotal = unitPrice;
    const lineTax = taxInclusive
      ? lineSubtotal - lineSubtotal / (1 + taxRate / 100)
      : lineSubtotal * (taxRate / 100);
    const saleTotal = taxInclusive ? lineSubtotal : lineSubtotal + lineTax;

    const sale = await rpc<{ sale_id: string }>(token, "complete_sale", {
      p_organization_id: orgId,
      p_store_id: register.store_id,
      p_register_id: register.id,
      p_session_id: sessionId,
      p_idempotency_key: randomUUID(),
      p_lines: [
        {
          variantId: item.variantId,
          productName: "Ledger sale test",
          quantity: 1,
          unitPrice,
          discountAmount: 0,
        },
      ],
      p_discount_amount: 0,
      p_customer_name: null,
      p_customer_phone: null,
      p_payments: [{ method: "cash", amount: saleTotal, cashTendered: saleTotal }],
    });

    const movements = await rpc<{ items: { movement_type: string; reference_id: string }[] }>(
      token,
      "list_stock_movements",
      {
        p_org_id: orgId,
        p_store_id: register.store_id,
        p_movement_type: "sale_shipment",
        p_limit: 10,
      }
    );

    const match = movements.items.find((m) => m.reference_id === sale.sale_id);
    expect(match?.movement_type).toBe("sale_shipment");
  });
});

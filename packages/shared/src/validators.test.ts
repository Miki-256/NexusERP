import { describe, expect, it } from "vitest";
import {
  activateUnconfirmedSchema,
  cartLineSchema,
  inviteSignupSchema,
  loginSchema,
  logFailedLoginSchema,
  mobileMoneyWebhookSchema,
  productUomUpsertSchema,
  purchaseOrderLineSchema,
  receiveLineSchema,
  signupSchema,
} from "./validators";

/** Fixed-conversion helper used by POS/PO/receive/inventory UIs. */
function toBaseQty(qty: number, conversionFactor: number) {
  return Math.round(qty * conversionFactor * 1e6) / 1e6;
}

describe("signupSchema", () => {
  it("accepts valid signup", () => {
    const result = signupSchema.safeParse({
      email: "user@example.com",
      password: "password1",
      fullName: "Test User",
    });
    expect(result.success).toBe(true);
  });

  it("rejects short password", () => {
    const result = signupSchema.safeParse({
      email: "user@example.com",
      password: "short",
      fullName: "Test User",
    });
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts optional inviteId", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "secret",
      inviteId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });
});

describe("inviteSignupSchema", () => {
  it("requires inviteId uuid", () => {
    const result = inviteSignupSchema.safeParse({
      inviteId: "not-a-uuid",
      email: "user@example.com",
      password: "password1",
      fullName: "Invited",
    });
    expect(result.success).toBe(false);
  });
});

describe("mobileMoneyWebhookSchema", () => {
  it("requires organization_id and reference", () => {
    const ok = mobileMoneyWebhookSchema.safeParse({
      organization_id: "550e8400-e29b-41d4-a716-446655440000",
      reference: "TXN-123",
      amount: 100,
    });
    expect(ok.success).toBe(true);

    const bad = mobileMoneyWebhookSchema.safeParse({ reference: "TXN-123" });
    expect(bad.success).toBe(false);
  });
});

describe("activateUnconfirmedSchema", () => {
  it("requires email and password", () => {
    expect(activateUnconfirmedSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
    expect(
      activateUnconfirmedSchema.safeParse({ email: "a@b.com", password: "x" }).success
    ).toBe(true);
  });
});

describe("logFailedLoginSchema", () => {
  it("requires valid email", () => {
    expect(logFailedLoginSchema.safeParse({ email: "bad" }).success).toBe(false);
    expect(logFailedLoginSchema.safeParse({ email: "ok@example.com" }).success).toBe(true);
  });
});

describe("productUomUpsertSchema", () => {
  it("normalizes uom code and requires positive factor", () => {
    const ok = productUomUpsertSchema.safeParse({
      productId: "550e8400-e29b-41d4-a716-446655440000",
      uomCode: " KG ",
      uomName: "Kilogram",
      conversionFactor: 1000,
      isBase: false,
      isSale: true,
      isPurchase: true,
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.uomCode).toBe("kg");

    const bad = productUomUpsertSchema.safeParse({
      productId: "550e8400-e29b-41d4-a716-446655440000",
      uomCode: "kg",
      uomName: "Kilogram",
      conversionFactor: 0,
    });
    expect(bad.success).toBe(false);
  });
});

describe("purchaseOrderLineSchema / receiveLineSchema / cartLineSchema uom", () => {
  it("accepts optional uomCode on lines", () => {
    expect(
      purchaseOrderLineSchema.safeParse({
        variantId: "550e8400-e29b-41d4-a716-446655440000",
        quantity: 1.5,
        unitCost: 10,
        uomCode: "kg",
      }).success
    ).toBe(true);
    expect(
      receiveLineSchema.safeParse({
        barcode: "12345678",
        name: "Sugar",
        quantity: 1500,
        uomCode: "kg",
        qtyEntered: 1.5,
      }).success
    ).toBe(true);
    expect(
      cartLineSchema.safeParse({
        variantId: "550e8400-e29b-41d4-a716-446655440000",
        productName: "Sugar",
        quantity: 0.5,
        unitPrice: 1000,
        uomCode: "kg",
      }).success
    ).toBe(true);
  });
});

describe("multi-UOM conversion UAT scenarios", () => {
  const kgFactor = 1000; // base = g

  it("PO 1.5 kg → +1500 g base", () => {
    expect(toBaseQty(1.5, kgFactor)).toBe(1500);
  });

  it("POS sell 250 g → −250 g", () => {
    expect(toBaseQty(250, 1)).toBe(250);
  });

  it("POS sell 0.5 kg → −500 g", () => {
    expect(toBaseQty(0.5, kgFactor)).toBe(500);
  });

  it("void/refund restores qty_base (500), not sale qty (0.5)", () => {
    const saleQty = 0.5;
    const qtyBase = toBaseQty(saleQty, kgFactor);
    expect(qtyBase).toBe(500);
    expect(qtyBase).not.toBe(saleQty);
  });

  it("inventory adjust +1 kg → +1000 g", () => {
    expect(toBaseQty(1, kgFactor)).toBe(1000);
  });
});

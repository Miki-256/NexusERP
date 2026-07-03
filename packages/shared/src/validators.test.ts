import { describe, expect, it } from "vitest";
import {
  activateUnconfirmedSchema,
  inviteSignupSchema,
  loginSchema,
  logFailedLoginSchema,
  mobileMoneyWebhookSchema,
  signupSchema,
} from "./validators";

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

import { describe, expect, it } from "vitest";
import {
  normalizeEthiopiaPhone,
  parseArifpayNotify,
} from "@/lib/payments/arifpay";

describe("normalizeEthiopiaPhone", () => {
  it("converts local 09… to 251…", () => {
    expect(normalizeEthiopiaPhone("0911234567")).toBe("251911234567");
  });

  it("keeps 251 prefix", () => {
    expect(normalizeEthiopiaPhone("+251 911 234 567")).toBe("251911234567");
  });
});

describe("parseArifpayNotify", () => {
  it("parses nonce + success status", () => {
    const parsed = parseArifpayNotify({
      nonce: "TB-ABC123",
      sessionId: "sess-1",
      paymentStatus: "SUCCESS",
      totalAmount: 150.5,
      transactionId: "txn-9",
    });
    expect(parsed.reference).toBe("TB-ABC123");
    expect(parsed.sessionId).toBe("sess-1");
    expect(parsed.externalId).toBe("txn-9");
    expect(parsed.amount).toBe(150.5);
    expect(parsed.success).toBe(true);
  });

  it("reads nested data objects", () => {
    const parsed = parseArifpayNotify({
      data: { nonce: "N-1", status: "paid", amount: "20" },
    });
    expect(parsed.reference).toBe("N-1");
    expect(parsed.amount).toBe(20);
    expect(parsed.success).toBe(true);
  });

  it("marks failed statuses", () => {
    const parsed = parseArifpayNotify({
      nonce: "TB-X",
      paymentStatus: "FAILED",
    });
    expect(parsed.success).toBe(false);
  });
});

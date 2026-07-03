import { describe, expect, it } from "vitest";

/** Mirrors /api/health degraded threshold logic. */
function healthHttpStatus(ledgerPending: number, webhookPending: number) {
  const degraded = ledgerPending > 100 || webhookPending > 50;
  return degraded ? 503 : 200;
}

describe("health probe thresholds", () => {
  it("returns 200 when queues are healthy", () => {
    expect(healthHttpStatus(0, 0)).toBe(200);
    expect(healthHttpStatus(100, 50)).toBe(200);
  });

  it("returns 503 when ledger queue exceeds threshold", () => {
    expect(healthHttpStatus(101, 0)).toBe(503);
  });

  it("returns 503 when webhook queue exceeds threshold", () => {
    expect(healthHttpStatus(0, 51)).toBe(503);
  });
});

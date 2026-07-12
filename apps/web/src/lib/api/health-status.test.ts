import { describe, expect, it } from "vitest";
import {
  buildHealthResponse,
  buildLivenessResponse,
  healthHttpStatus,
  isHealthDegraded,
} from "@/lib/api/health-status";

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

  it("builds degraded detailed response", () => {
    const result = buildHealthResponse({
      ok: true,
      ledger_queue_pending: 150,
      payment_webhook_queue_pending: 10,
    });
    expect(result.status).toBe(503);
    expect(result.body.status).toBe("degraded");
    expect(isHealthDegraded(150, 10)).toBe(true);
  });

  it("builds public liveness response without queue metrics", () => {
    const live = buildLivenessResponse();
    expect(live.status).toBe(200);
    expect(live.body.mode).toBe("liveness");
    expect(live.body).not.toHaveProperty("ledger_queue_pending");
  });
});

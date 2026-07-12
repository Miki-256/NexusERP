import { describe, expect, it } from "vitest";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows requests under the limit", () => {
    const key = `test-allow-${Date.now()}`;
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
  });

  it("blocks requests over the limit", () => {
    const key = `test-block-${Date.now()}`;
    rateLimit(key, 1, 60_000);
    const blocked = rateLimit(key, 1, 60_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
    }
  });
});

describe("clientIp", () => {
  it("reads x-forwarded-for first hop", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("203.0.113.1");
  });

  it("falls back to x-real-ip", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "198.51.100.4" },
    });
    expect(clientIp(req)).toBe("198.51.100.4");
  });
});

describe("rateLimitResponse", () => {
  it("returns 429 with Retry-After", async () => {
    const res = rateLimitResponse(30);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/too many requests/i);
  });
});

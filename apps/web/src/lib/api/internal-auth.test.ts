import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { verifyInternalSecret } from "@/lib/api/internal-auth";

describe("verifyInternalSecret", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts matching webhook secret header", () => {
    vi.stubEnv("POS_WEBHOOK_SECRET", "wh-secret");
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("http://localhost", {
      headers: { "x-pos-webhook-secret": "wh-secret" },
    });
    expect(verifyInternalSecret(req)).toBe(true);
  });

  it("accepts matching bearer cron secret", () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("http://localhost", {
      headers: { authorization: "Bearer cron-secret" },
    });
    expect(verifyInternalSecret(req)).toBe(true);
  });

  it("rejects missing secrets in production", () => {
    vi.stubEnv("POS_WEBHOOK_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("http://localhost");
    expect(verifyInternalSecret(req)).toBe(false);
  });

  it("allows open access in development when secrets unset", () => {
    vi.stubEnv("POS_WEBHOOK_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    const req = new Request("http://localhost");
    expect(verifyInternalSecret(req)).toBe(true);
  });
});

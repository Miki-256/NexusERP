import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { resolveNotificationBatchSize } from "@/lib/notifications/worker-options";

describe("resolveNotificationBatchSize", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 50", () => {
    expect(resolveNotificationBatchSize()).toBe(50);
  });

  it("respects explicit override", () => {
    expect(resolveNotificationBatchSize(25)).toBe(25);
  });

  it("caps override at 200", () => {
    expect(resolveNotificationBatchSize(500)).toBe(200);
  });

  it("reads NOTIFICATION_BATCH_SIZE env", () => {
    vi.stubEnv("NOTIFICATION_BATCH_SIZE", "80");
    expect(resolveNotificationBatchSize()).toBe(80);
  });
});

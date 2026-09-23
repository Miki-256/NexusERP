import { describe, expect, it } from "vitest";
import {
  humanizeSyncFailure,
  isAlreadySyncedMessage,
  isAutoClearableQueueError,
  isStockConflictQueueError,
  normalizeIdempotencyKey,
} from "./reconcile";

describe("offline reconcile helpers", () => {
  it("normalizes UUID idempotency keys", () => {
    expect(normalizeIdempotencyKey("  A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11  ")).toBe(
      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    );
    expect(normalizeIdempotencyKey("")).toBeNull();
    expect(normalizeIdempotencyKey(null)).toBeNull();
  });

  it("detects already-synced style errors", () => {
    expect(isAlreadySyncedMessage("duplicate key value")).toBe(true);
    expect(isAlreadySyncedMessage("already synced elsewhere")).toBe(true);
    expect(isAlreadySyncedMessage("Insufficient stock")).toBe(false);
  });

  it("detects stock-conflict queue errors for auto-clear", () => {
    expect(isStockConflictQueueError("Stock conflict — this sale may already")).toBe(true);
    expect(isStockConflictQueueError("Insufficient stock for variant")).toBe(true);
    expect(isStockConflictQueueError("Not authenticated")).toBe(false);
  });

  it("detects auto-clearable multi-device errors", () => {
    expect(isAutoClearableQueueError("Stock conflict — another device")).toBe(true);
    expect(isAutoClearableQueueError("duplicate key value")).toBe(true);
    expect(isAutoClearableQueueError("Not authenticated")).toBe(false);
  });

  it("humanizes stock conflicts for multi-device", () => {
    const msg = humanizeSyncFailure("Insufficient stock for variant x", true);
    expect(msg.toLowerCase()).toContain("another device");
    expect(msg.toLowerCase()).toContain("automatically");
  });

  it("humanizes auth failures without requiring manual remove", () => {
    const msg = humanizeSyncFailure("Register session is not open", false).toLowerCase();
    expect(msg).toContain("sign-in");
    expect(msg).toContain("sales");
  });
});

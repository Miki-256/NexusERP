import { describe, expect, it } from "vitest";
import { skipScopedFetch } from "@/lib/finance/financials-skip-fetch";

describe("skipScopedFetch", () => {
  it("returns the source promise when enabled", async () => {
    const result = await skipScopedFetch(true, Promise.resolve({ data: [1, 2] }));
    expect(result.data).toEqual([1, 2]);
  });

  it("returns null data when disabled", async () => {
    const result = await skipScopedFetch(false, Promise.resolve({ data: [1, 2] }));
    expect(result.data).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { formatOrgDateTimeFull } from "@/lib/finance-dates";

describe("formatOrgDateTimeFull (NX-AUDIT-002)", () => {
  it("formats a frozen UTC instant in Africa/Addis_Ababa (UTC+3)", () => {
    // 2026-09-18 15:11:01 UTC → 18:11:01 Addis
    const formatted = formatOrgDateTimeFull(
      "2026-09-18T15:11:01.000Z",
      "Africa/Addis_Ababa"
    );
    expect(formatted).not.toBe("—");
    // Must show 6:11 PM local (Addis), not 3:11 PM UTC
    expect(formatted).toMatch(/6:11:01/);
    expect(formatted).not.toMatch(/^9\/18\/2026,\s*3:11:01/);
  });
});

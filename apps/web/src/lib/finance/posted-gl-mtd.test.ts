import { describe, expect, it } from "vitest";
import { monthToDateInTimeZone } from "@/lib/finance-dates";
import { postedGlMtdRpcArgs } from "@/lib/finance/posted-gl-mtd";

describe("postedGlMtdRpcArgs (NX-AUDIT-001)", () => {
  it("uses gl mode and org-TZ MTD bounds for dashboard/hub parity", () => {
    const { from, to } = monthToDateInTimeZone("Africa/Addis_Ababa");
    const args = postedGlMtdRpcArgs("org-1", from, to);
    expect(args).toEqual({
      p_org_id: "org-1",
      p_from: from,
      p_to: to,
      p_mode: "gl",
    });
    expect(args.p_mode).toBe("gl");
    expect(from <= to).toBe(true);
    expect(from.endsWith("-01") || from.slice(8) === "01" || from.slice(5, 7) === to.slice(5, 7)).toBe(
      true
    );
  });
});

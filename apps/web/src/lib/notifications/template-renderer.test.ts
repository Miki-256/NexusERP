import { describe, expect, it } from "vitest";
import { renderNotificationTemplate } from "@/lib/notifications/template-renderer";

describe("renderNotificationTemplate", () => {
  it("replaces placeholders with payload values", () => {
    const out = renderNotificationTemplate("Sale {{total}} at {{store}}", {
      total: 1500,
      store: "Main",
    });
    expect(out).toBe("Sale 1500 at Main");
  });

  it("renders missing keys as empty strings", () => {
    expect(renderNotificationTemplate("Hi {{name}}", {})).toBe("Hi ");
  });

  it("handles null and undefined values", () => {
    expect(
      renderNotificationTemplate("Amount {{amount}}", { amount: null })
    ).toBe("Amount ");
  });
});

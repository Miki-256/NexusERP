import { describe, expect, it } from "vitest";
import {
  resolveEmailSender,
  validateEmailChannelConfig,
} from "@/lib/notifications/channels/email-sender";

describe("email sender helpers", () => {
  it("rejects disabled org channel", () => {
    expect(validateEmailChannelConfig({ is_enabled: false }).ok).toBe(false);
  });

  it("builds from header from org config", () => {
    const result = resolveEmailSender({
      is_enabled: true,
      from_name: "Olana Retail",
      from_email: "notify@olana.et",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.from).toBe("Olana Retail <notify@olana.et>");
    }
  });

  it("falls back to env defaults", () => {
    const result = resolveEmailSender(
      { is_enabled: true },
      { defaultFromEmail: "alerts@example.com", defaultFromName: "Nexus" }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.from).toBe("Nexus <alerts@example.com>");
    }
  });

  it("requires a from email when channel is enabled", () => {
    const result = resolveEmailSender({ is_enabled: true });
    expect(result.ok).toBe(false);
  });
});

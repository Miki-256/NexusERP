import { describe, expect, it } from "vitest";
import { conversationExportFilename, formatFinancialAiTranscript } from "./export";

describe("financial AI export", () => {
  it("formats a markdown transcript", () => {
    const md = formatFinancialAiTranscript({
      title: "Cash check",
      from: "2026-01-01",
      to: "2026-01-31",
      deepLink: "https://app.example/financials?tab=assistant&conversation=abc",
      messages: [
        { role: "user", content: "How is cash?" },
        {
          role: "assistant",
          content: "Cash is 10,000 ETB.",
          metadata: { source: "openai", tools_used: ["get_treasury"] },
        },
      ],
    });
    expect(md).toContain("# Cash check");
    expect(md).toContain("Period: 2026-01-01 → 2026-01-31");
    expect(md).toContain("## User");
    expect(md).toContain("How is cash?");
    expect(md).toContain("_via openai · tools: get_treasury_");
    expect(md).toContain("Link: https://app.example");
  });

  it("builds a safe filename", () => {
    expect(conversationExportFilename("Cash / Q&A!!", "abcdef12-9999")).toBe("cash-q-a-abcdef12.md");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  executeFinancialAiTool,
  isFinancialAiToolName,
  truncateToolPayload,
} from "./tools";

describe("financial AI tools", () => {
  it("recognizes known tool names", () => {
    expect(isFinancialAiToolName("get_pnl")).toBe(true);
    expect(isFinancialAiToolName("drop_table")).toBe(false);
  });

  it("truncates large tool payloads", () => {
    const big = { x: "a".repeat(20_000) };
    const out = truncateToolPayload(big);
    expect(out.length).toBeLessThan(JSON.stringify(big).length);
    expect(out.endsWith("…[truncated]")).toBe(true);
  });

  it("rejects unknown tools", async () => {
    const supabase = { rpc: vi.fn() };
    const result = await executeFinancialAiTool({
      supabase,
      orgId: "00000000-0000-0000-0000-000000000001",
      defaultFrom: "2026-01-01",
      defaultTo: "2026-01-31",
      call: { id: "1", name: "delete_everything", arguments: "{}" },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("dispatches get_pnl with defaults and mode", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: { revenue: 100 }, error: null }),
    };
    const result = await executeFinancialAiTool({
      supabase,
      orgId: "00000000-0000-0000-0000-000000000001",
      defaultFrom: "2026-01-01",
      defaultTo: "2026-01-31",
      call: { id: "c1", name: "get_pnl", arguments: "{}" },
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ revenue: 100 });
    expect(supabase.rpc).toHaveBeenCalledWith("profit_and_loss", {
      p_org_id: "00000000-0000-0000-0000-000000000001",
      p_from: "2026-01-01",
      p_to: "2026-01-31",
      p_mode: "gl",
    });
  });

  it("rejects invalid argument JSON", async () => {
    const supabase = { rpc: vi.fn() };
    const result = await executeFinancialAiTool({
      supabase,
      orgId: "00000000-0000-0000-0000-000000000001",
      defaultFrom: "2026-01-01",
      defaultTo: "2026-01-31",
      call: { id: "1", name: "get_treasury", arguments: "not-json" },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid JSON/);
  });

  it("dispatches suggest_draft_journal_entry", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: { journal_entry_id: "00000000-0000-0000-0000-000000000099", status: "draft" },
        error: null,
      }),
    };
    const result = await executeFinancialAiTool({
      supabase,
      orgId: "00000000-0000-0000-0000-000000000001",
      defaultFrom: "2026-01-01",
      defaultTo: "2026-01-31",
      conversationId: "00000000-0000-0000-0000-000000000010",
      call: {
        id: "c2",
        name: "suggest_draft_journal_entry",
        arguments: JSON.stringify({
          memo: "Accrue rent",
          lines: [
            { account_code: "5100", debit: 1000, credit: 0 },
            { account_code: "2000", debit: 0, credit: 1000 },
          ],
        }),
      },
    });
    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_ai_journal_entry_draft",
      expect.objectContaining({
        p_org_id: "00000000-0000-0000-0000-000000000001",
        p_conversation_id: "00000000-0000-0000-0000-000000000010",
      })
    );
  });
});

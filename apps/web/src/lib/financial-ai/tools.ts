/** Finance tools the AI assistant may invoke (L3 read + L6 draft JE). */

import { z } from "zod";

export const FINANCIAL_AI_TOOL_NAMES = [
  "get_pnl",
  "get_balance_sheet",
  "get_cash_flow",
  "get_ar_aging",
  "get_ap_aging",
  "get_treasury",
  "get_executive_dashboard",
  "get_period_snapshot",
  "get_chart_of_accounts",
  "suggest_draft_journal_entry",
] as const;

export type FinancialAiToolName = (typeof FINANCIAL_AI_TOOL_NAMES)[number];

export type FinancialAiToolDefinition = {
  type: "function";
  function: {
    name: FinancialAiToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const periodProps = {
  from: { type: "string", description: "Start date YYYY-MM-DD (defaults to conversation period)" },
  to: { type: "string", description: "End / as-of date YYYY-MM-DD (defaults to conversation period)" },
};

/** OpenAI-compatible tool schemas. */
export const FINANCIAL_AI_TOOLS: FinancialAiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_pnl",
      description: "Profit & loss for a period (revenue, COGS, margins, net profit).",
      parameters: {
        type: "object",
        properties: {
          ...periodProps,
          mode: {
            type: "string",
            enum: ["gl", "operational"],
            description: "gl = ledger P&L; operational = operational view. Default gl.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_balance_sheet",
      description: "Balance sheet as of a date (assets, liabilities, equity).",
      parameters: { type: "object", properties: { to: periodProps.to } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cash_flow",
      description: "Cash flow statement for a period.",
      parameters: { type: "object", properties: periodProps },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ar_aging",
      description: "Accounts receivable aging buckets as of a date.",
      parameters: { type: "object", properties: { to: periodProps.to } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ap_aging",
      description: "Accounts payable aging buckets as of a date.",
      parameters: { type: "object", properties: { to: periodProps.to } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_treasury",
      description: "Treasury cash position (cash, banks, mobile money, open AR/AP).",
      parameters: { type: "object", properties: { to: periodProps.to } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_executive_dashboard",
      description: "Executive KPI dashboard for a period.",
      parameters: { type: "object", properties: periodProps },
    },
  },
  {
    type: "function",
    function: {
      name: "get_period_snapshot",
      description:
        "Combined financial snapshot (P&L, BS, CF, AR/AP, treasury, executive) for the period.",
      parameters: { type: "object", properties: periodProps },
    },
  },
  {
    type: "function",
    function: {
      name: "get_chart_of_accounts",
      description: "List active GL accounts (code, name, type) before suggesting a journal entry.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_draft_journal_entry",
      description:
        "Create a DRAFT journal entry suggestion for manager approval. Never posts. Use only when the user explicitly asks to draft/suggest a journal entry. Lines must balance. Prefer account_code from get_chart_of_accounts.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Entry date YYYY-MM-DD" },
          memo: { type: "string", description: "Journal memo / explanation" },
          journal_code: {
            type: "string",
            description: "Journal code, default GEN",
          },
          lines: {
            type: "array",
            description: "Balanced lines (min 2)",
            items: {
              type: "object",
              properties: {
                account_code: { type: "string" },
                accountId: { type: "string" },
                debit: { type: "number" },
                credit: { type: "number" },
                description: { type: "string" },
              },
              required: ["debit", "credit"],
            },
          },
        },
        required: ["memo", "lines"],
      },
    },
  },
];

export type FinancialAiToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type FinancialAiToolResult = {
  toolCallId: string;
  name: FinancialAiToolName | string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const lineSchema = z.object({
  account_code: z.string().optional(),
  accountId: z.string().uuid().optional(),
  debit: z.number().nonnegative(),
  credit: z.number().nonnegative(),
  description: z.string().optional(),
});

const argsSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    mode: z.enum(["gl", "operational"]).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    memo: z.string().max(500).optional(),
    journal_code: z.string().max(32).optional(),
    lines: z.array(lineSchema).min(2).max(40).optional(),
  })
  .passthrough();

const MAX_TOOL_JSON_CHARS = 12_000;

export function truncateToolPayload(value: unknown): string {
  const raw = JSON.stringify(value ?? null);
  if (raw.length <= MAX_TOOL_JSON_CHARS) return raw;
  return `${raw.slice(0, MAX_TOOL_JSON_CHARS)}…[truncated]`;
}

export function isFinancialAiToolName(name: string): name is FinancialAiToolName {
  return (FINANCIAL_AI_TOOL_NAMES as readonly string[]).includes(name);
}

export async function executeFinancialAiTool(params: {
  supabase: RpcClient;
  orgId: string;
  defaultFrom: string;
  defaultTo: string;
  conversationId?: string | null;
  call: FinancialAiToolCall;
}): Promise<FinancialAiToolResult> {
  const { supabase, orgId, defaultFrom, defaultTo, conversationId, call } = params;

  if (!isFinancialAiToolName(call.name)) {
    return {
      toolCallId: call.id,
      name: call.name,
      ok: false,
      error: `Unknown tool: ${call.name}`,
    };
  }

  let parsedArgs: z.infer<typeof argsSchema> = {};
  try {
    const raw = call.arguments?.trim() ? JSON.parse(call.arguments) : {};
    const parsed = argsSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        toolCallId: call.id,
        name: call.name,
        ok: false,
        error: `Invalid tool arguments: ${parsed.error.message}`,
      };
    }
    parsedArgs = parsed.data;
  } catch {
    return {
      toolCallId: call.id,
      name: call.name,
      ok: false,
      error: "Tool arguments must be valid JSON",
    };
  }

  const from = parsedArgs.from ?? defaultFrom;
  const to = parsedArgs.to ?? defaultTo;
  const mode = parsedArgs.mode ?? "gl";

  try {
    let result: { data: unknown; error: { message: string } | null };

    switch (call.name) {
      case "get_pnl":
        result = await supabase.rpc("profit_and_loss", {
          p_org_id: orgId,
          p_from: from,
          p_to: to,
          p_mode: mode,
        });
        break;
      case "get_balance_sheet":
        result = await supabase.rpc("balance_sheet", {
          p_org_id: orgId,
          p_to: to,
        });
        break;
      case "get_cash_flow":
        result = await supabase.rpc("cash_flow", {
          p_org_id: orgId,
          p_from: from,
          p_to: to,
        });
        break;
      case "get_ar_aging":
        result = await supabase.rpc("accounts_receivable_aging", {
          p_org_id: orgId,
          p_as_of: to,
        });
        break;
      case "get_ap_aging":
        result = await supabase.rpc("accounts_payable_aging", {
          p_org_id: orgId,
          p_as_of: to,
        });
        break;
      case "get_treasury":
        result = await supabase.rpc("get_treasury_cash_position", {
          p_org_id: orgId,
          p_as_of: to,
        });
        break;
      case "get_executive_dashboard":
        result = await supabase.rpc("get_executive_financial_dashboard", {
          p_org_id: orgId,
          p_from: from,
          p_to: to,
        });
        break;
      case "get_period_snapshot":
        result = await supabase.rpc("build_financial_ai_context", {
          p_org_id: orgId,
          p_from: from,
          p_to: to,
        });
        break;
      case "get_chart_of_accounts": {
        result = await supabase.rpc("list_accounts", { p_org_id: orgId });
        if (!result.error && Array.isArray(result.data)) {
          const slim = (result.data as { code?: string; name?: string; type?: string; is_active?: boolean; id?: string }[])
            .filter((a) => a.is_active !== false)
            .map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }))
            .slice(0, 200);
          return {
            toolCallId: call.id,
            name: call.name,
            ok: true,
            data: slim,
          };
        }
        break;
      }
      case "suggest_draft_journal_entry": {
        if (!parsedArgs.lines?.length) {
          return {
            toolCallId: call.id,
            name: call.name,
            ok: false,
            error: "lines are required",
          };
        }
        result = await supabase.rpc("create_ai_journal_entry_draft", {
          p_org_id: orgId,
          p_date: parsedArgs.date ?? defaultTo,
          p_memo: parsedArgs.memo ?? "AI suggested journal entry",
          p_lines: parsedArgs.lines,
          p_journal_code: parsedArgs.journal_code ?? "GEN",
          p_conversation_id: conversationId ?? null,
        });
        break;
      }
    }

    if (result.error) {
      return {
        toolCallId: call.id,
        name: call.name,
        ok: false,
        error: result.error.message,
      };
    }

    return {
      toolCallId: call.id,
      name: call.name,
      ok: true,
      data: result.data,
    };
  } catch (err) {
    return {
      toolCallId: call.id,
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : "Tool execution failed",
    };
  }
}

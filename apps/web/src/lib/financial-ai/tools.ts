/** Read-only finance tools the AI assistant may invoke (L3). */

import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const FINANCIAL_AI_TOOL_NAMES = [
  "get_pnl",
  "get_balance_sheet",
  "get_cash_flow",
  "get_ar_aging",
  "get_ap_aging",
  "get_treasury",
  "get_executive_dashboard",
  "get_period_snapshot",
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

const argsSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    mode: z.enum(["gl", "operational"]).optional(),
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
  call: FinancialAiToolCall;
}): Promise<FinancialAiToolResult> {
  const { supabase, orgId, defaultFrom, defaultTo, call } = params;

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

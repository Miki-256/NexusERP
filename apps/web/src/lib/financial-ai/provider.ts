/** Financial AI — OpenAI-compatible chat completion with optional tool loop (L3). */

import {
  FINANCIAL_AI_TOOLS,
  executeFinancialAiTool,
  truncateToolPayload,
  type FinancialAiToolCall,
} from "./tools";

export type FinancialAiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};

export function getFinancialAiApiKey(): string | undefined {
  return process.env.FINANCIAL_AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined;
}

export function getFinancialAiBaseUrl(): string {
  return (
    process.env.FINANCIAL_AI_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
}

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const MAX_TOOL_ROUNDS = 3;

async function callChatCompletions(params: {
  model: string;
  messages: FinancialAiChatMessage[];
  tools?: typeof FINANCIAL_AI_TOOLS;
}): Promise<{
  content: string | null;
  toolCalls: FinancialAiToolCall[];
}> {
  const apiKey = getFinancialAiApiKey();
  if (!apiKey) {
    throw new Error("FINANCIAL_AI_API_KEY or OPENAI_API_KEY not configured");
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    temperature: 0.2,
    max_tokens: 1000,
  };
  if (params.tools?.length) {
    body.tools = params.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${getFinancialAiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: {
          id: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }[];
      };
    }[];
  };

  const msg = json.choices?.[0]?.message;
  const toolCalls: FinancialAiToolCall[] = (msg?.tool_calls ?? [])
    .filter((t) => t.id && t.function?.name)
    .map((t) => ({
      id: t.id,
      name: t.function!.name!,
      arguments: t.function?.arguments ?? "{}",
    }));

  return {
    content: msg?.content?.trim() || null,
    toolCalls,
  };
}

/**
 * Single-shot completion (no tools). Kept for simple paths / tests.
 */
export async function completeFinancialAiChat(params: {
  model: string;
  messages: { role: "user" | "assistant"; content: string }[];
  context: unknown;
}): Promise<{ answer: string; source: "openai"; toolsUsed: string[] }> {
  const systemPrompt = `You are NexusERP Financial Assistant. Answer using ONLY the provided financial context JSON.
Be concise, use the org currency, and cite numbers from the context. If data is missing, say so.
Do not invent transactions or balances. Period and figures must match the context.
You may use prior turns in this conversation for follow-up questions, but never invent facts outside the context JSON.`;

  const messages: FinancialAiChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "system",
      content: `Financial context:\n${JSON.stringify(params.context)}`,
    },
    ...params.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content })),
  ];

  const result = await callChatCompletions({ model: params.model, messages });
  if (!result.content) {
    throw new Error("Empty LLM response");
  }
  return { answer: result.content, source: "openai", toolsUsed: [] };
}

/**
 * Multi-round tool loop: model may call read-only finance RPCs before answering.
 */
export async function completeFinancialAiChatWithTools(params: {
  model: string;
  messages: { role: "user" | "assistant"; content: string }[];
  context: unknown;
  orgId: string;
  from: string;
  to: string;
  supabase: RpcClient;
}): Promise<{ answer: string; source: "openai"; toolsUsed: string[] }> {
  const systemPrompt = `You are NexusERP Financial Assistant for NexusERP.
Use the baseline financial context JSON and, when needed, call read-only tools for fresher or deeper figures.
Rules:
- Never invent balances, invoices, or journal entries.
- Prefer tools for follow-ups that need a specific report (P&L, aging, treasury, etc.).
- Cite numbers with the org currency from context/tools.
- If a tool errors or data is missing, say so clearly.
- Keep answers concise and actionable.`;

  const messages: FinancialAiChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "system",
      content: `Baseline financial context (period ${params.from} to ${params.to}):\n${truncateToolPayload(params.context)}`,
    },
    ...params.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-12)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await callChatCompletions({
      model: params.model,
      messages,
      tools: FINANCIAL_AI_TOOLS,
    });

    if (result.toolCalls.length === 0) {
      if (!result.content) {
        throw new Error("Empty LLM response");
      }
      return { answer: result.content, source: "openai", toolsUsed };
    }

    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls.map((t) => ({
        id: t.id,
        type: "function" as const,
        function: { name: t.name, arguments: t.arguments },
      })),
    });

    for (const call of result.toolCalls) {
      const toolResult = await executeFinancialAiTool({
        supabase: params.supabase,
        orgId: params.orgId,
        defaultFrom: params.from,
        defaultTo: params.to,
        call,
      });
      toolsUsed.push(call.name);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: truncateToolPayload(
          toolResult.ok
            ? { ok: true, tool: toolResult.name, data: toolResult.data }
            : { ok: false, tool: toolResult.name, error: toolResult.error }
        ),
      });
    }
  }

  // Final answer without further tools after max rounds
  const final = await callChatCompletions({ model: params.model, messages });
  if (!final.content) {
    throw new Error("Empty LLM response after tool rounds");
  }
  return { answer: final.content, source: "openai", toolsUsed };
}

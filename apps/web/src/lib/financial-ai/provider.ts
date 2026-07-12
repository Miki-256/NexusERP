/** Financial AI — OpenAI-compatible chat completion (optional). */

export type FinancialAiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
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

export async function completeFinancialAiChat(params: {
  model: string;
  messages: FinancialAiChatMessage[];
  context: unknown;
}): Promise<{ answer: string; source: "openai" }> {
  const apiKey = getFinancialAiApiKey();
  if (!apiKey) {
    throw new Error("FINANCIAL_AI_API_KEY or OPENAI_API_KEY not configured");
  }

  const systemPrompt = `You are NexusERP Financial Assistant. Answer using ONLY the provided financial context JSON.
Be concise, use the org currency, and cite numbers from the context. If data is missing, say so.
Do not invent transactions or balances. Period and figures must match the context.`;

  const messages: FinancialAiChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "system",
      content: `Financial context:\n${JSON.stringify(params.context)}`,
    },
    ...params.messages.filter((m) => m.role === "user" || m.role === "assistant"),
  ];

  const res = await fetch(`${getFinancialAiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages,
      temperature: 0.2,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const answer = json.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error("Empty LLM response");
  }

  return { answer, source: "openai" };
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMemberPermissions } from "@/lib/org-context";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitDistributed } from "@/lib/rate-limit-distributed";
import {
  completeFinancialAiChatWithTools,
  getFinancialAiApiKey,
} from "@/lib/financial-ai/provider";

const chatSchema = z.object({
  orgId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`financial-ai:${ip}`, 30, 15 * 60 * 1000);
  if (!limited.ok) {
    return rateLimitResponse(limited.retryAfterSec);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { orgId, conversationId, message, from, to } = parsed.data;

  const permissions = await getMemberPermissions();
  if (!permissions) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (permissions.activeOrganizationId !== orgId) {
    return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
  }
  if (!permissions.canAccessApp("accounting")) {
    return NextResponse.json({ error: "Accounting access required" }, { status: 403 });
  }

  const supabase = await createClient();

  const { data: settings, error: settingsError } = await supabase.rpc("get_financial_ai_settings", {
    p_org_id: orgId,
  });
  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 403 });
  }

  const aiSettings = settings as {
    financial_ai_enabled?: boolean;
    financial_ai_provider?: string;
    financial_ai_model?: string;
  };

  if (aiSettings.financial_ai_enabled === false) {
    return NextResponse.json({ error: "Financial AI is disabled for this organization" }, { status: 403 });
  }

  let convId = conversationId;
  if (!convId) {
    const title = message.trim().slice(0, 72) || "Financial Q&A";
    const { data: created, error: createError } = await supabase.rpc("create_financial_ai_conversation", {
      p_org_id: orgId,
      p_title: title,
      p_from: from,
      p_to: to,
    });
    if (createError || !created) {
      return NextResponse.json({ error: createError?.message ?? "Failed to create conversation" }, { status: 500 });
    }
    convId = (created as { id: string }).id;
  }

  const { error: userMsgError } = await supabase.rpc("append_financial_ai_message", {
    p_conversation_id: convId,
    p_role: "user",
    p_content: message,
  });
  if (userMsgError) {
    return NextResponse.json({ error: userMsgError.message }, { status: 500 });
  }

  /** Prior turns for multi-turn LLM (includes the user message just appended). */
  let historyForLlm: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: message },
  ];
  const { data: thread } = await supabase.rpc("get_financial_ai_conversation", {
    p_conversation_id: convId,
  });
  if (thread && typeof thread === "object") {
    const msgs = (thread as { messages?: { role?: string; content?: string }[] }).messages ?? [];
    historyForLlm = msgs
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string,
      }))
      .slice(-12);
    if (historyForLlm.length === 0) {
      historyForLlm = [{ role: "user", content: message }];
    }
  }

  let answer: string;
  let source: string;
  let context: unknown;
  let toolsUsed: string[] = [];

  const useLlm =
    aiSettings.financial_ai_provider === "openai" && Boolean(getFinancialAiApiKey());

  if (useLlm) {
    const { data: ctx, error: ctxError } = await supabase.rpc("build_financial_ai_context", {
      p_org_id: orgId,
      p_from: from,
      p_to: to,
    });
    if (ctxError) {
      return NextResponse.json({ error: ctxError.message }, { status: 500 });
    }
    context = ctx;

    try {
      const result = await completeFinancialAiChatWithTools({
        model: aiSettings.financial_ai_model ?? "gpt-4o-mini",
        messages: historyForLlm,
        context: ctx,
        orgId,
        from,
        to,
        conversationId: convId,
        supabase,
      });
      answer = result.answer;
      source = result.source;
      toolsUsed = result.toolsUsed;
    } catch (err) {
      const fallback = await supabase.rpc("resolve_financial_ai_question", {
        p_org_id: orgId,
        p_question: message,
        p_from: from,
        p_to: to,
      });
      if (fallback.error || !fallback.data) {
        const msg = err instanceof Error ? err.message : "AI request failed";
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      const fb = fallback.data as { answer?: string; source?: string; context?: unknown };
      answer = fb.answer ?? "Unable to generate a response.";
      source = "internal_fallback";
      context = fb.context;
    }
  } else {
    const { data: resolved, error: resolveError } = await supabase.rpc("resolve_financial_ai_question", {
      p_org_id: orgId,
      p_question: message,
      p_from: from,
      p_to: to,
    });
    if (resolveError || !resolved) {
      return NextResponse.json({ error: resolveError?.message ?? "Failed to resolve question" }, { status: 500 });
    }
    const res = resolved as { answer?: string; source?: string; context?: unknown };
    answer = res.answer ?? "No answer available.";
    source = res.source ?? "internal";
    context = res.context;
  }

  const { data: assistantMsg, error: assistantError } = await supabase.rpc("append_financial_ai_message", {
    p_conversation_id: convId,
    p_role: "assistant",
    p_content: answer,
    p_metadata: { source, tools_used: toolsUsed },
  });
  if (assistantError) {
    return NextResponse.json({ error: assistantError.message }, { status: 500 });
  }

  return NextResponse.json({
    conversationId: convId,
    message: assistantMsg,
    answer,
    source,
    toolsUsed,
    contextAvailable: Boolean(context),
  });
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { Bot, Loader2, Sparkles, Trash2 } from "lucide-react";

export type FinancialAiSettings = {
  financial_ai_enabled: boolean;
  financial_ai_provider: string;
  financial_ai_model: string;
  llm_configured_note?: string;
};

export type FinancialAiSuggestedPrompt = {
  key: string;
  label: string;
  prompt: string;
};

export type FinancialAiInsight = {
  id: string;
  insight_type: string;
  severity: string;
  title: string;
  summary: string;
  period_from?: string;
  period_to?: string;
  created_at?: string;
};

export type FinancialAiMessage = {
  id: string;
  role: string;
  content: string;
  metadata?: { source?: string };
  created_at?: string;
};

export function FinancialAssistantTab({
  orgId,
  from,
  to,
  canManage,
  settings: initialSettings,
  suggestedPrompts,
  insights: initialInsights,
  initialConversationId,
  initialMessages,
}: {
  orgId: string;
  from: string;
  to: string;
  canManage: boolean;
  settings: FinancialAiSettings;
  suggestedPrompts: FinancialAiSuggestedPrompt[];
  insights: FinancialAiInsight[];
  initialConversationId?: string | null;
  initialMessages: FinancialAiMessage[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [settings, setSettings] = useState(initialSettings);
  const [insights, setInsights] = useState(initialInsights);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<FinancialAiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_financial_ai_settings", {
      p_org_id: orgId,
      p_financial_ai_enabled: settings.financial_ai_enabled,
      p_financial_ai_provider: settings.financial_ai_provider,
      p_financial_ai_model: settings.financial_ai_model,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setSettings(data as FinancialAiSettings);
    toast({ title: "Assistant settings saved" });
    router.refresh();
  }

  async function refreshInsights() {
    if (!canManage) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.rpc("generate_financial_ai_insights", {
      p_org_id: orgId,
      p_from: from,
      p_to: to,
    });
    const { data } = await supabase.rpc("list_financial_ai_insights", {
      p_org_id: orgId,
      p_from: from,
      p_to: to,
    });
    setInsights((data as FinancialAiInsight[]) ?? []);
    setBusy(false);
    toast({ title: "Insights refreshed" });
  }

  async function sendMessage(text: string) {
    const question = text.trim();
    if (!question || busy || !settings.financial_ai_enabled) return;

    setBusy(true);
    setInput("");

    const optimisticUser: FinancialAiMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: question,
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const res = await fetch("/api/financials/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          conversationId: conversationId ?? undefined,
          message: question,
          from,
          to,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        conversationId?: string;
        answer?: string;
        source?: string;
      };

      if (!res.ok) {
        throw new Error(json.error ?? "Request failed");
      }

      if (json.conversationId) {
        setConversationId(json.conversationId);
      }

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        optimisticUser,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: json.answer ?? "",
          metadata: { source: json.source },
        },
      ]);

      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      toast({
        title: "Assistant error",
        description: err instanceof Error ? err.message : "Failed to send message",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function newConversation() {
    setConversationId(null);
    setMessages([]);
  }

  const severityClass = (severity: string) => {
    if (severity === "critical") return "border-destructive/50 bg-destructive/5";
    if (severity === "warning") return "border-amber-500/40 bg-amber-500/5";
    return "border-border bg-muted/30";
  };

  return (
    <div className="space-y-6">
      {canManage && (
        <ReportSection title="Assistant settings" subtitle="Enable AI Q&A and choose provider">
          <form onSubmit={saveSettings} className="grid gap-4 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.financial_ai_enabled}
                disabled={busy}
                onChange={(e) => setSettings((s) => ({ ...s, financial_ai_enabled: e.target.checked }))}
              />
              Enable financial assistant
            </label>
            <div>
              <Label htmlFor="ai-provider">Provider</Label>
              <select
                id="ai-provider"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={settings.financial_ai_provider}
                disabled={busy}
                onChange={(e) => setSettings((s) => ({ ...s, financial_ai_provider: e.target.value }))}
              >
                <option value="internal">Internal (rule-based)</option>
                <option value="openai">OpenAI (requires API key)</option>
              </select>
            </div>
            <div>
              <Label htmlFor="ai-model">Model</Label>
              <Input
                id="ai-model"
                value={settings.financial_ai_model}
                disabled={busy || settings.financial_ai_provider !== "openai"}
                onChange={(e) => setSettings((s) => ({ ...s, financial_ai_model: e.target.value }))}
              />
            </div>
            <div className="md:col-span-3">
              <Button type="submit" disabled={busy}>
                Save settings
              </Button>
              <p className="mt-2 text-sm text-muted-foreground">{settings.llm_configured_note}</p>
            </div>
          </form>
        </ReportSection>
      )}

      <ReportSection
        title="Insights"
        subtitle={`Rule-based flags for ${from} to ${to}`}
        actions={
          canManage ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refreshInsights()}>
              <Sparkles className="mr-2 h-4 w-4" />
              Refresh insights
            </Button>
          ) : null
        }
      >
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">No insights for this period yet.</p>
        ) : (
          <ul className="space-y-2">
            {insights.map((insight) => (
              <li key={insight.id} className={`rounded-lg border p-3 ${severityClass(insight.severity)}`}>
                <p className="font-medium">{insight.title}</p>
                <p className="text-sm text-muted-foreground">{insight.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </ReportSection>

      <ReportSection
        title="Ask your finances"
        subtitle="Questions use live GL, treasury, and aging data for the selected period"
        actions={
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void newConversation()}>
            <Trash2 className="mr-2 h-4 w-4" />
            New chat
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {suggestedPrompts.map((p) => (
            <Button
              key={p.key}
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || !settings.financial_ai_enabled}
              onClick={() => void sendMessage(p.prompt)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div
          ref={scrollRef}
          className="mb-4 max-h-[420px] space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-4"
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <Bot className="h-8 w-8" />
              <p className="text-sm">Ask about revenue, profit, cash, AR, AP, or overall health.</p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border bg-background"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.metadata?.source && m.role === "assistant" && (
                    <p className="mt-1 text-xs opacity-70">via {m.metadata.source}</p>
                  )}
                </div>
              </div>
            ))
          )}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking…
            </div>
          )}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
        >
          <Label htmlFor="financial-ai-question" className="sr-only">
            Ask your finances
          </Label>
          <Input
            id="financial-ai-question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. How is net profit this month?"
            aria-label="Ask your finances"
            disabled={busy || !settings.financial_ai_enabled}
          />
          <Button type="submit" disabled={busy || !input.trim() || !settings.financial_ai_enabled}>
            Send
          </Button>
        </form>
      </ReportSection>
    </div>
  );
}

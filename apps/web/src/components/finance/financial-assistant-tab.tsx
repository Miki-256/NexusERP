"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ReportSection } from "@/components/finance/report-section";
import { dateRangeForPreset, type DatePreset } from "@/lib/finance-dates";
import { replaceTenantUrl } from "@/lib/tenant-scroll";
import type { FinancialShellTab } from "@/lib/finance/financial-shell-config";
import {
  conversationExportFilename,
  downloadTextFile,
  formatFinancialAiTranscript,
} from "@/lib/financial-ai/export";
import { Bot, Copy, Download, Loader2, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type FinancialAiSettings = {
  financial_ai_enabled: boolean;
  financial_ai_provider: string;
  financial_ai_model: string;
  financial_ai_retention_days?: number;
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
  metadata?: { source?: string; tools_used?: string[] };
  created_at?: string;
};

export type FinancialAiConversationSummary = {
  id: string;
  title: string;
  period_from?: string | null;
  period_to?: string | null;
  updated_at?: string;
  message_count?: number;
};

const PERIOD_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "month", label: "MTD" },
  { key: "last_month", label: "Last month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "YTD" },
];

function insightDeepLink(
  insight: FinancialAiInsight,
  fallbackFrom: string,
  fallbackTo: string
): { tab: FinancialShellTab; label: string; href: string } {
  const from = insight.period_from ?? fallbackFrom;
  const to = insight.period_to ?? fallbackTo;
  const map: Record<string, { tab: FinancialShellTab; label: string }> = {
    low_margin: { tab: "pnl", label: "Open P&L" },
    high_opex_ratio: { tab: "pnl", label: "Open P&L" },
    ar_overdue: { tab: "aging", label: "Open Aging" },
    negative_cash: { tab: "treasury", label: "Open Treasury" },
  };
  const target = map[insight.insight_type] ?? { tab: "executive" as FinancialShellTab, label: "Open Executive" };
  const params = new URLSearchParams({ tab: target.tab, from, to });
  return { ...target, href: `/financials?${params.toString()}` };
}

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPending, startTransition] = useTransition();

  const [settings, setSettings] = useState(initialSettings);
  const [insights, setInsights] = useState(initialInsights);
  const [conversations, setConversations] = useState<FinancialAiConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<FinancialAiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const deepLinkOpened = useRef(false);

  const activeTitle =
    conversations.find((c) => c.id === conversationId)?.title?.trim() || "Financial Q&A";

  function syncConversationQuery(nextId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "assistant");
    if (nextId) params.set("conversation", nextId);
    else params.delete("conversation");
    startTransition(() => {
      replaceTenantUrl(router, pathname, params);
    });
  }

  function conversationDeepLink(id: string | null) {
    if (typeof window === "undefined" || !id) return undefined;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "assistant");
    params.set("conversation", id);
    params.set("from", from);
    params.set("to", to);
    return `${window.location.origin}${pathname}?${params.toString()}`;
  }

  async function loadConversations() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_financial_ai_conversations", {
      p_org_id: orgId,
      p_limit: 30,
    });
    if (error) {
      toast({ title: "Could not load chats", description: error.message, variant: "destructive" });
      setConversations([]);
    } else {
      setConversations(Array.isArray(data) ? (data as FinancialAiConversationSummary[]) : []);
    }
    setLoadingList(false);
  }

  useEffect(() => {
    void loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per org
  }, [orgId]);

  useEffect(() => {
    setInsights(initialInsights);
  }, [initialInsights]);

  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      ...initialSettings,
      financial_ai_retention_days: initialSettings.financial_ai_retention_days ?? prev.financial_ai_retention_days ?? 90,
    }));
  }, [initialSettings]);

  useEffect(() => {
    if (deepLinkOpened.current) return;
    const id = searchParams.get("conversation");
    if (!id) return;
    deepLinkOpened.current = true;
    void openConversation(id, { skipUrlSync: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open deep link once
  }, [orgId, searchParams]);

  function applyPeriod(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "assistant");
    params.set("from", nextFrom);
    params.set("to", nextTo);
    if (conversationId) params.set("conversation", conversationId);
    startTransition(() => {
      replaceTenantUrl(router, pathname, params);
    });
  }

  async function openConversation(id: string, opts?: { skipUrlSync?: boolean }) {
    if (busy || loadingThread) return;
    setLoadingThread(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_financial_ai_conversation", {
      p_conversation_id: id,
    });
    setLoadingThread(false);
    if (error || !data) {
      toast({
        title: "Could not open chat",
        description: error?.message ?? "Conversation not found",
        variant: "destructive",
      });
      return;
    }
    const thread = data as {
      id: string;
      period_from?: string | null;
      period_to?: string | null;
      messages?: FinancialAiMessage[];
    };
    setConversationId(thread.id);
    setMessages(thread.messages ?? []);
    if (!opts?.skipUrlSync) {
      syncConversationQuery(thread.id);
    }
    if (thread.period_from && thread.period_to && (thread.period_from !== from || thread.period_to !== to)) {
      applyPeriod(thread.period_from, thread.period_to);
    }
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  async function deleteConversation(id: string) {
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("delete_financial_ai_conversation", {
      p_conversation_id: id,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    if (conversationId === id) {
      setConversationId(null);
      setMessages([]);
      syncConversationQuery(null);
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    toast({ title: "Chat deleted" });
  }

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
      p_financial_ai_retention_days: settings.financial_ai_retention_days ?? 90,
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

  async function purgeHistory() {
    if (!canManage) return;
    const days = settings.financial_ai_retention_days ?? 90;
    if (days <= 0) {
      toast({
        title: "Set retention days first",
        description: "Retention is unlimited (0). Choose a positive day count, save, then purge.",
        variant: "destructive",
      });
      return;
    }
    if (
      !window.confirm(
        `Delete AI conversations and insights older than ${days} days for this organization?`
      )
    ) {
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("purge_financial_ai_history", {
      p_org_id: orgId,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Purge failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as {
      deleted_conversations?: number;
      deleted_insights?: number;
    };
    toast({
      title: "History purged",
      description: `Removed ${result.deleted_conversations ?? 0} chats and ${result.deleted_insights ?? 0} insights.`,
    });
    void loadConversations();
    if (conversationId) {
      setConversationId(null);
      setMessages([]);
      syncConversationQuery(null);
    }
    router.refresh();
  }

  function exportConversation() {
    const md = formatFinancialAiTranscript({
      title: activeTitle,
      from,
      to,
      messages,
      deepLink: conversationDeepLink(conversationId),
    });
    downloadTextFile(conversationExportFilename(activeTitle, conversationId), md);
    toast({ title: "Exported markdown transcript" });
  }

  async function shareConversation() {
    const md = formatFinancialAiTranscript({
      title: activeTitle,
      from,
      to,
      messages,
      deepLink: conversationDeepLink(conversationId),
    });
    try {
      await navigator.clipboard.writeText(md);
      toast({ title: "Copied transcript + link" });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard permission denied",
        variant: "destructive",
      });
    }
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
        toolsUsed?: string[];
      };

      if (!res.ok) {
        throw new Error(json.error ?? "Request failed");
      }

      if (json.conversationId) {
        setConversationId(json.conversationId);
        syncConversationQuery(json.conversationId);
      }

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        optimisticUser,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: json.answer ?? "",
          metadata: {
            source: json.source,
            tools_used: json.toolsUsed ?? [],
          },
        },
      ]);

      void loadConversations();

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

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    syncConversationQuery(null);
  }

  const severityClass = (severity: string) => {
    if (severity === "critical") return "border-destructive/50 bg-destructive/5";
    if (severity === "warning") return "border-amber-500/40 bg-amber-500/5";
    return "border-border bg-muted/30";
  };

  return (
    <div className="space-y-6">
      {canManage && (
        <ReportSection title="Assistant settings" subtitle="Enable AI Q&A, provider, and retention">
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
            <div>
              <Label htmlFor="ai-retention">Retention (days)</Label>
              <Input
                id="ai-retention"
                type="number"
                min={0}
                max={3650}
                value={settings.financial_ai_retention_days ?? 90}
                disabled={busy}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    financial_ai_retention_days: Number(e.target.value) || 0,
                  }))
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">0 keeps history forever</p>
            </div>
            <div className="md:col-span-3 flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy}>
                Save settings
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void purgeHistory()}>
                Purge older than retention
              </Button>
              <p className="w-full text-sm text-muted-foreground">{settings.llm_configured_note}</p>
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
            {insights.map((insight) => {
              const link = insightDeepLink(insight, from, to);
              return (
                <li key={insight.id} className={`rounded-lg border p-3 ${severityClass(insight.severity)}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{insight.title}</p>
                      <p className="text-sm text-muted-foreground">{insight.summary}</p>
                    </div>
                    <Button asChild type="button" variant="outline" size="sm">
                      <Link href={link.href}>{link.label}</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ReportSection>

      <ReportSection
        title="Ask your finances"
        subtitle="Multi-turn Q&A over live GL, treasury, and aging data for the selected period"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || messages.length === 0}
              onClick={exportConversation}
            >
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || messages.length === 0}
              onClick={() => void shareConversation()}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={newConversation}>
              <MessageSquarePlus className="mr-2 h-4 w-4" />
              New chat
            </Button>
          </div>
        }
      >
        <div className={cn("mb-4 flex flex-wrap gap-1.5", isPending && "opacity-80")}>
          {PERIOD_PRESETS.map((p) => {
            const range = dateRangeForPreset(p.key);
            const active = from === range.from && to === range.to;
            return (
              <Button
                key={p.key}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                className="h-8"
                disabled={busy}
                onClick={() => applyPeriod(range.from, range.to)}
              >
                {p.label}
              </Button>
            );
          })}
          <span className="self-center text-xs text-muted-foreground">
            {from} → {to}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="rounded-lg border bg-muted/10 p-2">
            <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Conversations
            </p>
            {loadingList ? (
              <p className="px-1 py-4 text-sm text-muted-foreground">Loading…</p>
            ) : conversations.length === 0 ? (
              <p className="px-1 py-4 text-sm text-muted-foreground">No saved chats yet.</p>
            ) : (
              <ul className="max-h-[420px] space-y-1 overflow-y-auto">
                {conversations.map((c) => {
                  const active = c.id === conversationId;
                  return (
                    <li key={c.id}>
                      <div
                        className={cn(
                          "group flex items-start gap-1 rounded-md border px-2 py-1.5",
                          active ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted/40"
                        )}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          disabled={busy || loadingThread}
                          onClick={() => void openConversation(c.id)}
                        >
                          <p className="truncate text-sm font-medium">{c.title || "Untitled"}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {c.message_count ?? 0} msgs
                            {c.period_from && c.period_to ? ` · ${c.period_from}` : ""}
                          </p>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 opacity-70 group-hover:opacity-100"
                          disabled={busy}
                          aria-label={`Delete ${c.title || "conversation"}`}
                          onClick={() => void deleteConversation(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <div>
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
              {loadingThread ? (
                <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading conversation…
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Bot className="h-8 w-8" />
                  <p className="text-sm">Ask about revenue, profit, cash, AR, AP, or overall health.</p>
                  <p className="text-xs">Follow-ups stay in this thread with the same period context.</p>
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
                      {m.role === "assistant" && (m.metadata?.source || (m.metadata?.tools_used?.length ?? 0) > 0) && (
                        <p className="mt-1 text-xs opacity-70">
                          {m.metadata?.source ? `via ${m.metadata.source}` : null}
                          {(m.metadata?.tools_used?.length ?? 0) > 0
                            ? `${m.metadata?.source ? " · " : ""}tools: ${[...new Set(m.metadata!.tools_used!)].join(", ")}`
                            : null}
                        </p>
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
          </div>
        </div>
      </ReportSection>
    </div>
  );
}

/** Conversation export helpers for AI Assistant L4. */

export type ExportableAiMessage = {
  role: string;
  content: string;
  created_at?: string;
  metadata?: { source?: string; tools_used?: string[] };
};

export function formatFinancialAiTranscript(params: {
  title: string;
  from: string;
  to: string;
  messages: ExportableAiMessage[];
  deepLink?: string;
}): string {
  const lines: string[] = [
    `# ${params.title.trim() || "Financial Q&A"}`,
    `Period: ${params.from} → ${params.to}`,
    "",
  ];

  if (params.deepLink) {
    lines.push(`Link: ${params.deepLink}`, "");
  }

  if (params.messages.length === 0) {
    lines.push("_No messages._");
    return lines.join("\n");
  }

  for (const m of params.messages) {
    const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : m.role;
    const when = m.created_at ? ` (${m.created_at})` : "";
    lines.push(`## ${role}${when}`, "", m.content.trim(), "");
    if (m.role === "assistant" && m.metadata?.source) {
      const tools =
        m.metadata.tools_used && m.metadata.tools_used.length > 0
          ? ` · tools: ${[...new Set(m.metadata.tools_used)].join(", ")}`
          : "";
      lines.push(`_via ${m.metadata.source}${tools}_`, "");
    }
  }

  return lines.join("\n").trim() + "\n";
}

export function downloadTextFile(filename: string, content: string, mime = "text/markdown;charset=utf-8") {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function conversationExportFilename(title: string, conversationId?: string | null): string {
  const slug = (title || "financial-qa")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const suffix = conversationId ? conversationId.slice(0, 8) : "draft";
  return `${slug || "financial-qa"}-${suffix}.md`;
}

# EFM Wave 16 — AI Financial Assistant

**Status:** Complete (code) — apply migrations `00162` → `00163` on Supabase; L4 needs `00184`.  
**L2 (conversation UX):** shipped — multi-turn context, sidebar history, period chips, insight deep-links.  
**L3 (tool loop):** shipped in app — OpenAI may call read-only finance RPCs before answering.  
**L4 (export / retention):** shipped — markdown export/copy, conversation deep-links, retention days + manager purge.  
**L5 (scheduled purge):** shipped — `run_financial_ai_retention_purge` via daily process-queue cron (`00185`).

Wave 16 adds an AI financial assistant: conversational Q&A over live GL/treasury/aging context, rule-based insights, optional OpenAI integration, and conversation history.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| AI assistant schema | `20260618000162_efm_wave16_ai_assistant.sql` | Conversations, messages, insights |
| AI assistant RPCs | `20260618000163_efm_wave16_ai_assistant_rpcs.sql` | Context, Q&A, insights, chat CRUD |
| Assistant tab | `financial-assistant-tab.tsx` | Chat UI, insights, settings |
| Chat API | `api/financials/ai/chat/route.ts` | OpenAI or internal fallback |
| Provider lib | `lib/financial-ai/provider.ts` | OpenAI-compatible client |

## RPCs (Wave 16)

| RPC | Purpose |
|-----|---------|
| `get_financial_ai_settings` | Org AI enable, provider, model |
| `update_financial_ai_settings` | Update assistant configuration |
| `list_financial_ai_suggested_prompts` | Starter questions |
| `build_financial_ai_context` | P&L, BS, CF, executive, AR/AP, treasury snapshot |
| `resolve_financial_ai_question` | Rule-based answers (no LLM required) |
| `generate_financial_ai_insights` | Margin, AR, cash, opex rule flags |
| `list_financial_ai_insights` | Insight history for period |
| `list_financial_ai_conversations` | User conversation list |
| `create_financial_ai_conversation` | New thread |
| `get_financial_ai_conversation` | Thread + messages |
| `append_financial_ai_message` | Persist chat message |
| `delete_financial_ai_conversation` | Remove thread |

## Providers

- **Internal (default)** — keyword-driven answers from `build_financial_ai_context`; always available.
- **OpenAI** — set org provider to `openai` and configure `FINANCIAL_AI_API_KEY` or `OPENAI_API_KEY` in app env. Falls back to internal if the LLM call fails.

Optional env:

```bash
FINANCIAL_AI_API_KEY=sk-...
FINANCIAL_AI_BASE_URL=https://api.openai.com/v1  # optional
OPENAI_API_KEY=sk-...                             # alternative
```

## Insights (rule-based)

| Type | Trigger |
|------|---------|
| `low_margin` | Net margin &lt; 5% with revenue &gt; 0 |
| `ar_overdue` | 30+ day AR &gt; 30% of total |
| `negative_cash` | Closing cash &lt; 0 |
| `high_opex_ratio` | OpEx &gt; 50% of revenue |

## Apply migrations

```bash
# After Wave 15 (00160–00161):
# 00162 — EFM Wave 16 schema
# 00163 — EFM Wave 16 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Assistant** — chat, suggested prompts, insights panel, manager settings
- Deep link: `/financials?tab=assistant&from=…&to=…`

## L2 — Conversation UX

| Capability | Behavior |
|------------|----------|
| Conversation sidebar | `list_financial_ai_conversations` / `get` / `delete`; reopen prior threads |
| Multi-turn LLM | Chat API loads last ~12 user/assistant turns via `get_financial_ai_conversation` before calling the provider |
| Period chips | MTD / Last month / Quarter / YTD in the assistant (updates `from`/`to` query params) |
| Insight deep-links | `low_margin` / `high_opex_ratio` → P&L; `ar_overdue` → Aging; `negative_cash` → Treasury |
| New chat titles | First message (trimmed) used as conversation title on create |

## L3 — Read tools + tool loop

When org provider is `openai` and an API key is configured, the chat API runs `completeFinancialAiChatWithTools`:

| Piece | Location | Notes |
|-------|----------|-------|
| Tool schemas | `lib/financial-ai/tools.ts` | 8 read-only tools |
| Executor | same | Calls existing SECURITY DEFINER RPCs under the user session |
| Loop | `lib/financial-ai/provider.ts` | Max 3 tool rounds, truncated payloads |
| Metadata | message `tools_used` + API `toolsUsed` | Shown under assistant replies |

| Tool | RPC |
|------|-----|
| `get_pnl` | `profit_and_loss` |
| `get_balance_sheet` | `balance_sheet` |
| `get_cash_flow` | `cash_flow` |
| `get_ar_aging` | `accounts_receivable_aging` |
| `get_ap_aging` | `accounts_payable_aging` |
| `get_treasury` | `get_treasury_cash_position` |
| `get_executive_dashboard` | `get_executive_financial_dashboard` |
| `get_period_snapshot` | `build_financial_ai_context` |

Internal (non-LLM) answers still use `resolve_financial_ai_question` only.

## L4 — Export, share, retention

| Capability | Behavior |
|------------|----------|
| Export | Download current thread as markdown (`.md`) |
| Copy / share | Clipboard transcript includes deep link |
| Deep link | `/financials?tab=assistant&conversation=<uuid>&from=&to=` |
| Retention | Org column `financial_ai_retention_days` (default 90; `0` = keep forever) |
| Purge | Manager RPC `purge_financial_ai_history` deletes old conversations + insights |

Migration: `20260618000184_efm_ai_assistant_l4.sql` (updates `get`/`update_financial_ai_settings`, adds purge).

## L5 — Scheduled retention

| Piece | Notes |
|-------|-------|
| RPC | `run_financial_ai_retention_purge()` — service_role only; skips orgs with retention `0` |
| Cron | Invoked from `runProcessQueue` (daily `/api/webhooks/process-queue`) |
| Response | `financial_ai_retention` summary on process-queue JSON |

Migration: `20260618000185_efm_ai_assistant_l5_retention_cron.sql`.

## Next (L6+)

- Optional write tools behind dual-control (draft JE suggestions only)
- Shared / team conversations (beyond owner + manager read)

See `docs/EFM_ROADMAP.md`.

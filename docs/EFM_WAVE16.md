# EFM Wave 16 — AI Financial Assistant

**Status:** Complete (code) — apply migrations `00162` → `00163` on Supabase.

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

## Next

EFM functional waves 0–17 are code-complete. Extend Fiori shell patterns to other tenant apps as needed.

See `docs/EFM_ROADMAP.md`.

# EFM Wave 1 — Enterprise GL Core

**Status:** Complete (code) — apply migrations `00130` + `00131` on Supabase.

Wave 1 extends the general ledger with hierarchical chart of accounts, journal entry lifecycle controls, opening balance import, and allocation rule infrastructure.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| COA hierarchy columns | `20260618000130_efm_wave1_enterprise_gl.sql` | `parent_account_id`, `is_postable`, `sort_order` |
| JE reversal links | same | `reversal_entry_id`, `reversed_entry_id`, `reversed_at`, `reversed_by` |
| JE attachments table | same | Metadata + URL; RLS |
| JE audit log | same | Append-only action log |
| Allocation rules table | same | Spread source account across targets |
| Recurring JE auto-reverse | same | `auto_reverse`, `reversal_days` on templates |
| Enterprise GL RPCs | `20260618000131_efm_wave1_enterprise_gl_rpcs.sql` | See RPC list below |
| COA tree UI | `chart-of-accounts-tab.tsx` | Parent account, postable flag, indented tree |
| Opening balance wizard | `opening-balance-wizard.tsx` | Calls `import_opening_balances` |
| Ledger reverse action | `ledger-entries-tab.tsx` | `reverse_journal_entry` for posted entries |
| Manual JE postable filter | `manual-journal-tab.tsx` | Blocks header accounts in line picker |
| RPC types | `apps/web/src/types/database.ts` | Wave 1 function signatures |
| Integration tests | `tests/integration/finance.integration.test.ts` | `list_accounts` hierarchy + `list_accounts_tree` |
| Verify probes | `scripts/verify-supabase-migrations.mjs` | Wave 1 RPC existence |

## RPCs (Wave 1)

| RPC | Purpose |
|-----|---------|
| `list_accounts` | Flat COA with hierarchy fields |
| `list_accounts_tree` | Recursive tree with `depth` |
| `upsert_account` | **9-arg** signature (parent, postable, sort order) |
| `reverse_journal_entry` | Mirror posted entry; link originals |
| `import_opening_balances` | Balanced opening JE via `GEN` journal |
| `link_journal_entry_attachment` | Attach file metadata to JE |
| `list_journal_entry_attachments` | List attachments for entry |
| `list_journal_entry_audit_log` | Immutable audit trail |
| `list_allocation_rules` / `upsert_allocation_rule` / `run_allocation_rule` | Cost allocation engine |
| `post_accrual_with_reversal` | Accrual + scheduled auto-reverse |

`_post_journal_entry_balanced` now enforces postable accounts on posted entries.

## Breaking change

`upsert_account` dropped the old 6-arg overload. All callers must pass `p_parent_account_id`, `p_is_postable`, and `p_sort_order` (UI updated).

## Apply migrations

```bash
# After Wave 0 (00128–00129):
# 00130 — EFM Wave 1 schema
# 00131 — EFM Wave 1 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → COA** — hierarchical tree, header vs postable accounts
- **Financials → Journal** — opening balance wizard above manual journal form
- **Financials → Ledger** — reverse button for eligible posted entries (managers only)

Allocation rules UI is deferred; RPCs are ready for Wave 4 close / cost accounting tabs.

## Next wave

**EFM Wave 3 — Enterprise AP:** standalone vendor bills, payment runs, 3-way match.

See `docs/EFM_ROADMAP.md`.

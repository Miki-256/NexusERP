# EFM Wave 6 — Consolidation & Intercompany

**Status:** Complete (code) — apply migrations `00142` → `00143` on Supabase.

Wave 6 upgrades group consolidation with FX translation (Wave 5 rates), ownership weighting, virtual intercompany elimination, and paired IC invoice posting.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Consolidation schema | `20260618000142_efm_wave6_consolidation.sql` | Reporting currency, IC relationships/transactions, run audit |
| Consolidation RPCs | `20260618000143_efm_wave6_consolidation_rpcs.sql` | Translation, elimination, IC posting |
| Consolidation tab | `consolidation-tab.tsx` | Group setup, FX warning, IC matrix, IC invoices |

## RPCs (Wave 6)

| RPC | Purpose |
|-----|---------|
| `_consolidation_translate_amount` | Convert member amounts to group reporting currency |
| `upsert_consolidation_group` | **Extended** — reporting currency, elimination method, member ownership |
| `list_consolidation_groups` | **Updated** — member currency + ownership |
| `consolidated_profit_and_loss` | **Updated** — FX translation + ownership weighting |
| `consolidated_balance_sheet` | **Updated** — translation + virtual IC elimination |
| `upsert_intercompany_relationship` | Map org pairs to IC GL accounts |
| `list_intercompany_relationships` | IC relationship list |
| `post_intercompany_invoice` | Post matching AR/AP in seller + buyer orgs |
| `list_intercompany_transactions` | IC transaction history |
| `get_intercompany_matrix` | IC receivable/payable by member org |
| `preview_consolidation_eliminations` | Virtual elimination preview |
| `save_consolidation_run` | Audit snapshot of consolidated output |
| `ensure_default_accounts` | **Updated** — 1150 IC Receivable, 2150 IC Payable, IC journal |

## Model

- **Reporting currency** on `consolidation_groups` (defaults to parent org currency).
- **Translation** uses exchange rates on the parent org (`organization_id` on the group).
- **Ownership %** on members scales translated amounts (default 100%).
- **Virtual elimination** subtracts `min(total IC AR, total IC AP)` from consolidated assets and liabilities.
- **IC accounts:** 1150 (receivable), 2150 (payable) per org.

## Breaking change

`upsert_consolidation_group` gained optional `p_reporting_currency` and `p_elimination_method`. Existing 4-arg callers still work via defaults.

Members in `p_member_org_ids` may be UUID strings **or** objects `{ id, ownership_percent, member_role }`.

## Apply migrations

```bash
# After Wave 5 (00140–00141):
# 00142 — EFM Wave 6 schema
# 00143 — EFM Wave 6 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Consolidation** — group setup, translated P&L/BS, IC elimination preview, IC invoice posting

## Prerequisites

Multi-currency groups require exchange rates on the **parent org** (Financials → FX).

## Next wave

**EFM Wave 8 — Tax compliance & e-invoicing.**

See `docs/EFM_ROADMAP.md`.

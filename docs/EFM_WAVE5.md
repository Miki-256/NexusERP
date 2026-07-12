# EFM Wave 5 — Multi-Currency & FX Revaluation

**Status:** Complete (code) — apply migrations `00140` → `00141` on Supabase.

Wave 5 adds exchange rate maintenance, foreign-currency journal lines, period-end unrealized FX revaluation, and close-checklist integration for FC accounts.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Multi-currency schema | `20260618000140_efm_wave5_multi_currency.sql` | Rates, revaluation runs, JEL FX columns |
| FX RPCs | `20260618000141_efm_wave5_multi_currency_rpcs.sql` | See RPC list below |
| FX tab | `fx-currencies-tab.tsx` | Rates, preview, run revaluation, history |
| Banking upgrades | `banking-tab.tsx` | Per-account currency, FC badge |

## RPCs (Wave 5)

| RPC | Purpose |
|-----|---------|
| `list_exchange_rates` / `upsert_exchange_rate` | Rate maintenance (foreign → functional) |
| `get_exchange_rate` | Lookup rate as of date |
| `post_foreign_currency_journal` | Post balanced FC journal (auto-converts to functional) |
| `get_foreign_currency_balances` | FC exposure with unrealized adjustment |
| `preview_fx_revaluation` | Preview period-end adjustments |
| `run_fx_revaluation` | Post unrealized gain/loss JE (4910/4920) |
| `list_fx_revaluation_runs` / `reverse_fx_revaluation` | Audit trail + undo |
| `_post_journal_entry_balanced` | **Updated** — optional `transactionCurrency` / `transactionDebit` / `transactionCredit` / `exchangeRate` on lines |
| `list_bank_accounts` / `upsert_bank_account` | **Updated** — FC flag, tags GL `currency_code` |
| `ensure_default_accounts` | **Updated** — adds 4910/4920 FX accounts + FX journal |
| `ensure_default_close_checklist` | **Updated** — optional `fx_revaluation` task |

## Model

- **Functional currency** = `organizations.currency` (unchanged; all GL amounts remain functional).
- **Exchange rate** = 1 unit of foreign currency × rate = functional amount.
- **Foreign balances** derived from JEL transaction amounts or bank statement lines on FC bank accounts.
- **Revaluation** posts Dr/Cr to monetary account vs 4910 (gain) or 4920 (loss).

## Apply migrations

```bash
# After Wave 4 (00138–00139):
# 00140 — EFM Wave 5 schema
# 00141 — EFM Wave 5 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → FX** — exchange rates, revaluation preview/run, history
- **Financials → Banking** — currency column, FC badge, currency on create
- **Financials → Periods** — close checklist includes FX revaluation warning (non-blocking by default)

## Deferred to Wave 6

- Consolidation translation (mixed-currency group rollup)
- AR/AP document currency
- Realized FX on payment settlement

## Next wave

**EFM Wave 7 — Treasury & advanced banking.**

See `docs/EFM_ROADMAP.md`.

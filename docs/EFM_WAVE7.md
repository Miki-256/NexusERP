# EFM Wave 7 — Treasury & Advanced Banking

**Status:** Complete (code) — apply migrations `00144` → `00145` on Supabase.

Wave 7 adds enterprise treasury: consolidated cash position, liquidity forecast, internal bank transfers, and bank account treasury settings.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Treasury schema | `20260618000144_efm_wave7_treasury.sql` | Transfers, bank account type/target/min |
| Treasury RPCs | `20260618000145_efm_wave7_treasury_rpcs.sql` | Position, forecast, transfers |
| Treasury tab | `treasury-tab.tsx` | Cash dashboard, transfers, forecast |

## RPCs (Wave 7)

| RPC | Purpose |
|-----|---------|
| `get_treasury_cash_position` | Liquid cash across bank, cash on hand (1000), mobile (1020) |
| `get_treasury_liquidity_forecast` | 30-day AR/AP due-date forecast + weekly buckets |
| `create_treasury_transfer` | Post internal transfer between bank GL accounts |
| `list_treasury_transfers` | Transfer history |
| `update_bank_account_treasury_settings` | Account type, target/minimum balance |
| `list_bank_accounts` | **Updated** — treasury metadata fields |

## Model

- **Total liquid** = sum of bank GL balances + cash on hand + mobile money.
- **Forecast** uses open AR/AP by due date and pending AP payment runs (Wave 3).
- **Transfers** post Dr destination bank GL / Cr source bank GL via BNK journal.
- **Bank account types:** `operating`, `savings`, `petty_cash`, `mobile_wallet`.

## Apply migrations

```bash
# After Wave 6 (00142–00143):
# 00144 — EFM Wave 7 schema
# 00145 — EFM Wave 7 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Treasury** — cash position, liquidity forecast, internal transfers
- **Financials → Banking** — unchanged reconciliation workflow; treasury settings via RPC

## Next wave

**EFM Wave 9 — FP&A (scenarios, rolling forecast).**

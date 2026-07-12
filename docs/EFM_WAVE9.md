# EFM Wave 9 — FP&A (Scenarios, Rolling Forecast)

**Status:** Complete (code) — apply migrations `00148` → `00149` on Supabase.

Wave 9 adds financial planning & analysis: planning scenarios, rolling forecasts with actuals + run-rate projections, and scenario comparison.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| FP&A schema | `20260618000148_efm_wave9_fpa.sql` | Scenarios, rolling forecasts, monthly periods |
| FP&A RPCs | `20260618000149_efm_wave9_fpa_rpcs.sql` | Generate, compare, dashboard |
| FP&A tab | `fpa-tab.tsx` | Scenarios, forecast generation, comparison |

## RPCs (Wave 9)

| RPC | Purpose |
|-----|---------|
| `ensure_default_fpa_scenarios` | Seed baseline, optimistic, pessimistic |
| `list_fpa_scenarios` | Active planning scenarios |
| `upsert_fpa_scenario` | Create/update custom scenario |
| `generate_rolling_forecast` | Build monthly forecast from trailing run-rate + adjustments |
| `get_rolling_forecast` | Forecast detail with period buckets |
| `list_rolling_forecasts` | Forecast history |
| `compare_fpa_scenarios` | Side-by-side latest forecast per scenario |
| `get_fpa_dashboard` | YTD actuals, run-rate, baseline forecast summary |

## Model

- **Scenarios** apply `revenue_adjustment_pct` and `expense_adjustment_pct` to a 3-month trailing GL run-rate.
- **Rolling forecast** uses actual GL P&L for complete/partial months through `as_of`; future months are projected.
- **Budget tab** (Phase E) remains for account-level budget vs actual; FP&A tab covers forward-looking planning.
- Generating a new forecast for a scenario supersedes the prior active forecast for that scenario.

## Apply migrations

```bash
# After Wave 8 (00146–00147):
# 00148 — EFM Wave 9 schema
# 00149 — EFM Wave 9 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → FP&A** — scenarios, rolling forecast, scenario comparison
- **Financials → Budget** — unchanged account-level budgets

## Next wave

**EFM Wave 11 — Fixed assets multi-book.**

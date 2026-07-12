# EFM Wave 17 — Fiori-Grade Financial Shell

**Status:** Complete (code) — apply migrations `00164` → `00165` on Supabase.

Wave 17 replaces the flat 25-tab bar with a SAP Fiori–inspired financial shell: launchpad tiles, area navigation, breadcrumbs, and per-user density preferences.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Shell schema | `20260618000164_efm_wave17_financial_shell.sql` | User preferences table |
| Shell RPCs | `20260618000165_efm_wave17_financial_shell_rpcs.sql` | Prefs + launchpad catalog |
| Launchpad | `financial-launchpad.tsx` | Grouped tile grid with KPI strip |
| Area nav | `financial-shell-nav.tsx` | Area pills + secondary tabs |
| Shell config | `lib/finance/financial-shell-config.ts` | Area/tab mapping |
| Financials hub | `financials-client.tsx` | Two-level navigation, URL sync |

## RPCs (Wave 17)

| RPC | Purpose |
|-----|---------|
| `get_financial_shell_preferences` | User density, default area, pinned tabs |
| `update_financial_shell_preferences` | Save shell preferences |
| `list_financial_launchpad_tiles` | Grouped tile catalog (6 areas, 26 tiles) |

## Navigation areas

| Area | Tabs |
|------|------|
| **Home** | Launchpad |
| **Reporting** | Overview, Executive, P&L, Balance Sheet, Cash Flow, Trial, Reports, Analytics |
| **Ledger** | Ledger, COA, Manual JE, Periods |
| **Working Capital** | Aging, Banking, Treasury, FX |
| **Compliance** | Tax, Security |
| **Planning** | Budget, FP&A, Job Cost, Assets, Consolidation |
| **Platform** | Automation, Performance, Assistant |

## URL deep links

```
/financials?area=reporting&tab=pnl&from=2026-01-01&to=2026-01-31
/financials?area=home&tab=home
/financials?tab=assistant&area=platform
```

## User preferences

- **Density** — `cozy` (default) or `compact` (toggle in page header)
- **Show launchpad** — default landing when no tab specified
- **Pinned tabs** — reserved for future quick-access row

## Apply migrations

```bash
# After Wave 16 (00162–00163):
# 00164 — EFM Wave 17 schema
# 00165 — EFM Wave 17 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Home** — Fiori launchpad with KPI strip and grouped tiles
- **Area pills** — switch context without scrolling 25 tabs
- **Breadcrumb** — `Financials · Reporting · P&L` object-page trail

## Next

EFM functional waves 0–17 are code-complete. **Wave 17 UI/UX** also aligns with the parallel Fiori-grade tenant shell roadmap item — extend to other apps as needed.

See `docs/EFM_ROADMAP.md`.

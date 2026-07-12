# EFM Wave 12 — Executive Dashboards & Drill-down

**Status:** Complete (code) — apply migrations `00154` → `00155` on Supabase.

Wave 12 adds an executive financial scorecard with KPI cards, prior-period variance, optional targets, six-month trends, and clickable drill-down into underlying transactions and balances.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Executive schema | `20260618000154_efm_wave12_executive_dashboard.sql` | KPI targets, dashboard layouts |
| Executive RPCs | `20260618000155_efm_wave12_executive_dashboard_rpcs.sql` | Dashboard, drill-down, targets |
| Executive tab | `executive-dashboard-tab.tsx` | KPI cards, trends, drill-down table |

## RPCs (Wave 12)

| RPC | Purpose |
|-----|---------|
| `ensure_default_executive_layout` | Seed default widget layout for org |
| `get_executive_dashboard_layout` | Return active layout + widget visibility |
| `upsert_executive_kpi_target` | Set period target for a KPI key |
| `list_executive_kpi_targets` | Targets overlapping a date range |
| `get_executive_financial_dashboard` | KPI scorecard, trends, prior variance |
| `get_executive_kpi_drilldown` | Detail rows for a KPI key |

## KPI keys

`revenue`, `gross_profit`, `net_profit`, `cash`, `liquid`, `ar`, `ap`, `tax_payable`

## Data sources

- **P&L KPIs** — `profit_and_loss` (GL mode) with prior-period comparison
- **Cash / liquid** — `cash_flow`, `get_treasury_cash_position`
- **AR / AP** — `accounts_receivable_aging`, `accounts_payable_aging`
- **Tax** — `get_vat_liability_report`
- **Trends** — trailing six calendar months of revenue and net profit

## Apply migrations

```bash
# After Wave 11 (00152–00153):
# 00154 — EFM Wave 12 schema
# 00155 — EFM Wave 12 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Executive** — KPI scorecard, trend chart, drill-down panel, KPI target form (managers)
- Deep links: `/financials?tab=executive&from=…&to=…`
- Drill-down rows link to receivables, purchasing, invoicing, and Financials sub-tabs

## Next wave

**EFM Wave 13 — Automation, notifications, scheduled reports** (complete). See [EFM_WAVE13.md](./EFM_WAVE13.md).

**EFM Wave 14 — Security (SoD, dual approval).**

See `docs/EFM_ROADMAP.md`.

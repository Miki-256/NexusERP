# SCM Wave 4 — Analytics & Enterprise Reporting

Final mega-wave: inventory KPIs, ABC analysis, demand forecasting, valuation/aging reports, daily snapshots, and e-commerce inventory export foundation.

## Apply migrations

Run after Wave 3:

1. `supabase/migrations/20260618000126_scm_wave4_analytics.sql`
2. `supabase/migrations/20260618000127_scm_wave4_analytics_rpcs.sql`

## Schema

| Area | Tables |
|------|--------|
| **Snapshots** | `inventory_daily_snapshots` — daily on-hand & value |
| **Forecasting** | `inventory_forecast_runs`, `inventory_forecast_lines` |
| **E-commerce** | `ecommerce_channels`, `ecommerce_product_mappings`, `ecommerce_sync_runs` |

## Key RPCs

| RPC | Purpose |
|-----|---------|
| `scm_dashboard_stats` | KPI dashboard (SKUs, value, low stock, dead stock, movements) |
| `inventory_abc_analysis` | ABC classification from sales revenue |
| `inventory_valuation_report` | On-hand × cost valuation |
| `inventory_aging_report` | Days since last movement |
| `inventory_movement_summary` | Movements by type for date range |
| `capture_inventory_snapshot` | Persist daily snapshot |
| `run_inventory_forecast` | 30-day moving-average demand projection |
| `list_inventory_forecast` | Latest forecast lines |
| `upsert_ecommerce_channel` | Storefront channel config |
| `sync_ecommerce_inventory` | Export qty payload (manual/API-ready) |

## UI

**`/inventory` → Analytics** — KPI cards, ABC chart, forecast table, e-commerce export

## SCM program complete

All four mega-waves are implemented:

| Wave | Scope |
|------|-------|
| 0 | Movement ledger |
| 1 | PIM + warehouses + full ledger |
| 2 | Lots, quality, cycle count, MRP |
| 3 | WMS fulfillment |
| 4 | Analytics & e-commerce sync |

## Future enhancements (post-program)

- Live Shopify/WooCommerce API push
- ML-based forecasting
- Scheduled snapshot cron
- Cross-org enterprise rollups

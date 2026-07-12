# EFM Wave 15 — Performance (partitioning, read replicas, report cache)

**Status:** Complete (code) — apply migrations `00160` → `00161` on Supabase.

Wave 15 adds enterprise financial performance: report result caching, partition/retention policies, GL archive tables, BRIN scale indexes, and read-replica routing integration.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Performance schema | `20260618000160_efm_wave15_performance.sql` | Cache, policies, JE archive, BRIN |
| Performance RPCs | `20260618000161_efm_wave15_performance_rpcs.sql` | Cache fetch, warm/invalidate, maintenance |
| Performance tab | `financial-performance-tab.tsx` | Settings, stats, partition policies |
| Reporting route | `financials/page.tsx` | Uses `fetch_financial_report` + `createReportingClient()` |

## RPCs (Wave 15)

| RPC | Purpose |
|-----|---------|
| `get_financial_performance_settings` | Cache TTL, read-replica preference |
| `update_financial_performance_settings` | Update org performance controls |
| `ensure_default_financial_partition_policies` | Seed JE/sales retention policies |
| `list_financial_partition_policies` | List org partition policies |
| `upsert_financial_partition_policy` | Toggle policy / adjust retention |
| `fetch_financial_report` | Cached wrapper for P&L, BS, trial, cash flow, executive |
| `invalidate_financial_report_cache` | Clear cache entries |
| `warm_financial_report_cache` | Pre-compute MTD core reports |
| `archive_old_journal_entries` | Move eligible posted JEs to archive (dry-run default) |
| `run_financial_partition_maintenance` | Batch maintenance across policies |
| `get_financial_performance_dashboard` | Volume, cache, and index stats |

## Report cache

- Org-level toggle (`financial_cache_enabled`) and TTL (5–1440 minutes).
- Supported types: `profit_and_loss`, `balance_sheet`, `trial_balance`, `cash_flow`, `executive_dashboard`.
- Financials hub loads heavy reports via `fetch_financial_report` (cache hit returns `source: cache`).

## Read replicas

- App already routes reporting through `createReportingClient()` when `SUPABASE_READ_URL` is set.
- Org setting `financial_prefer_read_replica` documents intent; configure env per `DEPLOY.md`.

## Partition / archive

| Table | Strategy | Default retention |
|-------|----------|-------------------|
| `journal_entries` | BRIN index | 84 months (metadata) |
| `journal_entry_lines` | Archive | 60 months |
| `sales` | Archive (Phase 3) | 24 months |

Maintenance defaults to **dry run**. Live archive only moves posted journal entries with no expense FK links.

## Apply migrations

```bash
# After Wave 14 (00158–00159):
# 00160 — EFM Wave 15 schema
# 00161 — EFM Wave 15 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Performance** — cache settings, warm/clear, volume stats, partition policies
- **Financials hub** — P&L, balance sheet, trial, cash flow, executive use cached fetch path

## Next wave

**EFM Wave 17 — UI/UX redesign (Fiori-grade shell).**

See `docs/EFM_ROADMAP.md`.

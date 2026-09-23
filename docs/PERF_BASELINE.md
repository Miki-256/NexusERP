# Performance baseline & harness

## How to enable

- Add `?perf=1` to any URL, or
- `localStorage.setItem('nexus-perf','1')`, or
- Development builds log by default via `isPerfEnabled()`.

Look for console lines: `[perf] … ms`

## Instrumented flows

| Mark / name | Where |
|---|---|
| `pos.bootstrap` | `pos-kiosk` register load |
| `pos.search` | Debounced catalog filter / server page |
| `pos.barcode` | Local + server barcode lookup |
| `pos.cart.add` | Add-to-cart path |
| `pos.complete_sale` | `sale-api` RPC |
| `nav.layout` | Tenant layout auth (server log when enabled) |

## Baseline (measured on preprod — Olana, 2026-09-22)

Method: manager-auth Supabase RPC (3 samples, median ms) + Node POS load (`LOAD_VUS=5`, `LOAD_ITERATIONS=25`). Browser marks (`?perf=1`) still needed for client-perceived bootstrap/search.

| Flow | Median (ms) | Notes |
|---|---|---|
| `get_pos_register_context` | 236 | Register bootstrap piece |
| `get_pos_catalog` | 232 | Full catalog bootstrap |
| `get_pos_catalog_page` (limit 100) | 244 | Paged catalog / search fallback |
| `complete_sale` (load p50) | 247 | 5 concurrent VUs, 25 sales; p95 935; 12.8 sales/s; 0 conflicts |
| `dashboard_stats` | 377 | Org-wide KPIs |
| `trial_balance` | 296 | YTD through today |
| `profit_and_loss` | 296 | YTD |
| `balance_sheet` | 258 | As-of today |
| `cash_flow` | 256 | YTD |
| HTTP `/login` TTFB | ~730–5000 | Cold/warm variance |
| HTTP `/pos/{registerId}` | 277 | Unauthenticated HTML 200 |
| HTTP `/dashboard` `/sales` `/financials` | ~210–270 | 307 redirect to login (edge only) |

Product used for load: Coffee Weight @ ETB 1200 (+15% tax → pay 1380), stock ~50k.

| Flow | Before (ms) | After (ms) | Notes |
|---|---|---|---|
| POS open / bootstrap | | ~230–240 RPC | Client `pos.bootstrap` still TBD via `?perf=1` |
| Product search (local) | | | measure in browser |
| Barcode (cache hit) | | | measure in browser |
| Barcode (server miss) | | | measure in browser |
| Add to cart | | | local |
| Qty change | | | local |
| complete_sale | | 247 p50 / 935 p95 | Node load 5×25 |
| Soft nav (dashboard→sales) | | | measure in browser |
| Sales page TTFB | | ~220 redirect | auth page TBD |

## Related

See `docs/PERF_REGRESSION.md` for the long-session checklist.

## Shipped optimizations (implementation)

| Area | Change |
|---|---|
| POS post-sale | `get_pos_stock_levels` instead of full `get_pos_catalog` |
| Barcode | Server fallback via `get_pos_catalog_page` when truncated/miss |
| Bootstrap UOMs | LATERAL set-based `saleUoms` (migration 00194) |
| Keepalive | Focus-after-idle bootstrap; staff heartbeat only while open |
| PaymentModal | Prefetch when cart non-empty |
| complete_sale | Resolve UOM once; lock distinct variants once (00195) |
| Indexes | SKU partial indexes; catalog capped at 500 |
| Shell | Memoized Navigation/Shell providers |
| Sales export | Lazy `sale_lines` load on Export click |
| Charts | Dynamic recharts via `finance-charts-lazy` |
| Purchasing | Server typeahead for variants; UOMs on demand |
| Dashboard/tips | Aggregate RPCs (00196) |

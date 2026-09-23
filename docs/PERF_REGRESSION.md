# Performance regression checklist

Run with `?perf=1` (or `localStorage nexus-perf=1`) and record times in `PERF_BASELINE.md`.

## P0 POS flows

- [ ] Open POS register — `pos.bootstrap` (catalog size + truncated flag)
- [ ] Local product search after debounce — `pos.search` / perceived &lt;200ms
- [ ] Barcode hit in cache — near-instant (`pos.barcode` path=local)
- [ ] Barcode miss when catalog truncated — `pos.barcode` path=server; product merges into cache
- [ ] Add / qty / remove — no network; UI immediate
- [ ] Prefetch: open Pay with cart lines — PaymentModal chunk already warm
- [ ] Complete sale — `pos.complete_sale`; stock updates via `pos.stock_levels` (not full catalog)
- [ ] Void / return — stock levels refresh without full `get_pos_catalog`
- [ ] Soft keepalive: leave POS idle 5+ min in background, return — full bootstrap only if hidden ≥5m; no 5-min full reload while focused

## Long session (50+ sales)

- [ ] 50+ completed sales on one register session
- [ ] Search / scan churn between sales
- [ ] Category switch under load
- [ ] Leave POS → ERP module → return to POS (cart/session intact as expected)
- [ ] Chrome DevTools: heap not climbing unboundedly; IDB catalog size stable
- [ ] No orphaned intervals after unmount (navigate away from POS)

## ERP soft-nav / lists

- [ ] Soft nav dashboard → sales → purchasing — fewer chrome re-renders (memoized providers)
- [ ] Sales page open — no nested `sale_lines` fan-out until Export Lines clicked
- [ ] Purchasing PO form — variants load via typeahead (not 500-row dump on first paint)
- [ ] Charts on sales/purchasing/financials — recharts loads async (no blocking first paint)

## Dashboard / finance

- [ ] Dashboard today KPIs use aggregate RPC when available
- [ ] Financials period tips use `sum_sales_tips` (not full tip_amount scan)

## Before / after

| Flow | Before (ms) | After (ms) | Notes |
|---|---|---|---|
| POS bootstrap | | | |
| Barcode server miss | | | |
| complete_sale | | | |
| Soft nav | | | |
| Sales page open | | | export deferred? |

Do not invent numbers — measure on preprod with a realistic catalog.

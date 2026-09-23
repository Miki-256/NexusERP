# Failure / Resilience Test Matrix

**Date:** 2026-09-22  
**Environment:** https://nexus-erp-preprod.vercel.app + linked Supabase  
**Method:** Audit-first — SKIP green coverage; execute only high-risk missing scenarios  
**Script:** [`scripts/failure-resilience-assert.mjs`](../scripts/failure-resilience-assert.mjs)  
**Report:** [FAILURE_RESILIENCE_REPORT.md](./FAILURE_RESILIENCE_REPORT.md)

Legend — Result: `PASS` | `FAIL` | `BLOCKED` | `SKIP` | `EXISTING` | `N/A` | `INSUFFICIENT`

| Area | Failure Scenario | Existing Coverage | Test Method | Result | Severity | Recovery | Notes |
|------|------------------|-------------------|-------------|--------|----------|----------|-------|
| A Network | Mid-checkout offline → queue → sync | Warm residual | Browser CDP FR-2 | **PASS** | — | Online sync | `OFF-D0MA3J` → `R-000672` once |
| A Network | Ambiguous Complete Sale (lost response) | Idempotency vitest | Script FR-1 | **PASS** | — | Same-key retry | `duplicate:true`, stock −1 once |
| A Network | New UUID after unclear timeout | None | Script FR-1b | **PASS*** | P2 | Check Sales first | *Finding: second sale if new key; network-fail path reuses key via `finishOffline` |
| A Network | Offline cold payment chunk | Residual P2 | Browser FR-4 | **PASS*** | P2 | Reload / warm online | *Intermittent: SW may cache chunk; fail observed earlier this cycle |
| A Network | Offline sync stock conflict | Code path | Script FR-3 | **PASS** | — | Adjust stock / retry | Insufficient stock; qty ≥ 0 |
| A Network | Slow/timeout 6s sale-api | Heuristic | Covered via FR-1 | SKIP | — | Queue same key | |
| B API | Unauth / post-logout | Partial | Script FR-8 | **PASS** | — | Re-login | Not authenticated / Access denied |
| B API | Full HTTP status matrix | — | — | SKIP | — | — | Sample only per plan |
| C DB | DB unavailable / kill | Hosted preprod | Env | **BLOCKED** | — | — | Cannot pause preprod DB |
| C DB | Invalid qty/payment/variant | — | FR-5/6 | **PASS** | — | Correct input | Business errors, no SQL leak |
| D Auth | Session cleared mid-write | Middleware | Script FR-8 | **PASS** | — | Sign in | |
| D Auth | POS staff PIN | E2E | SKIP | EXISTING | — | — | |
| E AuthZ | Cashier FE deny | TestSprite + Playwright | SKIP | EXISTING | — | — | |
| E AuthZ | Foreign org complete_sale | Vitest | SKIP | EXISTING | — | — | |
| E AuthZ | Cashier adjust_inventory | Gap | Script FR-8 | **PASS** | — | — | Access denied |
| F Validation | Neg/zero qty, neg/underpay, discount>merch | Partial FE | Script FR-5 | **PASS** | — | Fix input | All rejected |
| G Duplicate | Double Complete Sale | Gap + vitest | SKIP | EXISTING | — | — | |
| G Duplicate | Double void | — | Script FR-5 | **PASS** | — | — | 2nd: Sale cannot be voided |
| G Duplicate | Expense double-fire | None | Script FR-7 | **PASS** | — | — | Direct insert blocked by RLS |
| H Partial txn | Sale vs async GL | Architecture | Doc FR-10 | **PASS** | — | Unposted queue | unpostedCount=0; latest has JE |
| I Concurrency | Last-unit race | last-unit-race.mjs | SKIP | EXISTING | — | — | |
| I Concurrency | GC concurrent redeem | — | — | SKIP | — | — | Phase 2 deferred |
| J Browser | Refresh mid-checkout | Soft | FR-2 note | **PASS** | — | Queue/IDB | Cart cleared after offline complete |
| K Nav | Unexpected back/close | Soft | SKIP | — | — | Low priority |
| L Corrupt | Missing variant sale | — | FR-6 | **PASS** | — | — | Variant not found |
| M Payment | Neg/mismatch payment | — | FR-5 | **PASS** | — | — | |
| N Inventory | Oversell UI | gap-pos-oversell | SKIP | EXISTING | — | — | |
| N Inventory | Transfer insufficient | — | FR-6 | **PASS** | — | — | have 87 need 999999 |
| O Accounting | COGS match JE | cogs-line-assert | SKIP | EXISTING | — | — | |
| O Accounting | Unposted sales | count_unposted | FR-10 | **PASS** | — | Process queue | 0 unposted |
| P Perf | Load timeouts | PERF_BASELINE | SKIP | EXISTING | — | — | |
| Q FE runtime | Cold lazy payment | Residual | FR-4 | **PASS*** | P2 | Error boundary / reload | Mitigated when SW caches chunk |
| R Recovery | After network restore | Residual + FR-2 | FR-1/2/3 | **PASS** | — | Continue POS | |

## Explicit SKIP (do not re-run)

Oversell UI, double-complete, last-unit race, warm offline sync+idempotent retry (prior residual), foreign-org AuthZ suite, cashier FE deny, negative adjust vitest, full cash refund happy path, green money TestSprite suite.

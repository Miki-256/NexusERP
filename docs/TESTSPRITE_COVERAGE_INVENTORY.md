# TestSprite coverage inventory (gap-first)

**Date:** 2026-09-22  
**Target:** https://nexus-erp-preprod.vercel.app  
**Project:** `63433b2a-2867-4a63-bc63-0604aebe2ef9`  
**Rule:** ALREADY COVERED — SKIP unless a regression trigger applies. Do not mass-rerun the green suite.

## Live suite snapshot

35+ frontend tests currently **passed** (auth, POS money paths, AR/AP, finance reports, products/UOM, inventory search, cashier denies). Credits at inventory time: ~113.5.

## Category A — Covered and passing (SKIP)

| Scenario | Evidence | Skip reason |
|----------|----------|-------------|
| Sign-in / workspace | `dd901205`, `e6fee1dc` | Unchanged happy path |
| Quick cash sale / multi-item | `72583b1a`, `de8802d7` | Green |
| Split tender → TB | `3d16c4e2` | Green |
| Refund full cash | `58c032f2` | Green (TsMgr setup) |
| Gift card / store credit redeem | `425741c6`, `600fea7b` | Green |
| Sale → TB balances | `087afbf6` | Green |
| Pay later → receivables collect | `c5fb2986` | Green |
| Invoice create/post/full/partial pay | `0eeed260`, `daa71517`, `51701ca7` | Green |
| AP bill pay / PO→bill→pay | `2f71e8c0`, `669f2324` | Green after PO UI fixes |
| Expense to ledger | `fdbc0742` | Green |
| TB / P&L / BS / CF / dashboard / period preflight | multiple `5f672659`…`c5624ae4` | Green |
| Credits issue | `9416d341` | Green |
| Products/UOM/inventory search/low stock | multiple | Green |
| Cashier deny financials/purchasing/expenses | `184b31db`, `99cfd065` | Green |

**Also covered outside TestSprite:** Playwright smoke/permissions/invoice/P2P; integration TB, JE, tenant-isolation, `complete_sale` idempotency.

## Category B — Covered but outdated

| Item | Trigger | Action |
|------|---------|--------|
| Cross-UOM / measured POS sale | `e1ea9c8` multi-UOM ship | **New P0 gap test** (not rerun old UOM create) |
| Dashboard AP KPI | `f6877d9` | Deferred (P2); not blocking gap cycle |
| BS/CF refresh | `3ced575` | Single TB equality in P1 if P0 green |

## Category C — Incomplete

| Item | Gap |
|------|-----|
| Sale → COGS JE lines | UI TB balanced; no JE COGS assert |
| PO receive stock qty | Flow passed; no opening/closing qty math |

## Category D — Weak

Discounts/promotions amounts; barcode checkout (P1 if credits allow).

## Category E — Failed unresolved

None open in live suite.

## Category F — Flaky (mitigated)

Hardcoded TB totals (deleted); cashier without env (cashier env added); Sara cannot refund (TsMgr).

## Category G — Not tested (this cycle P0)

~~1–5~~ Closed by gap FE tests (oversell, cross-UOM, adjust, transfer, double-complete).  
~~6 Tenant isolation backend (TestSprite BE)~~ → vitest substitute; residual cycle added `complete_sale` foreign-org deny (7/7).

## Category H — High-risk deepen

| Item | Residual cycle (2026-09-22) |
|------|------------------------------|
| Concurrent last-unit race | **PASS** — `scripts/last-unit-race.mjs` |
| Offline sync | **PASS** — preprod browser CDP Offline + IDB queue → single server sale + idempotent retry |
| COGS JE assert | **PASS** — aggregated Dr 5000 / Cr 1200 equals Σ(sale_lines×cost); not per-line JE (architecture) |
| Client-controlled org_id / AuthZ | **PASS** — vitest tenant-isolation + finance-write foreign deny; Playwright permissions |

## Category I — Failure / Resilience (2026-09-22)

Audit-first; green suite not re-run. Matrix: [FAILURE_RESILIENCE_TEST_MATRIX.md](./FAILURE_RESILIENCE_TEST_MATRIX.md). Report: [FAILURE_RESILIENCE_REPORT.md](./FAILURE_RESILIENCE_REPORT.md). Script: `scripts/failure-resilience-assert.mjs`.

| Item | Result |
|------|--------|
| Ambiguous Complete Sale (same key) | **PASS** |
| Mid-checkout offline → sync | **PASS** (`R-000672`) |
| Stock-conflict reject | **PASS** |
| Invalid financial / inventory RPC | **PASS** |
| Cashier adjust deny / unauth | **PASS** |
| Double void | **PASS** |
| Error sanitization sample | **PASS** |
| Atomicity + unposted | **PASS** (DB kill BLOCKED) |
| New UUID remount risk | **P2 CONDITIONAL** |
| Offline cold payment chunk | **P2** intermittent |

**Gate:** CONDITIONAL (documented acceptance of P2 limits).

## Explicit deferrals

HR/comms/AI, manufacturing, period close execute, cosmetic responsive, wholesale module-smoke, TestSprite backend-typed project (process). Offline payment-modal **cold** load while already offline remains a P2 operational caveat. Phase 2 deepen: GC concurrent redeem, partial refund chaos, report empty-vs-error.

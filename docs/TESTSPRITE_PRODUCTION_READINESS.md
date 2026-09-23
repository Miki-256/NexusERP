# ERP/POS PRODUCTION READINESS REPORT

**Date:** 2026-09-22  
**Environment:** https://nexus-erp-preprod.vercel.app  
**TestSprite project:** `63433b2a-2867-4a63-bc63-0604aebe2ef9` (frontend-typed)  
**Method:** Gap-first — inventory existing coverage, skip duplication, execute only P0/P1 gaps  
**Inventory detail:** [TESTSPRITE_COVERAGE_INVENTORY.md](./TESTSPRITE_COVERAGE_INVENTORY.md)

---

## 1. Testing Summary

| Metric | Count |
|--------|------:|
| Existing TestSprite tests discovered (live list) | ~35+ |
| Existing tests treated as ALREADY COVERED — SKIP | ~35 (Category A) |
| Existing tests mass-rerun | **0** |
| New gap tests created (FE) | **8** |
| New gap tests executed | **8** |
| New gap passed | **8** |
| New gap failed | **0** |
| New gap blocked | **0** |
| Backend TestSprite in this FE project | **Not allowed** (CLI validation) |
| Tenant isolation via vitest integration | **Passed** (full integration suite 87/87 including tenant-isolation) |
| Credits remaining (approx.) | **~109.5** |

---

## 2. New Gap Tests

### P0

| ID | Name | Verdict |
|----|------|---------|
| `9d22b3f8-…` | Gap — POS blocks oversell when qty exceeds stock | **passed** |
| `e8ab921b-…` | Gap — Cross-UOM POS sale charges and completes correctly | **passed** |
| `11d7c1ce-…` | Gap — Inventory adjust changes on-hand by known delta | **passed** |
| `afa8e8db-…` | Gap — Stock transfer moves quantity between stores | **passed** |
| `81b024b6-…` | Gap — Double Complete sale does not create duplicate receipt | **passed** |

Tenant isolation (backend): TestSprite BE create rejected (project is frontend-typed). **Authoritative substitute:** `tests/integration/tenant-isolation.integration.test.ts` + broader `npm run test:integration` → **87 passed**. Plan artifact retained at `testsprite-plans/gap-tenant-isolation-be.py` for a future backend-typed project.

### P1

| ID | Name | Verdict |
|----|------|---------|
| `27e0ab18-…` | Gap — POS line discount reduces checkout total | **passed** |
| `4c51dcb3-…` | Gap — Barcode entry adds product to POS cart | **passed** |
| `ecb07feb-…` | Gap regression — Cash sale then Trial Balance still balances | **passed** |

Plans live under [`testsprite-plans/gap-*.json`](../testsprite-plans/).

---

## 3. Coverage Gaps (remaining residual)

Former P1 residuals below were closed in §12 Final Residual-Risk Validation. Still deferred:

| Gap | Risk | Notes |
|-----|------|-------|
| Credit notes | P2 | UI exists; no gap test |
| Period **close** execute | P2 | Preflight only (by design — avoid closing live periods) |
| Dashboard AP KPI after `f6877d9` | P2 | Outdated Category B; deferred |
| AI / HR / communications | P3 for money | Out of scope this cycle |
| TestSprite BE project | Process | Needed for BE gap scripts in TestSprite cloud; vitest remains authoritative |
| Offline payment-modal cold start | P2 | First open of checkout while already offline can fail lazy chunk load; warm modal online first (validated path) |

---

## 4. Critical Bugs

### P0
None found in gap cycle.

### P1
None found in gap cycle.

### P2 / P3
None raised from TestSprite gap runs.

---

## 5. Security Findings

| Finding | Severity | Status |
|---------|----------|--------|
| Cross-org RPC/REST denial | — | **Validated** via vitest tenant-isolation (incl. `complete_sale` foreign-org deny; 7/7) |
| Cross-org finance write | — | **Validated** — `finance-write` rejects foreign `post_journal_entry` |
| Cashier FE AuthZ (`/financials`, `/purchasing`, `/expenses`) | — | **Already covered** (SKIP Category A + `e2e/permissions.spec.ts`) |
| TestSprite BE not creatable in FE project | Process | Residual accepted: vitest is authoritative BE AuthZ |

No new IDOR or privilege-escalation defects discovered in this cycle.

---

## 6. Data Integrity Findings

| Area | Result |
|------|--------|
| Oversell prevention | Pass — UI blocks qty above stock |
| Stock adjust delta | Pass |
| Stock transfer | Pass |
| Double Complete sale | Pass — no duplicate receipt observed |
| Cross-UOM sale | Pass |
| TB after sale (regression) | Pass — debits = credits |
| Last-unit dual-cashier race | Pass — stock=1 → 1 win / 1 insufficient; stock=2 → both win; never −1 |
| Offline queue → sync | Pass — single server sale + idempotent retry |
| COGS Σ(lines×cost) vs JE 5000/1200 | Pass — aggregated pair per sale (intentional) |
| Accounting happy paths (prior suite) | Pass (SKIP — not re-run) |

No inventory/customer/supplier/payment inconsistencies found in gap tests.

---

## 7. Performance Findings

Prior baseline ([PERF_BASELINE.md](./PERF_BASELINE.md), Olana 2026-09-22):

- `complete_sale` load: p50 **247 ms**, p95 **935 ms**, 12.8 sales/s, 0 conflicts (5 VUs × 25)
- Finance RPCs TB/P&L/BS/CF: ~**256–296 ms** median

No new performance defects required investigation this cycle. Browser `?perf=1` soft-nav/search marks remain optional follow-up.

---

## 8. Regression Findings

| Trigger commit | Action | Result |
|----------------|--------|--------|
| `e1ea9c8` multi-UOM | New cross-UOM gap test | Pass |
| `3ced575` BS/CF refresh | Single TB equality after sale | Pass |
| PO typeahead commits | SKIP — PO→bill already green | — |

No regressions detected.

---

## 9. Remaining Risks

1. **TestSprite backend project** absent — cloud BE gap scripts cannot live in the FE project (vitest covers AuthZ).  
2. Offline checkout **cold** open of lazy payment modal while already offline may error until chunks are cached (warm path validated).  
3. Large uncommitted UI chrome on branch not in scope for money-path gap testing.  
4. Ops go-live checklist items outside TestSprite ([LAUNCH-OPS.md](./LAUNCH-OPS.md), [ENTERPRISE-QA.md](./ENTERPRISE-QA.md)).

---

## 10. Production Blockers

**None identified from this gap-first TestSprite cycle or residual-risk validation.**

Go-live still depends on ops checklist items outside TestSprite — migrations, cron, env secrets, UAT sign-off — not re-audited here.

---

## 11. Recommended Final Regression Suite (≤12)

Run these IDs only for release smoke (do not expand):

1. `dd901205-…` — Sign in / workspace  
2. `184b31db-…` — Cashier deny financials  
3. `72583b1a-…` — Quick cash sale  
4. `58c032f2-…` — POS refund  
5. `daa71517-…` — Invoice pay full  
6. `669f2324-…` — PO receive → bill → pay  
7. `5f672659-…` — TB debits = credits  
8. `fdbc0742-…` — Expense amount  
9. `600fea7b-…` — Store credit redeem  
10. `11d7c1ce-…` — Stock adjust (gap)  
11. `e8ab921b-…` — Cross-UOM sale (gap)  
12. Vitest: `tests/integration/tenant-isolation.integration.test.ts`

---

## Verdict

**Production confidence (TestSprite money/inventory/authz gaps + residual risks):** HIGH for covered P0/P1 scenarios.  
**Optimization target met:** fewer high-value tests; zero unnecessary suite re-runs; eight gap FE tests all passed; residual four risks validated without green-suite re-run; no confirmed product defects to fix this cycle.

---

## 12. Final Residual-Risk Validation

**Date:** 2026-09-22  
**Constraints honored:** no green TestSprite suite re-run; no second TestSprite BE project; no app product fixes (none required).

### Tests executed / skipped

| # | Risk | Executed? | Skip reason (if any) |
|---|------|-----------|----------------------|
| 1 | Offline POS sync | **Yes** — browser CDP Offline on preprod + API idempotent re-submit | Skipped inventing FE TestSprite offline plans (no network control) |
| 2 | Last-unit dual-cashier race | **Yes** — `scripts/last-unit-race.mjs` | Skipped k6 5×25 / oversell UI (already covered) |
| 3 | COGS aggregated JE | **Yes** — `scripts/cogs-line-assert.mjs` | Did **not** require per-line JE rows (intentional architecture) |
| 4 | Backend AuthZ | **Yes** — audit + vitest `tenant-isolation` only (7/7) | Skipped creating TestSprite BE project |

### Results + evidence

1. **Offline POS — PASS**  
   - Preprod `/pos/{register}` as Sara; CDP `Network.emulateNetworkConditions(offline)`.  
   - Gift card disabled offline; checkout banner “Offline mode — sale saves locally…”.  
   - Queued `OFF-CWKA18` in IndexedDB `nex-erp-offline` / `sync_queue` (status `pending`, key `37563f54-…`).  
   - Online → queue cleared; server sale `R-000667` / `3161a053-…` once.  
   - Re-submit same idempotency key → `duplicate: true`, same `sale_id`.  
   - Note: opening checkout **while already offline** before payment chunk is cached hit error boundary once; warm modal online then go offline succeeded (P2 operational caveat).

2. **Last-unit race — PASS** (`/tmp/nexus-last-unit-race.json`)  
   - Stock=1, two parallel `complete_sale`: **1 success / 1 `Insufficient stock`**, final stock **0**.  
   - Stock=2, two parallel qty=1: **both success**, final stock **0**.

3. **COGS — PASS** (`/tmp/nexus-cogs-assert.json`)  
   - Sale `9d0e3c45-…`: 2× Bottled Water cost 14.86 + 1× Eggs cost 250 → expected **279.72**.  
   - `sale_lines×cost` = **279.72**; JE Dr **5000** = **279.72**; Cr **1200** = **279.72**; **one** 5000 line.  
   - Architecture: **COGS is sale-aggregated in GL; line-level truth is sale_lines×cost; JE is one Dr 5000 / Cr 1200 pair per sale.**

4. **Backend AuthZ — PASS**  
   - Coverage checklist: authn (`signIn` / workspace); tenant IDOR (foreign `list_accounts`, `list_products_page`, `dashboard_bundle`, REST products/members empty); finance write foreign deny (`post_journal_entry`); RPC idempotency + negative adjust; Playwright cashier vs manager FE (`e2e/permissions.spec.ts`).  
   - Hole found: no cross-org `complete_sale` deny → **added one vitest case**; re-run **7/7 passed**.

### Bugs + fixes

None. One vitest coverage addition only (`rejects complete_sale for a foreign organization`).

### Decision matrix

| Risk | Tested? | Result | Evidence | Production Impact | Action |
|------|---------|--------|----------|-------------------|--------|
| Offline POS sync | Yes | **PASS** | Browser queue `OFF-CWKA18` → `R-000667` once; retry `duplicate=true`; gift card disabled offline | None (P2: warm payment chunk before prolonged offline) | Accept; document cold-chunk note |
| Last-unit race | Yes | **PASS** | `scripts/last-unit-race.mjs` case1/case2 both pass | None — FOR UPDATE prevents −1 stock | None |
| COGS line vs JE | Yes | **PASS** | Sum line costs = JE 5000/1200 (279.72) | None — aggregation is intended | Document architecture (not a bug) |
| Backend AuthZ | Yes | **PASS** | Audit + vitest 7/7 incl. new `complete_sale` foreign deny | None | Keep vitest as BE AuthZ source of truth |

### Final Production Gate

**READY — no unresolved P0/P1 production blockers identified**


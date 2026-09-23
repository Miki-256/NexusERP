# Failure / Resilience Report

**Date:** 2026-09-22  
**Environment:** https://nexus-erp-preprod.vercel.app  
**Scope:** Abnormal conditions only — not a re-run of green functional suites  
**Matrix:** [FAILURE_RESILIENCE_TEST_MATRIX.md](./FAILURE_RESILIENCE_TEST_MATRIX.md)  
**Primary script:** [`scripts/failure-resilience-assert.mjs`](../scripts/failure-resilience-assert.mjs)

---

## Executive Summary

P0 failure scenarios for POS money integrity (lost-response idempotency, mid-checkout offline queue→sync, stock-conflict reject, invalid financial/inventory RPCs, cashier inventory deny, double-void) **passed**. No P0/P1 product bugs requiring a code fix were reproduced.

Accepted limitations remain: (1) a **new** Complete Sale after an unclear online failure uses a new UUID if the payment modal remounts (network-fail path itself reuses the key via offline queue — safe); (2) offline checkout can fail if the lazy payment chunk is not yet cached (P2, intermittent; SW often mitigates); (3) GL posting is **async** after sale+stock commit; (4) hosted DB kill not testable.

**Final Production Gate: CONDITIONAL**

---

## Tests Executed

| ID | Scenario | Result |
|----|----------|--------|
| FR-1 | Ambiguous Complete Sale same-key retry | PASS |
| FR-1b | New UUID creates second sale (risk note) | PASS (finding) |
| FR-2 | Mid-checkout offline → queue → sync | PASS (`OFF-D0MA3J` → `R-000672`) |
| FR-3 | Stock conflict on sync/complete | PASS |
| FR-4 | Cold offline payment chunk | PASS* (P2 intermittent) |
| FR-5 | Invalid financial RPC + double void | PASS |
| FR-6 | Transfer oversell + missing variant | PASS |
| FR-7 | Expense double-insert | PASS (RLS blocks raw insert) |
| FR-8 | Unauth / logout / cashier adjust deny | PASS |
| FR-9 | Error message sanitization sample | PASS |
| FR-10 | Atomicity doc + unposted check | PASS (DB kill BLOCKED) |

---

## Existing Tests Skipped

Per plan — already green:

- Oversell UI, double-complete, last-unit race, warm offline sync+idempotent retry  
- Foreign-org tenant isolation + finance-write deny  
- Cashier FE AuthZ (TestSprite + Playwright)  
- Negative inventory adjust vitest  
- Full cash refund happy path  
- Entire green money TestSprite suite  

---

## Network Failures

- **Lost response / same key:** second `complete_sale` → `duplicate: true`, one sale, stock −1 once.  
- **Online network → `finishOffline`:** payment-modal queues **same** payload key (code + residual).  
- **FR-2 browser:** CDP Offline during checkout → `OFF-D0MA3J` pending → online → queue cleared → `R-000672` once; gift card disabled offline.  
- **FR-4:** After reload, first offline Checkout sometimes hit error boundary earlier; this recheck loaded payment UI from cache while offline. Classify **P2** — warm or rely on SW; not a permanent white screen.

---

## API Failures

- Unauthenticated `complete_sale` → `Not authenticated`.  
- Post-logout `list_accounts` → `Access denied`.  
- Invalid business payloads → clear business messages (see Validation).  
- Full 400–504 matrix: **not** exhaustively run (sample only).

---

## Database Failures

- **DB kill / pause:** **BLOCKED** (hosted preprod).  
- Constraint-style rejects exercised via RPC (qty, payment, stock, variant).

---

## Authentication Failures

- Cleared session blocks RPC writes.  
- POS staff PIN path not re-tested (EXISTING).

---

## Authorization Failures

- Cashier `adjust_inventory` → **Access denied**.  
- Foreign-org suite SKIP (EXISTING).  
- Cashier FE routes SKIP (EXISTING).

---

## Validation Failures

All rejected without secret/SQL leaks:

| Input | Message |
|-------|---------|
| Neg qty | Invalid quantity… |
| Zero qty | Invalid quantity… |
| Neg payment | Payment amount cannot be negative |
| Underpay | Payment total … does not match sale total |
| Discount > merch | Order discounts exceed merchandise subtotal |

---

## Duplicate Submission Findings

- Same-key Complete Sale: safe (`duplicate: true`).  
- Double void: first OK, second `Sale cannot be voided`.  
- New UUID after unclear UX: **can** create a second sale — CONDITIONAL process/UX risk (see Bugs).  
- Expense raw insert: RLS denied (no duplicate drafts via that path).

---

## POS Failure Findings

| Scenario | Outcome |
|----------|---------|
| A API fails before commit | No sale (RPC error) |
| B Response lost | Same-key retry / offline queue safe |
| C Inventory OK / GL fails | Architecture: GL async; sale+stock committed; unposted queue (count=0 observed) |
| D FE crash after success | Sale exists server-side; check Sales |
| E Refresh after submit | Offline queue persists in IDB when applicable |
| F Close browser after submit | Backend txn already committed or queued for sync |

---

## Inventory Failure Findings

- Oversell UI: SKIP EXISTING.  
- Transfer 999999: Insufficient stock (have N need 999999).  
- Missing variant: Variant not found.  
- Stock conflict complete: Insufficient stock; stock stays ≥ 0.

---

## Accounting Failure Findings

- COGS JE: SKIP EXISTING.  
- Latest sale had JE; `count_unposted_sales` = 0.  
- Architecture: one PL/pgSQL txn for sale/lines/stock/payments; `enqueue_sale_ledger_post` async.

---

## Browser/UI Failure Findings

- Offline badge + Complete sale (offline) work when payment chunk available.  
- Cold lazy-load failure is recoverable (error boundary / reload) — P2.  
- Loading state clears after offline complete.

---

## Recovery Findings

- Network restore clears sync queue when sale posts.  
- Stock conflict does not oversell.  
- User can continue POS after sync.  
- Session restore requires re-login for ERP RPCs.

---

## Security Findings

- Sampled RPC errors: no SQL host, stack paths, or secrets in messages.  
- Variant UUIDs appear in stock messages (acceptable business detail).  
- Unauthorized and cashier probes denied.

---

## Bugs Found

### FR-BUG-001 — New idempotency key on remounted Complete Sale after ambiguous failure

| Field | Value |
|-------|--------|
| ID | FR-BUG-001 |
| Severity | **P2** (CONDITIONAL acceptance) |
| Area | POS / duplicate risk |
| Classification | **Expected architecture limit** / UX gap — not silent corruption when network-fail uses `finishOffline` |
| Reproduction | Complete sale succeeds; operator remounts payment and completes again with **new** `crypto.randomUUID()` |
| Expected | Prefer “check Sales before retry” / reuse key |
| Actual | Second sale created (script demonstrated stock −2) |
| Root cause | New key minted each `handleComplete` call; safe only if same payload queued |
| Fix | Not applied this cycle (no P0/P1); optional UX: warn on network ambiguity |
| Retest | N/A |

### FR-BUG-002 — Offline cold payment-modal chunk

| Field | Value |
|-------|--------|
| ID | FR-BUG-002 |
| Severity | **P2** |
| Area | POS offline UX |
| Classification | **Product/UX** (intermittent; mitigated by SW cache) |
| Reproduction | Reload POS → go offline → Checkout before payment chunk cached |
| Expected | Offline checkout always available after catalog cache |
| Actual | Sometimes error boundary; sometimes works if chunk cached |
| Root cause | Lazy-loaded payment modal |
| Fix | Not applied (P2); pre-cache chunk / warm on POS boot recommended follow-up |
| Retest | Reconfirmed intermittent mitigation |

No P0/P1 bugs fixed this cycle (none reproduced).

---

## Remaining Risks

1. Ambiguous online failure + remounted checkout new UUID (P2 process).  
2. Offline cold lazy payment chunk (P2).  
3. Async ledger lag under worker outage (ops: monitor unposted).  
4. DB unavailable chaos untested on hosted preprod (BLOCKED).  
5. Non-POS write idempotency sparse (expenses RLS-gated; broader AP/receive not fully chaos-tested).  
6. Gift-card concurrent redeem / partial refund deepen deferred (Phase 2).

---

## Production Blockers

**None** of: data corruption, duplicate financial txn under same-key path, inventory −1, AuthZ bypass, tenant isolation failure, unrecoverable POS when warm path used.

---

## Final Production Gate

**CONDITIONAL — specific documented limitation(s) remain and require explicit business acceptance**

Accepted limits:

1. Teach cashiers: if Complete Sale status is unclear, **check Sales** before retrying (avoid new-key remount).  
2. Offline POS: open Checkout once online (or ensure PWA caches payment chunk) before prolonged offline.  
3. Ops: monitor `count_unposted_sales` / ledger queue.  
4. DB outage drill deferred to a non-preprod environment.

If business accepts (1)–(4), money-path failure resilience supports go-live alongside prior READY residual gate; otherwise treat as CONDITIONAL hold until UX/precache follow-ups land.

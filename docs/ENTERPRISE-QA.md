# NexusERP Enterprise QA Scoreboard

Living document for go-live readiness. Update after each audit sprint.

**Last audit:** 2026-07-12  
**Overall readiness:** 90% → target 90% for pilot ✅

## Automated gates

| Gate | Status | Command |
|------|--------|---------|
| Unit tests | ✅ 70/70 | `npm run test:unit` |
| Integration | ✅ accounting + finance | `npm run test:integration` |
| Supabase RPC verify | ✅ | `npm run verify:supabase` |
| RLS / API / launch audits | ✅ | `npm run audit:*` |
| E2E (preprod) | ✅ smoke + workflows + perms | `E2E_BASE_URL=... npm run test:e2e` |
| Module E2E matrix | ✅ 27/27 routes | `npm run audit:module-e2e` |
| Production env | ✅ required / ⚠️ recommended | `CHECK_PRODUCTION_ENV=1 npm run verify:production-env` |
| Cron process-queue | ✅ preprod HTTP 200 | `npm run setup:launch-ops -- --skip-integration` |

## Module coverage matrix

| Module | Pages | Integration | E2E | UAT |
|--------|------:|:-----------:|:---:|:---:|
| Financials | 1 (+25 tabs) | ✅ | ✅ scroll + area nav | 📋 checklist |
| POS / Sales | 4 | ✅ register + catalog | ✅ login + cash sale | 📋 checklist |
| Invoicing | 1 | ✅ draft create + open list | ✅ create + post to ledger | 📋 checklist |
| Purchasing | 1 | ✅ AP list + PO create | ✅ P2P create + receive | 📋 checklist |
| Permissions | — | ✅ unit | ✅ manager + cashier redirect | 📋 checklist |
| All other tenant apps | 40+ | ⚠️ | ✅ load smoke | 📋 checklist |

## Accounting audit — Olana — 2026-07-12

| Control | Result | Evidence |
|---------|--------|----------|
| Trial balance YTD | ✅ Balanced | 265,032.85 = 265,032.85 |
| Unposted sales | ✅ 0 | `count_unposted_sales` |
| Invoice → ledger | ✅ | E2E post toast |
| AR / AP aging | ✅ | integration |
| Period close preflight | ✅ | `run_period_close_preflight` (does not close) |

## Pilot UAT checklist (manual)

Run on preprod with a manager account. Check each box only after live verification.

### Sales / POS
- [ ] Open register, PIN login, cash sale completes, receipt shows
- [ ] Sale appears in `/sales` within 1 minute
- [ ] Refund / store credit path works for a sample receipt

### Invoicing / AR
- [ ] Create draft invoice → Post → balance appears in receivables
- [ ] Record payment (full or partial) updates invoice status
- [ ] Customer statement loads for a named customer

### Purchasing / AP
- [ ] Create PO → Receive → vendor bill created
- [ ] Pay vendor bill (or payment run) updates AP aging

### Financials
- [ ] P&L / Trial Balance load for current YTD
- [ ] Unposted sales badge is 0 (or post batch succeeds)
- [ ] Period close checklist opens; preflight lists blockers without crashing
- [ ] Do **not** close production periods during UAT unless intended

### Access
- [ ] Cashier cannot open Financials / Team / Settings / Invoicing
- [ ] Manager can open all of the above

### Ops
- [x] `/api/health` returns healthy — 2026-07-12 post-merge deploy (`healthy`, HTTP 200)
- [x] Process-queue cron returns 200 with `CRON_SECRET` — ledger pending 0; GH Actions green after secret sync
- [x] Hard-refresh preprod after each `deploy:live` — `main` @ `f02c57b` aliased to `nexus-erp-preprod.vercel.app`

## P0 / P1 complete

- [x] CRON_SECRET sync + process-queue 200
- [x] deploy:live aliases production host
- [x] Module smoke, POS, P2P, invoice create+post
- [x] Accounting go-live controls + period-close preflight
- [x] Permission matrix (manager E2E + cashier redirect E2E)
- [x] Pilot UAT checklist documented
- [ ] Optional: Upstash keys in local `.env.local` (already on Vercel)
- [x] Commit / PR hardening branch ([#11](https://github.com/Miki-256/NexusERP/pull/11))

## Ops notes (2026-07-12)

- Post-merge deploy + health/cron verified on preprod.
- `stale_rollup_orgs` false positives (empty orgs / dormant sales) fixed in migration `00172` (applied remote 2026-07-12) — detector only flags orgs whose rollup lags completed sales.

## Remaining after pilot gate

- [ ] Execute UAT checklist with business owner sign-off
- [ ] Optional: Resend / notification-from-email for outbound mail
- [ ] Confirm Supabase PITR backups (Pro)

## Invoke

> Run enterprise go-live validation using the enterprise-qa-coordinator skill.

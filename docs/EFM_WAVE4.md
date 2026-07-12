# EFM Wave 4 — Close Management

**Status:** Complete (code) — apply migrations `00138` → `00139` on Supabase.

Wave 4 adds close checklist orchestration: auto-detected blockers, subledger lock, progress tracking, and gated period close integrated with existing `close_fiscal_period` / `reopen_fiscal_period`.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Close management schema | `20260618000138_efm_wave4_close_management.sql` | Templates, runs, tasks, period flags |
| Close management RPCs | `20260618000139_efm_wave4_close_management_rpcs.sql` | Preflight scans, lock, gated close |
| Periods tab UI | `fiscal-periods-tab.tsx` | Checklist panel, progress, preflight, waive |

## RPCs (Wave 4)

| RPC | Purpose |
|-----|---------|
| `ensure_default_close_checklist` | Seed org checklist templates |
| `start_period_close` | Create close run + tasks for a period |
| `run_period_close_preflight` | Start (if needed) and refresh all task scans |
| `refresh_period_close_run` | Rescan tasks for an existing run |
| `get_period_close_status` | Progress %, tasks, blockers |
| `waive_period_close_task` | Manager waive with note (not trial balance / subledger lock) |
| `lock_period_subledgers` | Freeze AR/AP/POS postings in period date range |
| `close_fiscal_period` | **Updated** — enforces checklist when a close run exists |
| `reopen_fiscal_period` | **Updated** — cancels close run, unlocks subledgers |
| `list_fiscal_periods` | **Updated** — close run metadata on each period |
| `_assert_subledgers_open_for_date` | Guard used by AR/AP post paths |

## Checklist tasks (default)

| Code | Module | Blocking | Scan |
|------|--------|----------|------|
| `unposted_sales` | POS | Yes | Completed sales in period without ledger JE |
| `ledger_queue` | POS | Yes | `sale_ledger_post_queue` for period sales |
| `draft_journals` | GL | Yes | Draft JEs dated in period |
| `unreconciled_bank` | Bank | Yes | Unreconciled statement lines through period end |
| `pending_payment_runs` | AP | Yes | Draft/approved payment runs |
| `trial_balance` | GL | Yes | Debits = credits as of period end |
| `subledgers_lock` | Close | Yes | Manual lock via `lock_period_subledgers` |
| `draft_ar_invoices` | AR | No | Informational draft invoices |
| `draft_ap_bills` | AP | No | Informational draft bills |

## Close workflow

1. **Start close** — creates `period_close_runs` + tasks from templates.
2. **Run preflight** — refreshes auto-scans; progress % from blocking tasks.
3. **Resolve blockers** — post sales, reconcile bank, clear drafts, etc.
4. **Lock subledgers** — blocks AR/AP invoice/bill posting in the period (via `_assert_subledgers_open_for_date`).
5. **Close period** — allowed when run status is `ready` (all blocking tasks passing/waived/complete).

**Legacy path:** If no close run was started, `close_fiscal_period` still works as before (direct close from the Actions column).

## Apply migrations

```bash
# After Wave 3 (00135–00137):
# 00138 — EFM Wave 4 schema
# 00139 — EFM Wave 4 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Periods** — expandable close checklist per open period, progress bar, preflight, lock subledgers, gated close.

## Next wave

**EFM Wave 6 — Consolidation & intercompany.**

See `docs/EFM_ROADMAP.md`.

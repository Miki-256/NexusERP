# EFM Wave 14 — Financial Security (SoD, Dual Approval)

**Status:** Complete (code) — apply migrations `00158` → `00159` on Supabase.

Wave 14 adds enterprise financial controls: segregation of duties enforcement, dual approval for high-value journal entries and AP payment runs, and a unified approval queue.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Security schema | `20260618000158_efm_wave14_financial_security.sql` | Org controls, SoD rules, approval steps |
| Security RPCs | `20260618000159_efm_wave14_financial_security_rpcs.sql` | Settings, SoD, extended approvals |
| Security tab | `financial-security-tab.tsx` | Settings, queue, SoD rules |
| Approval UX | `manual-journal-tab.tsx`, `ap-payment-runs-tab.tsx` | Dual-approval progress labels |

## RPCs (Wave 14)

| RPC | Purpose |
|-----|---------|
| `get_financial_security_settings` | JE/AP approval + SoD org settings |
| `update_financial_security_settings` | Update all financial security controls |
| `ensure_default_sod_rules` | Seed standard SoD conflict rules |
| `list_sod_conflict_rules` | List org SoD rules |
| `upsert_sod_conflict_rule` | Create/update SoD rule |
| `list_pending_financial_approvals` | Unified JE + payment run queue |
| `approve_journal_entry` | **Extended** — SoD + dual approval + notification |
| `approve_payment_run` | **Extended** — SoD + dual approval |
| `execute_payment_run` | **Extended** — SoD on creator/approver execute |
| `list_journal_entry_drafts` | **Extended** — approval metadata |
| `list_payment_runs` | **Extended** — approval metadata |

## SoD default rules

| Rule | Blocks |
|------|--------|
| Creator cannot approve journal entry | Same user create + approve JE |
| Creator cannot approve payment run | Same user create + approve AP run |
| Creator cannot execute payment run | Same user create + execute |
| Approver cannot execute payment run | Same user approve + execute |

## Dual approval

- **Journal entries** — when `je_dual_approval_enabled`; optional amount threshold (blank = all drafts)
- **Payment runs** — when `ap_dual_approval_enabled`; default threshold 50,000
- Two distinct approvers required; tracked in `financial_approval_steps`

## Apply migrations

```bash
# After Wave 13 (00156–00157):
# 00158 — EFM Wave 14 schema
# 00159 — EFM Wave 14 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Security** — approval settings, pending queue, SoD rules
- **Financials → Manual JE** — dual-approval progress on drafts
- **Purchasing → Payment runs** — first/final approval labels

## Next wave

**EFM Wave 16 — AI financial assistant.**

See `docs/EFM_ROADMAP.md`.

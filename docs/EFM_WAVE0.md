# EFM Wave 0 — Foundation Hardening

**Status:** Complete (code) — apply migration `00129` on Supabase.

Wave 0 prepares the accounting platform for enterprise expansion without breaking existing GL, POS integration, or UI flows.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Period reopen integrity | `20260618000129_efm_wave0_hardening.sql` | Deletes `period_close` journal entry when reopening; clears `closing_entry_id` |
| `list_customer_invoices_page` | same | Paginated AR invoice list RPC |
| `list_vendor_bills_page` | same | Paginated AP bill list RPC |
| STABLE write audit script | `scripts/audit-stable-write-rpcs.mjs` | `npm run audit:stable-rpcs` |
| Finance integration tests | `tests/integration/finance.integration.test.ts` | GL + subledger probes |
| Supabase verify probes | `scripts/verify-supabase-migrations.mjs` | Finance RPC existence checks |
| Warehouse STABLE fix | `20260618000128_fix_list_warehouses_volatile.sql` | Prior fix (SCM); included in deploy order |

## Apply migrations

```bash
# In order (if not yet applied):
# 00128 — list_warehouses VOLATILE fix
# 00129 — EFM Wave 0
npm run db:push
```

Or paste SQL from each file into Supabase SQL Editor.

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run audit:stable-rpcs   # documents known STABLE+write violations (HCM/notifications)
```

Integration tests require `INTEGRATION_TEST_EMAIL` / `INTEGRATION_TEST_PASSWORD` in `apps/web/.env.local`.

## STABLE function audit

`list_warehouses` was fixed in `00128` (STABLE + `ensure_org_warehouses` INSERT).

Remaining STABLE+write functions are outside finance (notifications, HCM). Track with `npm run audit:stable-rpcs`; fix in domain-specific waves.

## Next wave

**EFM Wave 1 — Enterprise GL core:** hierarchical COA, JE reversal, attachments, opening balance wizard.

See `docs/EFM_ROADMAP.md` (Phase 1 audit) for the full program.

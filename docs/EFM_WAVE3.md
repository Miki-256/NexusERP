# EFM Wave 3 — Enterprise AP

**Status:** Complete (code) — apply migrations `00135` → `00137` on Supabase.

Wave 3 upgrades accounts payable with open-balance tracking, standalone bills, 3-way match validation, payment runs, and vendor statements.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| `partially_paid` + `draft` bill status | `20260618000135_efm_wave3_bill_status_enum.sql` | Separate migration (PG enum commit rule) |
| Open balance + payment runs schema | `20260618000136_efm_wave3_enterprise_ap.sql` | `amount_paid`, `vendor_bill_lines`, `ap_payment_runs` |
| Enterprise AP RPCs | `20260618000137_efm_wave3_enterprise_ap_rpcs.sql` | See RPC list below |
| Standalone bill form | `standalone-bill-form.tsx` | `create_vendor_bill` + `post_vendor_bill` |
| Payment runs tab | `ap-payment-runs-tab.tsx` | Batch create → approve → execute |
| Bills tab upgrades | `purchasing-client.tsx` | Balance due, partial pay, 3-way match check |

## RPCs (Wave 3)

| RPC | Purpose |
|-----|---------|
| `create_vendor_bill` | Standalone draft bill with lines + duplicate detection |
| `post_vendor_bill` | Post draft bill to GL (Dr expense, Cr AP) |
| `pay_vendor_bill` | **Extended** — partial payments, early-pay discount, payment run link |
| `validate_vendor_bill_match` | 3-way match PO ↔ receipt ↔ bill |
| `list_vendor_open_bills` | Open balance bill list |
| `list_vendors_ap_summary` | Vendor-level AP exposure |
| `get_vendor_statement` | Vendor statement of account |
| `create_payment_run` / `approve_payment_run` / `execute_payment_run` | Batch AP payments |
| `list_payment_runs` | Payment run history |
| `accounts_payable_aging` | **Updated** — uses open balance |
| `list_vendor_bills_page` | **Updated** — includes `balance_due`, `match_status` |

## Breaking change

`pay_vendor_bill` dropped the 2-arg overload. Use the extended signature with optional `p_amount`, `p_payment_date`, `p_reference`, `p_payment_run_id`, `p_discount_taken`.

## Apply migrations

```bash
# After Wave 2 (00132–00134):
# 00135 — bill_status enum (draft, partially_paid)
# 00136 — EFM Wave 3 schema
# 00137 — EFM Wave 3 RPCs
npm run db:push
```

Run `00135` alone first if applying via SQL Editor, then commit before `00136`.

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Purchasing → Vendor Bills** — standalone bill entry, balance column, partial pay, match check
- **Purchasing → Payment runs** — select bills, approve batch, execute payments

Dedicated `/payables` app deferred.

## Next wave

**EFM Wave 5 — Multi-currency & FX revaluation.**

See `docs/EFM_ROADMAP.md`.

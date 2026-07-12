# EFM Wave 2 — Enterprise AR

**Status:** Complete (code) — apply migrations `00132` → `00134` on Supabase.

Wave 2 upgrades accounts receivable from invoice-total tracking to open-balance subledger control, with dunning, collections workflow, and customer statements.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Open balance columns | `20260618000133_efm_wave2_enterprise_ar.sql` | `amount_paid`, `amount_credited`, `partially_paid` status |
| `partially_paid` enum value | `20260618000132_efm_wave2_invoice_status_enum.sql` | Must run in its own migration (PG enum commit rule) |
| Payment applications | same | `customer_invoice_payments` |
| Credit allocations | same | `customer_credit_allocations` |
| Dunning policies | same | `ar_dunning_policies`, `ar_dunning_levels`, `ar_dunning_events` |
| Collections status | same | `collection_status` on invoices |
| Enterprise AR RPCs | `20260618000134_efm_wave2_enterprise_ar_rpcs.sql` | See RPC list below |
| Partial payment UI | `invoicing-client.tsx` | Collect dialog with amount + method |
| Collections tab | `ar-collections-tab.tsx` | Queue, dunning batch, status updates |
| Statements tab | `customer-statement-panel.tsx` | `get_customer_statement` + CSV export |
| Types + tests | `database.ts`, `finance.integration.test.ts` | Wave 2 RPC probes |

## RPCs (Wave 2)

| RPC | Purpose |
|-----|---------|
| `pay_customer_invoice` | **Extended** — partial payments (`p_amount`, `p_reference`) |
| `apply_credit_to_invoice` | Apply posted AR credit note to open invoice |
| `get_customer_statement` | Period statement with opening/closing balance |
| `list_customer_open_invoices` | Open balance invoice list |
| `list_customers_ar_summary` | Customer-level AR exposure |
| `list_ar_collections_queue` | Overdue + disputed invoices |
| `list_ar_dunning_policies` / `upsert_ar_dunning_policy` | Dunning configuration |
| `send_invoice_dunning` / `run_ar_dunning_batch` | Escalate reminders via notification center |
| `set_invoice_collection_status` | open / promised / dispute / in_collections / written_off |
| `ensure_default_ar_dunning_policy` | Seed 7/21/45-day levels |
| `accounts_receivable_aging` | **Updated** — uses open balance, not invoice total |
| `list_customer_invoices_page` | **Updated** — includes `balance_due` |
| `list_invoices_needing_reminder` | **Updated** — open balance aware |
| `post_customer_invoice` | **Updated** — credit limit enforcement |

## Breaking change

`pay_customer_invoice` dropped the 2-arg overload. Callers must use the 5-arg signature (optional `p_amount`, `p_payment_date`, `p_reference` default to full balance / today / null). UI updated.

## Apply migrations

```bash
# After Wave 1 (00130–00131):
# 00132 — invoice_status enum (+ partially_paid) — commit alone
# 00133 — EFM Wave 2 schema
# 00134 — EFM Wave 2 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Invoicing → Invoices** — Balance due column, partial collect dialog
- **Invoicing → Collections** — Dunning queue and batch run
- **Invoicing → Statements** — Customer statement of account

Customer portal (read-only invoices) deferred to a later wave.

## Next wave

**EFM Wave 4 — Close management** is complete. See `docs/EFM_WAVE4.md`. Next: **Wave 5 — Multi-currency & FX revaluation.**

See `docs/EFM_ROADMAP.md`.

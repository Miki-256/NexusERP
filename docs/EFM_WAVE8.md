# EFM Wave 8 — Tax Compliance & E-Invoicing

**Status:** Complete (code) — apply migrations `00146` → `00147` on Supabase.

Wave 8 adds enterprise tax compliance: VAT liability (output + input), tax return periods, e-invoice submission log, withholding rules, and extended tax codes.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Tax compliance schema | `20260618000146_efm_wave8_tax_compliance.sql` | Returns, e-invoices, withholding, AP input tax |
| Tax compliance RPCs | `20260618000147_efm_wave8_tax_compliance_rpcs.sql` | VAT report, returns, e-invoicing, settings |
| Tax tab | `tax-tab.tsx` | Compliance settings, VAT liability, returns, e-invoicing |

## RPCs (Wave 8)

| RPC | Purpose |
|-----|---------|
| `get_tax_compliance_settings` | Org tax ID, e-invoice provider, filing frequency |
| `update_tax_compliance_settings` | Update registration and e-invoicing config |
| `get_vat_liability_report` | Output (AR) + input (AP) tax with net payable |
| `create_tax_return_period` | Draft VAT return from period totals |
| `list_tax_return_periods` | Return history |
| `file_tax_return` | Mark draft return as filed |
| `submit_einvoice` | Submit posted invoice (internal stub auto-accepts) |
| `list_einvoice_documents` | E-invoice submission log |
| `list_invoices_pending_einvoice` | Posted invoices without active e-invoice |
| `list_withholding_tax_rules` | Withholding rule catalog |
| `upsert_withholding_tax_rule` | Create/update withholding rule |
| `list_tax_codes` | **Updated** — tax_type, jurisdiction, recoverable |
| `upsert_tax_code` | **Extended** — 9-arg with tax_type |
| `tax_summary_report` | **Updated** — input_tax, net_payable |
| `ensure_default_tax_codes` | **Updated** — seeds INPUT code |

## Model

- **Output tax** — posted customer invoices and credit notes (existing AR tax lines).
- **Input tax** — vendor bill line `tax_amount` on posted/open AP bills.
- **Net payable** — output tax minus recoverable input tax.
- **E-invoicing** — `internal` provider stub accepts immediately; PEPPOL/ERCA are placeholders for future integration.
- **Tax codes** — `output`, `input`, or `withholding` with optional jurisdiction.

## Apply migrations

```bash
# After Wave 7 (00144–00145):
# 00146 — EFM Wave 8 schema
# 00147 — EFM Wave 8 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Tax** — compliance settings, VAT liability, tax returns, e-invoicing queue, tax codes, withholding rules

## Next wave

**EFM Wave 10 — Cost & project accounting.**

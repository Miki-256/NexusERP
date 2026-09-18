# UAT defect remediation — NX-AUDIT closeout (not production sign-off)

Do **not** mark production-ready until TS-QA retests on preprod against acceptance criteria.

## Root causes (verified)

| ID | Symptom | Root cause (fact) | Fix |
|----|---------|-------------------|-----|
| NX-AUDIT-001 | Dashboard MTD ledger ≠ hub by ETB 2.00 | Hub defaulted to **operational** P&L; Dashboard used **posted GL**; tip residual on income explains ±2 on both revenue and NP | Hub default `pnl=gl`; org-TZ MTD; `p_force_refresh`; shared [`posted-gl-mtd.ts`](apps/web/src/lib/finance/posted-gl-mtd.ts) |
| NX-AUDIT-002 | Sale header +3h; JE previous calendar day | UTC/`toLocaleString` display; JE `entry_date` from UTC date | `formatOrgDateTime(Full)` + org TZ; mig `00200` `(created_at AT TIME ZONE v_tz)::date` |
| NX-AUDIT-003 | Catalog/inventory SKU no filter | Enter-only search; `list_products_page` missed variant SKU | Debounced `q=`; mig `00201` |
| NX-AUDIT-004 | Draft ticket churn; reload wipes cart | Random `orderSeq` on remount; active cart not persisted | `sessionStorage` draft; soft kiosk refresh; `localStorage` active cart + restore toast |
| NX-AUDIT-005 | Line shows tax-inclusive next to exclusive unit | `line_total` stores incl. tax | Display `line_total − tax_amount` (detail, receipt, escpos, txn tabs) |
| NX-AUDIT-006 | Settings shows raw `settings.*` keys | 11 keys missing from en/am catalogs | Added keys to `en.json` / `am.json` |
| NX-AUDIT-007 | New PO product search empty | Typeahead searched variant.name (often `"Default"`) only | `list_products_page` flatten variants |
| NX-AUDIT-008 | Manufacturing ~15s | Unbounded `product_variants` SSR | Cap variants (200) + BOM list |

## Migrations

| Migration | Status on preprod linked DB |
|-----------|----------------------------|
| `20260618000200_uat_autopost_sku_queue.sql` | Applied |
| `20260618000201_list_products_variant_sku_search.sql` | Applied |

## Manual E2E checklist (preprod — after app deploy)

1. Dashboard MTD ledger revenue/NP === Accounting hub (GL, same from/to) — gap 0.00.  
2. New cash POS sale: header === payment === receipt === stock === GL clock (Addis); JE business day = Addis day.  
3. Products + Inventory + POS: exact SKU filters; junk → empty.  
4. Draft # stable; reload restores cart or shows “Cart cleared”; new draft after complete.  
5. Line 300 / tax 45 / total 345 exclusive.  
6. New PO: search product name/SKU → add line → create; receive still posts GL.  
7. Settings Language=English: no raw `settings.*` keys.  
8. Manufacturing loads without multi-10s stall on large catalogs.

## Residual risks

- Historical tip credits still on income 4000 can make Operational ≠ GL (by design when toggled).  
- Historical JE dates before mig 00200 may still be UTC-skewed — acceptance is **new** sales.  
- Manufacturing variant select capped at 200 — BOM form may miss rarely used SKUs until search is added later.  
- App must be **deployed** to preprod; DB migrations alone do not fix UI defects.

## Shipped to preprod (001 / 002 / 006 land)

| Field | Value |
|-------|--------|
| Branch | `ai-assistant-l2-l6` |
| Tip SHA | `bffd36085a4ae7f54aff11e3aa30428ed6328f06` (includes `7de1962` land + build deps + PO `organizationId`) |
| Vercel deployment | `dpl_7zv72LwkQioKjwyX92eonon3x5xN` |
| Alias | https://nexus-erp-preprod.vercel.app/ |

**Retest-v3 FAIL meta-RCA:** fixes existed only in WIP; HEAD/preprod still had operational hub default, UTC sale headers, and untracked `messages/*.json`.

**Self-smoke on that deploy (Olana, 2026-09-18):**
- **001:** Dashboard Posted GL revenue MTD ETB 4,737.00 / NP 2,941.68 / cash 155,418.20 === Financials hub (same range) — gap **0.00**.
- **002:** Sale R-000608 header `Sep 18, 2026, 6:11:01 PM` === payment time (Addis; UTC instant was 15:11Z).
- **006:** Settings Language=English — labels render (Subscription, Business name, …); zero raw `settings.*`.
- **007 / 003 / GL:** New PO typeahead finds Coffee*; `/products?q=Coffee` returns 3; R-000608 JE posted & balanced (Dr/Cr 124.50).

## Do not self-certify

TS-QA retests against NX-AUDIT acceptance; Human CEO go/no-go.

# Nexus ERP — Audit & Rebuild Reference

Audit of the live Base44 app (`https://babysolidfoods.com`) performed read-only while
logged in as an Admin account, plus a code review of the prior local versions
(`~/Nexus` Vite/Express, `~/Nex` Next.js). This file is the source of truth for the
custom ERP rebuild in this repo (`~/NexusERP`).

Date: 2026-06-18

---

## 1. Platform reality (live app)

- The live app is built on **Base44** (`base44_app_id`, `base44_access_token` in
  `localStorage`; Google login redirects "to continue to base44.com").
- **Stripe** (billing) and **Mixpanel** (analytics) are integrated.
- Only the **frontend + backend functions** are exportable from Base44; the database,
  auth, and permission enforcement live inside Base44's managed platform.
- HTTP: Cloudflare → Render (uvicorn). Security headers present (HSTS, X-Frame-Options
  DENY, nosniff, referrer-policy, permissions-policy) but **no Content-Security-Policy**.
  These headers are controlled by Base44, not us.

**Conclusion:** Base44 is the wrong foundation for a true ERP and limits our ability to
audit/fix the backend. The rebuild is a custom **Next.js + Supabase** app (this repo),
using the live app as the feature spec.

---

## 2. Security findings

| # | Severity | Finding | Fix in rebuild |
|---|----------|---------|----------------|
| S1 | Critical | `/super-admin` shows **all tenants** (other owners' shops + emails) with Approve/Reject/Suspend. Must be verified server-side; Base44 has a history of client-side-only enforcement. | Server-side `platform_admins` check on every super-admin query + RLS; never rely on UI hiding. |
| S2 | High | Auth tokens stored in `localStorage` (XSS-stealable). | Supabase SSR with **HttpOnly cookies** (already in foundation). |
| S3 | High | No `Content-Security-Policy`. | Add strict CSP via `next.config` headers / middleware. |
| S4 | Medium | Staff PIN lockout enforced client-side (`pos_pin_lockouts` in localStorage); 4-digit PINs. | Server-side PIN verification + lockout counter in DB. |
| S5 | Medium | Open shop self-registration (Pending Approval). Verify pending shops cannot operate or read data. | RLS denies all data for non-approved orgs; approval is a platform-admin action. |
| S6 | Medium | Inherited foundation: `stores` RLS weakened by `OR current_setting('request.jwt.claims') IS NOT NULL`. | Split into member-SELECT + manager-WRITE (migration `*_security_hardening`). |
| S7 | Medium | Inherited foundation: `organizations` open `INSERT WITH CHECK (true)`. | Drop; org creation only via `create_organization_with_owner` RPC. |
| S8 | Low | Inherited foundation: `sales`/`sale_lines` writable without role checks. | Restrict UPDATE/DELETE to managers; sale_lines select-only (writes via RPC). |
| S9 | Low | 3 npm vulnerabilities (1 critical) in dependencies. | `npm audit fix` + dependency bumps. |

---

## 3. Functional / data bugs (live app)

| # | Area | Bug |
|---|------|-----|
| F1 | Inventory | Shows **"0 products total"** while POS lists 4 products with stock — scoping/query mismatch; inventory mgmt broken. |
| F2 | Refunds | **"Eligible Sales: 0"** despite completed sales — refunds cannot be initiated. |
| F3 | Financials | **P&L has no Operating Expenses section**; Net Profit = Gross Profit. Expenses never deducted → overstated net profit. Not real accounting. |
| F4 | Super Admin | Stat cards miscomputed/mislabeled: "Active Users 14" > "Total Users 5"; "Total Orders = $2527" (money shown as count). |
| F5 | Currency | POS hardcodes `ETB`; Reports/Financials/Expenses/Credits/Refunds use a free-text "Currency Symbol" (`$`). Mixed currencies across app. |
| F6 | Reports | Cashier performance shows "**Unknown**" — sales not linked to staff profile. |
| F7 | Routing | Browser tab `<title>` wrong on most routes (stale "Reports"/"Tenant Select"). |
| F8 | Data hygiene | ~98% of products "Uncategorized"; `$ 0.00` spacing inconsistency. |

---

## 4. Feature-parity checklist (rebuild must cover)

- [ ] Auth: email/password + Google SSO, password reset
- [ ] Multi-tenant: org/shop model, **Tenant Select / Switch Shop**, **Register New Shop**
- [ ] Shop **approval workflow** (pending → active), plans (Free/Enterprise), Stripe billing
- [ ] **POS**: product search/scan, cart, customer attach, cash + mobile money + bank, receipt
- [ ] Register sessions (open/close shift), staff **PIN** login (server-side)
- [ ] **Inventory**: products, variants, categories, multi-store stock, adjustments, import
- [ ] **Sales & Reports**: revenue/orders/peak/low-stock, transactions, top products, cashier perf, CSV
- [ ] **Customers** (contacts)
- [ ] **Expenses** (categories, vendors, payment) — feeds the ledger
- [ ] **Financials**: real P&L (incl. OpEx), Balance Sheet, Trial Balance, Cash Flow
- [ ] **Credits** (store credit / receivables)
- [ ] **Refunds / Returns**
- [ ] **Team** (members, roles, invites) + **Staff PINs / User Management**
- [ ] **Super Admin**: shops, users, role matrix, analytics, activity, security, broadcast — all server-enforced
- [ ] Settings: store info, tax, currency (proper currency code, not free-text symbol), receipts, daily email report

---

## 5. ERP modules to add beyond current parity (Odoo-inspired)

1. **Accounting core**: chart of accounts, journals, double-entry journal entries, fiscal
   periods, auto-posting from POS sales / expenses / refunds.
2. **Purchasing**: vendors, purchase orders, goods receipts, vendor bills.
3. **Inventory valuation**: average cost, stock moves, COGS posting.
4. **CRM**: leads/opportunities pipeline tied to contacts.
5. **HR**: employees, attendance, basic payroll.
6. **Financial statements**: P&L, Balance Sheet, Trial Balance, Cash Flow from the ledger.

---

## 6. Build phases

- **Phase 0** — Security hardening (foundation RLS fixes, CSP, npm vulns). *(in progress)*
- **Phase 1** — Accounting core + correct P&L (incl. expenses).
- **Phase 2** — Purchasing + inventory valuation.
- **Phase 3** — CRM + Contacts + Expenses UI.
- **Phase 4** — HR/Payroll + full financial statements.
- **Phase 5** — Super Admin console + Base44 data migration.

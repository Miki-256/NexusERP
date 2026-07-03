# Nexus ERP — Odoo A→Z Parity Roadmap

Rebuild target: [Odoo](https://www.odoo.com/) module coverage on our **Next.js + Supabase** stack.  
We are **not** cloning the Base44 live app ([babysolidfoods.com](https://babysolidfoods.com/)); that site is reference-only.

---

## How to read this doc

| Status | Meaning |
|--------|---------|
| **Live** | Implemented in NexusERP (schema + UI + RPC where needed) |
| **Partial** | Core exists; Odoo parity incomplete |
| **Planned** | On roadmap, not built yet |
| **Out of scope v1** | Odoo has it; we defer (e.g. full eCommerce builder) |

---

## Odoo app families → NexusERP mapping

### Finance ([Odoo Finance](https://www.odoo.com/))

| Odoo app | NexusERP | Status | Notes |
|----------|----------|--------|-------|
| Accounting | `/financials`, ledger RPCs | **Live** | CoA, journals, P&L, BS, TB, cash flow |
| Invoicing | `/invoicing` | **Live** | Customer invoices, post to AR + revenue |
| Expenses | `/expenses` | **Live** | Posts to ledger |
| Documents | `/documents` | **Live** | Metadata + links (no binary storage v1) |
| Sign | — | Planned | E-signatures |
| Spreadsheet (BI) | `/reports` | Partial | Dashboard stats; no pivot/BI builder |

### Sales ([Odoo Sales](https://www.odoo.com/))

| Odoo app | NexusERP | Status |
|----------|----------|--------|
| CRM | `/crm` | **Live** |
| Sales | `/sales`, `/invoicing` | Partial |
| Point of Sale | `/pos` | **Live** |
| POS Restaurant | — | Planned |
| Subscriptions | — | Planned |
| Rental | — | Planned |

### Websites ([Odoo Websites](https://www.odoo.com/))

| Odoo app | Status |
|----------|--------|
| Website Builder | Out of scope v1 |
| eCommerce | Planned |
| Blog / Forum / Live Chat / eLearning | Planned |

### Supply Chain ([Odoo Supply Chain](https://www.odoo.com/))

| Odoo app | NexusERP | Status |
|----------|----------|--------|
| Inventory | `/inventory` | **Live** |
| Purchase | `/purchasing` | **Live** |
| Manufacturing | `/manufacturing` | **Live** (BOM + MO basic) |
| PLM / Maintenance / Quality | Planned |

### Human Resources ([Odoo HR](https://www.odoo.com/))

| Odoo app | NexusERP | Status |
|----------|----------|--------|
| Employees | `/hr` | **Live** |
| Payroll | `/hr` (Payroll tab) | **Live** |
| Recruitment | `/recruitment` | **Live** |
| Time Off | `/time-off` | **Live** |
| Appraisals / Referrals / Fleet | Planned |

### Marketing ([Odoo Marketing](https://www.odoo.com/))

| Odoo app | Status |
|----------|--------|
| Email / SMS / Social / Events / Surveys | Planned |

### Services ([Odoo Services](https://www.odoo.com/))

| Odoo app | NexusERP | Status |
|----------|----------|--------|
| Project | `/projects` | **Live** |
| Timesheets | Planned | |
| Helpdesk | `/helpdesk` | **Live** |
| Field Service / Planning / Appointments | Planned |

### Productivity ([Odoo Productivity](https://www.odoo.com/))

| Odoo app | Status |
|----------|--------|
| Discuss (chat) | Planned |
| Knowledge base | Planned |
| AI assistant | Planned |

### Platform ([Odoo platform](https://www.odoo.com/))

| Odoo feature | NexusERP | Status |
|--------------|----------|--------|
| Multi-company (tenants) | Organizations | **Live** |
| Users & roles | `/team` | **Live** |
| Super Admin | `/admin` | **Live** |
| App switcher | `/dashboard` (Apps home) | **Live** |
| Studio (custom fields) | — | Out of scope v1 |

### Retail extras (from Base44 spec, Odoo-equivalent)

| Feature | NexusERP | Status |
|---------|----------|--------|
| Refunds | `/refunds` | **Live** (void sale + list) |
| Store credits | `/credits` | **Live** |
| Register sessions | POS + `/reports` | **Live** |
| Multi-store | `/stores` | **Live** |

---

## Build phases (updated)

| Phase | Scope | Status |
|-------|--------|--------|
| 0 | Security hardening | Done |
| 1 | Accounting core + Financials UI | Done |
| 2 | Purchasing + inventory valuation | Done |
| 3 | CRM + Contacts | Done |
| 4 | HR/Payroll + BS/Cash Flow | Done |
| 5 | Super Admin + import tools | Done |
| 6 | **Odoo shell + Invoicing, Projects, Helpdesk, MRP, Documents, Recruitment, Time Off, Credits, Refunds** | **Current** |
| 7 | Bank reconciliation, advanced warehouse (multi-step), barcode | Planned |
| 8 | eCommerce, email marketing, discuss/chat | Planned |
| 9 | Manufacturing depth (work orders, routing), quality | Planned |
| 10 | Mobile apps, IoT, localizations (tax packs) | Planned |

---

## Odoo principles we follow

1. **One database, many apps** — shared products, contacts, ledger.
2. **Server-enforced business logic** — RPC + RLS, not client-only rules ([Odoo ORM](https://www.odoo.com/) equivalent: Supabase RPC).
3. **Double-entry accounting** — every money movement hits the ledger.
4. **App launcher UX** — grid of apps like Odoo home, not a flat menu only.

---

## What Odoo has that we will not replicate in v1

- 40k+ community apps marketplace
- Odoo.sh hosting / proprietary Studio
- Full website builder & theme store
- Native mobile apps (iOS/Android)
- Per-country fiscal localization packs (we use configurable tax %)

These require separate product decisions; the roadmap above focuses on **operational ERP parity** for retail/SME.

# NexusERP Enterprise Financial Management — Roadmap

Phased transformation from mid-market GL (Phases A–F) to full EFM platform.

| Wave | Focus | Status |
|------|-------|--------|
| **0** | Hardening, tests, list RPCs, period reopen | ✅ Code complete |
| **1** | Enterprise GL (COA hierarchy, JE lifecycle, attachments) | ✅ Code complete |
| **2** | Enterprise AR (open balance, dunning, statements) | ✅ Code complete |
| **3** | Enterprise AP (standalone bills, payment runs, 3-way match) | ✅ Code complete |
| **4** | Close management orchestration | ✅ Code complete |
| **5** | Multi-currency & FX revaluation | ✅ Code complete |
| **6** | Consolidation & intercompany | ✅ Code complete |
| **7** | Treasury & advanced banking | ✅ Code complete |
| **8** | Tax compliance & e-invoicing | ✅ Code complete |
| **9** | FP&A (scenarios, rolling forecast) | ✅ Code complete |
| **10** | Cost & project accounting | ✅ Code complete |
| **11** | Fixed assets multi-book | ✅ Code complete |
| **12** | Executive dashboards & drill-down | ✅ Code complete |
| **13** | Automation, notifications, scheduled reports | ✅ Code complete |
| **14** | Security (SoD, dual approval) | ✅ Code complete |
| **15** | Performance (partitioning, read replicas) | ✅ Code complete |
| **16** | AI financial assistant | ✅ Code complete |
| **17** | UI/UX redesign (Fiori-grade shell) | ✅ Code complete |

## Wave docs

- [EFM Wave 0](./EFM_WAVE0.md)
- [EFM Wave 1](./EFM_WAVE1.md)
- [EFM Wave 2](./EFM_WAVE2.md)
- [EFM Wave 3](./EFM_WAVE3.md)
- [EFM Wave 4](./EFM_WAVE4.md)
- [EFM Wave 5](./EFM_WAVE5.md)
- [EFM Wave 6](./EFM_WAVE6.md)
- [EFM Wave 7](./EFM_WAVE7.md)
- [EFM Wave 8](./EFM_WAVE8.md)
- [EFM Wave 9](./EFM_WAVE9.md)
- [EFM Wave 10](./EFM_WAVE10.md)
- [EFM Wave 11](./EFM_WAVE11.md)
- [EFM Wave 12](./EFM_WAVE12.md)
- [EFM Wave 13](./EFM_WAVE13.md)
- [EFM Wave 14](./EFM_WAVE14.md)
- [EFM Wave 15](./EFM_WAVE15.md)
- [EFM Wave 16](./EFM_WAVE16.md)
- [EFM Wave 17](./EFM_WAVE17.md)

## Principles

1. Never break posted journal integrity or POS async ledger queue.
2. All writes via `SECURITY DEFINER` RPCs; balanced journals only.
3. Schema + RPC migration per wave; types + tests + docs in same wave.
4. Extend RPCs; avoid breaking existing client signatures.

## Current foundation (pre-EFM)

- Migrations `00002` (core GL) through `00064` (enterprise FA, consolidation, recurring JE)
- UI: `/financials` 18-tab hub, `/invoicing`, `/receivables`, `/expenses`, `/purchasing` (AP)
- Process guide: [ACCOUNTING_PROCESS.md](./ACCOUNTING_PROCESS.md)

# EFM Wave 13 — Financial Automation, Notifications & Scheduled Reports

**Status:** Complete (code) — apply migrations `00156` → `00157` on Supabase.

Wave 13 connects the EFM platform to the notification center: financial alert rules, GL-based scheduled reports, and an enhanced Financials Automation tab.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Automation schema | `20260618000156_efm_wave13_financial_automation.sql` | `financial_automation_rules` |
| Automation RPCs | `20260618000157_efm_wave13_financial_automation_rpcs.sql` | Rules, schedules, report data |
| Automation tab | `automation-tab.tsx` | Alert rules + scheduled financial reports |
| Report types | `types.ts` (notifications) | GL P&L, BS, executive, AR aging |

## RPCs (Wave 13)

| RPC | Purpose |
|-----|---------|
| `ensure_default_financial_automation_rules` | Seed inactive alert presets + notification rule |
| `list_financial_automation_rules` | List org alert rules |
| `upsert_financial_automation_rule` | Create/update rule |
| `delete_financial_automation_rule` | Remove rule |
| `evaluate_financial_automation_rules` | Evaluate active rules; enqueue `accounting.automation_alert` |
| `list_financial_scheduled_reports` | Financial `notification_schedules` only |
| `upsert_financial_scheduled_report` | Manage schedule (accounting managers) |
| `ensure_default_financial_scheduled_reports` | Seed inactive GL report schedules |
| `get_scheduled_report_data_internal` | **Extended** — GL financial report types |

## Rule types

| Type | Config | Trigger |
|------|--------|---------|
| `kpi_threshold` | `kpi_key`, `operator`, `threshold` | Executive dashboard KPI breach |
| `cash_minimum` | same as KPI (default `liquid`) | Low liquid assets |
| `ar_overdue` | `min_total` | AR 60+ day bucket total |
| `period_close_reminder` | `days_before_end` | Open fiscal period ending soon |

## Scheduled report types

| Code | Source |
|------|--------|
| `financial.pnl` | `profit_and_loss` (GL, MTD) — upgraded from sales rollup |
| `financial.balance_sheet` | `balance_sheet` |
| `financial.executive` | `get_executive_financial_dashboard` KPI rows |
| `financial.ar_aging` | `accounts_receivable_aging` |

## Apply migrations

```bash
# After Wave 12 (00154–00155):
# 00156 — EFM Wave 13 schema
# 00157 — EFM Wave 13 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Automation** — alert rules (evaluate, activate/pause), scheduled financial reports, recurring JE, invoice reminders
- **Communications → Schedules** — full schedule editor (all report types)
- Notifications delivered via existing worker (`accounting.automation_alert` event)

## Next wave

**EFM Wave 14 — Security (SoD, dual approval)** (complete). See [EFM_WAVE14.md](./EFM_WAVE14.md).

**EFM Wave 15 — Performance (partitioning, read replicas).**

See `docs/EFM_ROADMAP.md`.

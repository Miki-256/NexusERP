# HCM Wave 9 — Integrations & Exports

Wave 9 adds HR data exports, configurable payroll GL mapping, and outbound webhook hooks for external systems.

## Apply migrations

Run in order (after Waves 0–8):

1. `supabase/migrations/20260618000116_hcm_wave9_integrations.sql`
2. `supabase/migrations/20260618000117_hcm_wave9_integrations_rpcs.sql`

## What changed

### HR data exports (9.1)

Server-side CSV export RPCs (manager-only):

| RPC | Output |
|-----|--------|
| `export_hr_employees_csv` | Employee master data |
| `export_hr_leave_csv` | Leave requests in date range |
| `export_hr_payroll_csv` | Payroll run summary in date range |
| `export_hr_attendance_csv` | Clock-in/out records in date range |

Each returns `{ content, filename, row_count }`.

### Payroll GL mapping (9.2)

- **`hr_payroll_gl_mappings`** — org-level summary accounts (expense, tax, net pay by payment method).
- `ensure_default_hr_gl_mappings` — seeds 6400/2100/1000/1010/1020 defaults.
- `list_hr_payroll_gl_mappings`, `upsert_hr_payroll_gl_mapping`.
- **`upsert_pay_component`** extended with `p_gl_account_code`.
- **`post_payroll_run`** enhanced:
  - Uses component-level GL lines when pay components have `gl_account_code` set.
  - Falls back to summary mappings otherwise.
  - Enqueues `hr.payroll_posted` webhook on post.

### Outbound webhooks (9.3)

- **`hr_webhook_endpoints`** — URL, optional signing secret, event filter.
- **`hr_webhook_queue`** — delivery queue (service-role only).
- `list_hr_webhook_endpoints`, `upsert_hr_webhook_endpoint`, `delete_hr_webhook_endpoint`.
- `enqueue_hr_webhooks` — fans out to matching active endpoints.
- `claim_hr_webhook_batch`, `mark_hr_webhook_delivery` — processed by cron worker.
- `list_hr_webhook_deliveries` — delivery log for HR UI.

Supported event types (configure per endpoint, or leave empty for all):

- `hr.payroll_posted`
- `hr.offboarding_started`
- `hr.leave_requested`
- `hr.leave_approved`
- `hr.probation_completed`
- `hr.contract_expiring`

Payload signing: `X-Nexus-Signature` header (HMAC-SHA256 of body) when a secret is set.

Cron integration: `apps/web/src/app/api/webhooks/process-queue/route.ts` calls `dispatchHrWebhooks`.

## UI

### HR (`/hr` → Integrations tab)

| Sub-tab | Features |
|---------|----------|
| **Exports** | Download employees, leave, payroll, attendance CSV |
| **GL Mapping** | Summary accounts + per pay-component GL codes |
| **Webhooks** | Add/edit endpoints, view delivery log |

## Permissions

- All integration features: `user_can_manage_hr()`.
- Webhook queue: service role only (no client RLS access).

## Next steps

- Wire additional HR events (`leave_requested`, `probation_completed`) to `enqueue_hr_webhooks`.
- Optional: SFTP / scheduled export jobs via notification schedules.

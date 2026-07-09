# Communications & Notification Center — User Guide

How to operate multi-channel alerts in NexusERP after Sprints 0–8.

## Who can manage communications

Owners and managers with the **Communications** app permission can configure channels, rules, templates, schedules, and DLQ tools. All members still receive **in-app** notifications via the bell icon in the header.

## Daily workflow

1. Open **Communications** — dashboard shows sent today, queue depth, failed count, and short charts.
2. Check **Queue** if “events pending” or “queued” is elevated → **Process pending events**.
3. Review **Failed** for retryable failures and dead-letter (DLQ) rows.
4. Use **Audit** after config changes or bulk DLQ actions.

## Channels

| Channel | Setup | Notes |
|---------|--------|-------|
| **Email** | Channels → Email; Resend API key on platform | Org from-address must be verified in Resend |
| **Telegram** | Channels → Telegram; bot token + chat id | Group alerts and report attachments |
| **WhatsApp** | Channels → WhatsApp; Meta Cloud API | Template messages require Meta approval |
| **In-app** | Always on | Bell inbox; no external provider |

## Rules & templates

- **Rules** match an event type (e.g. `pos.sale_completed`) and choose channels + recipients.
- Inactive rules are shipped as presets (Telegram/WhatsApp) — enable after credentials work.
- **Templates** use `{{placeholder}}` fields from the event payload.
- Prefer editing org templates; system templates (`organization_id` null) are defaults.

## Scheduled reports

**Schedules** runs daily/weekly/monthly exports (CSV, XLSX, PDF) into email/Telegram. Inactive presets exist per org — activate, set recipients, and wait for the next cron tick (`/api/webhooks/process-queue`).

## Failed & dead-letter (DLQ)

| Status | Meaning | Action |
|--------|---------|--------|
| `failed` | Temporary error; retries remaining | Retry after fixing config |
| `dead_letter` | Max attempts exhausted | Inspect → fix → Retry (resets attempt counter) |
| `cancelled` | Admin abandoned | Optional purge after 30 days |

**Failed** page tools:

- Filter by failed vs dead letter  
- Inspect payload / body / last error  
- Retry one or bulk (≤ 25)  
- Cancel one or cancel filtered  
- Purge DLQ/cancelled older than 30 days  

All bulk actions write to the **Audit** log.

## Module events (auto)

| Event | When |
|-------|------|
| `pos.sale_completed` | Checkout |
| `inventory.low_stock` / `out_of_stock` | Cron scan + stock hit zero |
| `inventory.stock_adjustment` | Inventory adjust RPC (rule inactive by default) |
| `accounting.payment_received` | AR collect / invoice pay |
| `accounting.journal_posted` | Draft JE approved (rule inactive by default) |
| `crm.customer_created` | New customer (rule inactive by default) |
| `crm.complaint_logged` | New helpdesk ticket |
| `security.login_failed` | Failed login for a known member email |
| `system.queue_backlog` | Org queue depth over threshold |

## Rate limits

Default **100 notification events per organization per minute**. Override with `organizations.notification_rate_limit_per_minute` (10–10 000). Excess enqueues raise an error and do not block the business RPC that already committed (when enqueue is best-effort from triggers/RPC tail, failures are logged).

## Ops / cron

Authenticated cron (Bearer `CRON_SECRET` or webhook secret) hits `POST /api/webhooks/process-queue`, which:

1. Expands pending events → deliveries  
2. Claims and sends a batch (`NOTIFICATION_BATCH_SIZE`, default 50)  
3. Scans low stock + queue backlog  
4. Runs due schedules  

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Queue empty but “events pending” | Process pending events; ensure Sprint migrations applied |
| Email silent | Channel enabled + Resend key + verified domain |
| Telegram silent | Enabled rule + chat id + `TELEGRAM_BOT_TOKEN` / org token |
| Rate limit errors | Lower burst or raise `notification_rate_limit_per_minute` |
| DLQ growing | Inspect last_error; fix provider; retry; else cancel/purge |

## Related

- Architecture & sprint plan: [`NOTIFICATION_CENTER.md`](./NOTIFICATION_CENTER.md)
- Env checklist: root `.env.example` (`NOTIFICATION_*`, Resend, WhatsApp, Telegram, `CRON_SECRET`)
- Load test: `npm run load-test:notifications -- --org <uuid>`

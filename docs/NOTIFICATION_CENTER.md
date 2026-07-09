# NexusERP Communication & Notification Center

Enterprise messaging backbone — centralized, asynchronous, multi-channel.

**Status:** Sprints 0–8 complete (foundation through hardening)  
**Version:** 1.1  
**Date:** 2026-07-08

---

## 1. Executive summary

NexusERP today has **strong operational queues** (ledger posting, payment webhooks, security alerts) but **no tenant notification platform**. Email is limited to Supabase Auth; the header bell icon is a placeholder; modules cannot send WhatsApp, Telegram, or transactional email.

This document defines a **central Notification Service** that every module publishes events to. External providers are never called from business transactions — only from a background worker after DB commit.

### Design principles

| Principle | Implementation |
|-----------|----------------|
| **Publish, don't send** | Modules call `enqueue_notification_event()` only |
| **Async always** | Queue → worker → provider; never block POS/checkout |
| **Idempotent** | `idempotency_key` on events prevents duplicate sends |
| **Channel-agnostic** | `NotificationChannel` interface; add SMS/Teams later |
| **Configurable** | Rules, templates, schedules in UI — not hard-coded |
| **Auditable** | Every enqueue, send, retry, and admin change logged |
| **Multi-tenant** | Org-scoped RLS on all notification tables |

---

## 2. Phase 1 audit — existing system

### 2.1 What exists (reuse)

| Asset | Location | Reuse for |
|-------|----------|-----------|
| Cron worker | `apps/web/src/app/api/webhooks/process-queue/route.ts` | Add `process_notification_queue` step |
| Queue claim pattern | `security_alert_queue` + `admin_claim_security_alerts` | Notification delivery queue |
| Outbound webhook dispatch | `lib/security-alert-dispatch.ts` | Template for Slack/Teams/webhook channel |
| Audit logs | `audit_logs`, `platform_audit_logs` | Compliance; separate from user inbox |
| CSV export | `lib/csv-export.ts` | Report attachments |
| Cron infra | `.github/workflows/cron-process-queue.yml` (5 min) | Notification worker cadence |
| Health probe | `get_platform_health_probe` | System alert events |
| Invoice reminder data | `list_invoices_needing_reminder` | Scheduled AR emails |
| Low stock RPC | `list_low_stock_items` | Inventory alert rules |
| Sales analytics alerts | `sales_register_analytics` | POS manager alerts |

### 2.2 Gaps (build new)

| Gap | Severity |
|-----|----------|
| No transactional email (Resend/SMTP) | Critical |
| No WhatsApp / Telegram / SMS | Critical |
| No `notifications` tables or inbox | Critical |
| No tenant notification preferences | Critical |
| No rules engine | High |
| No template system | High |
| No scheduled report delivery | High |
| No PDF server generation | Medium |
| Bell icon non-functional (`app-header.tsx`) | High |
| No delivery tracking / DLQ for tenant messages | High |

### 2.3 Module integration map

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│     POS     │  │  Inventory  │  │ Accounting  │  │     CRM     │
│ complete_   │  │ low stock   │  │ JE posted   │  │ new customer│
│ sale, void  │  │ transfer    │  │ payment rcv │  │ VIP purchase│
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                │
       └────────────────┴────────────────┴────────────────┘
                                 │
                    enqueue_notification_event()
                                 │
                    ┌────────────▼────────────┐
                    │   notification_events   │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     notification_rules    notification_templates   scheduled_reports
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ notification_deliveries │
                    └────────────┬────────────┘
                                 │
                    process_notification_queue (cron)
                                 │
         ┌───────────┬───────────┼───────────┬───────────┐
         ▼           ▼           ▼           ▼           ▼
      Email      WhatsApp    Telegram    In-app     Webhook
     (Resend)   (Meta API)   (Bot API)   (DB+RT)   (HTTP)
```

---

## 3. Architecture

### 3.1 Layers

```
┌──────────────────────────────────────────────────────────────┐
│ Presentation                                                  │
│  /communications/*  — Dashboard, Queue, Templates, Rules,    │
│                       Schedules, History, Settings, Analytics │
│  app-header bell    — In-app notification inbox               │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ Application (apps/web/src/lib/notifications/)                 │
│  event-registry.ts      — Canonical event types + schemas     │
│  enqueue.ts             — Server-side publish API               │
│  rules-engine.ts        — Evaluate conditions → deliveries    │
│  template-renderer.ts   — Mustache/Handlebars placeholders    │
│  report-generator.ts    — PDF/CSV/Excel for scheduled reports │
│  channels/              — Channel adapters (Strategy pattern)   │
│    email.ts, whatsapp.ts, telegram.ts, in-app.ts, webhook.ts  │
│  worker.ts              — Claim, send, retry, complete          │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ API routes                                                    │
│  POST /api/webhooks/process-queue  — existing + notifications │
│  POST /api/communications/webhooks/whatsapp  — inbound        │
│  POST /api/communications/webhooks/telegram  — inbound        │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ Database (Supabase)                                           │
│  notification_events, notification_deliveries,                │
│  notification_templates, notification_rules,                  │
│  notification_recipient_groups, notification_schedules,       │
│  notification_channel_configs, notification_audit_log         │
│  RPCs: enqueue_notification_event, process_notification_queue │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Event flow (never block transactions)

```
1. Business RPC completes (e.g. complete_sale) — COMMIT
2. AFTER COMMIT: PERFORM enqueue_notification_event(...)
3. Return success JSON to client immediately
4. Cron worker (every 1–5 min):
   a. Claim pending deliveries (SKIP LOCKED)
   b. Resolve template + recipients from rules
   c. Render body (text/html/markdown)
   d. Call channel adapter
   e. Record sent/failed + provider response
   f. Retry with exponential backoff (max 5)
   g. Move to dead_letter after max attempts
```

### 3.3 Idempotency

```sql
enqueue_notification_event(
  p_org_id,
  p_event_type,      -- 'pos.sale_completed'
  p_entity_type,     -- 'sale'
  p_entity_id,       -- sale UUID
  p_payload,         -- JSONB context
  p_idempotency_key  -- e.g. sale_id || ':sale_completed'
)
-- ON CONFLICT (organization_id, idempotency_key) DO NOTHING
```

### 3.4 Channel adapter interface (future-proof)

```typescript
interface NotificationChannel {
  readonly channel: "email" | "whatsapp" | "telegram" | "in_app" | "webhook" | "sms" | "push";
  send(ctx: DeliveryContext): Promise<DeliveryResult>;
  supportsAttachments: boolean;
  supportsReadReceipts: boolean;
}
```

Adding SMS = implement `SmsChannel`, register in worker — no rule engine changes.

---

## 4. Database schema (migration `00078_notification_platform.sql`)

### 4.1 Enums

```sql
CREATE TYPE notification_channel AS ENUM (
  'email', 'whatsapp', 'telegram', 'in_app', 'webhook',
  'sms', 'push', 'teams', 'slack'  -- future-ready
);

CREATE TYPE notification_delivery_status AS ENUM (
  'pending', 'processing', 'sent', 'delivered', 'read',
  'failed', 'dead_letter', 'cancelled'
);

CREATE TYPE notification_priority AS ENUM ('low', 'normal', 'high', 'critical');

CREATE TYPE notification_content_format AS ENUM ('plain', 'html', 'markdown');
```

### 4.2 Core tables

#### `notification_events` — immutable event log

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| organization_id | UUID FK | RLS |
| event_type | TEXT | `pos.sale_completed` |
| entity_type | TEXT | `sale` |
| entity_id | UUID | nullable |
| payload | JSONB | event context |
| priority | notification_priority | |
| idempotency_key | TEXT | UNIQUE per org |
| created_at | TIMESTAMPTZ | |
| processed_at | TIMESTAMPTZ | when rules evaluated |

#### `notification_deliveries` — outbound queue

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| organization_id | UUID FK | |
| event_id | UUID FK | |
| channel | notification_channel | |
| recipient_type | TEXT | `user`, `role`, `group`, `email`, `phone` |
| recipient_ref | TEXT | user_id / role / group_id / address |
| template_id | UUID FK | nullable |
| subject | TEXT | |
| body | TEXT | rendered |
| body_format | notification_content_format | |
| attachments | JSONB | `[{name, url, mime}]` |
| status | notification_delivery_status | |
| attempts | INT | default 0 |
| max_attempts | INT | default 5 |
| next_attempt_at | TIMESTAMPTZ | |
| provider_message_id | TEXT | |
| provider_response | JSONB | |
| last_error | TEXT | |
| sent_at, delivered_at, read_at | TIMESTAMPTZ | |
| idempotency_key | TEXT | UNIQUE per org |
| created_at | TIMESTAMPTZ | |

Indexes: `(organization_id, status, next_attempt_at)` WHERE status IN ('pending','failed').

#### `notification_templates`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| organization_id | UUID FK | null = system template |
| code | TEXT | `pos.sale_completed.manager` |
| channel | notification_channel | |
| name | TEXT | |
| subject_template | TEXT | |
| body_template | TEXT | with `{{placeholders}}` |
| body_format | notification_content_format | |
| is_active | BOOLEAN | |
| version | INT | |

#### `notification_rules`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| organization_id | UUID FK | |
| name | TEXT | |
| event_type | TEXT | or `*` |
| conditions | JSONB | `[{field, op, value}]` |
| channels | notification_channel[] | |
| recipient_spec | JSONB | roles, users, groups |
| template_id | UUID FK | per channel map optional |
| priority | notification_priority | |
| store_ids | UUID[] | branch filter |
| time_restrictions | JSONB | `{days, hours}` |
| is_active | BOOLEAN | |
| sort_order | INT | |

Example conditions JSON:
```json
[
  { "field": "payload.total", "op": "gt", "value": 10000 },
  { "field": "payload.store_id", "op": "in", "value": ["uuid-1"] }
]
```

#### `notification_recipient_groups`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| organization_id | UUID FK | |
| name | TEXT | `Finance Managers` |
| member_user_ids | UUID[] | |
| member_emails | TEXT[] | external |
| member_phones | TEXT[] | WhatsApp |
| telegram_chat_ids | TEXT[] | |

#### `notification_channel_configs` — encrypted credentials per org

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| organization_id | UUID FK | |
| channel | notification_channel | UNIQUE(org, channel) |
| is_enabled | BOOLEAN | |
| config | JSONB | provider-specific (use vault for secrets) |
| created_by | UUID | |

WhatsApp config: `{ phone_number_id, waba_id, access_token_ref }`  
Telegram config: `{ bot_token_ref, default_chat_id }`  
Email config: `{ from_name, from_email, reply_to, provider: 'resend' }`

#### `notification_schedules`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| organization_id | UUID FK | |
| name | TEXT | `Daily Sales Summary` |
| report_type | TEXT | `sales.daily`, `financial.pnl` |
| cron_expression | TEXT | `0 7 * * *` |
| timezone | TEXT | org TZ |
| channels | notification_channel[] | |
| recipient_spec | JSONB | |
| template_id | UUID FK | |
| export_format | TEXT | `pdf`, `csv`, `xlsx` |
| last_run_at | TIMESTAMPTZ | |
| next_run_at | TIMESTAMPTZ | |
| is_active | BOOLEAN | |

#### `in_app_notifications` — user inbox

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| organization_id | UUID FK | |
| user_id | UUID FK | |
| delivery_id | UUID FK | nullable |
| title | TEXT | |
| body | TEXT | |
| link | TEXT | deep link |
| read_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

#### `notification_audit_log`

All admin actions: template edit, rule change, channel config, manual retry.

### 4.3 Key RPCs

```sql
-- Called from business RPCs AFTER commit (or via trigger)
enqueue_notification_event(p_org_id, p_event_type, p_entity_type, p_entity_id, p_payload, p_idempotency_key)

-- Evaluates rules → creates delivery rows
process_notification_events(p_limit)

-- Worker claims deliveries
claim_notification_deliveries(p_limit)  -- FOR UPDATE SKIP LOCKED

-- Worker marks result
complete_notification_delivery(p_id, p_status, p_provider_message_id, p_response, p_error)

-- Schedule runner (cron)
run_notification_schedules()

-- Admin
list_notification_dashboard(p_org_id)
retry_notification_delivery(p_id)
```

---

## 5. Canonical event catalog

### POS
| Event | Trigger | Key payload fields |
|-------|---------|-------------------|
| `pos.sale_completed` | `complete_sale` tail | receipt_no, total, customer, cashier, store |
| `pos.sale_voided` | void RPC | receipt_no, reason, amount |
| `pos.refund_completed` | return RPC | receipt_no, amount |
| `pos.shift_opened` | open session | register, staff |
| `pos.shift_closed` | close session | variance, totals |

### Inventory
| Event | Trigger |
|-------|---------|
| `inventory.low_stock` | scheduled scan / stock change |
| `inventory.out_of_stock` | stock hits 0 |
| `inventory.negative_stock_attempt` | complete_sale stock check |
| `inventory.stock_adjustment` | adjustment RPC |

### Purchasing
| Event | Trigger |
|-------|---------|
| `purchasing.request_created` | PO create |
| `purchasing.approved` | approval workflow |
| `purchasing.goods_received` | GRN |

### Accounting
| Event | Trigger |
|-------|---------|
| `accounting.payment_received` | receivable collection |
| `accounting.payment_failed` | webhook failure |
| `accounting.journal_posted` | JE post |
| `accounting.period_closed` | fiscal close |
| `accounting.reconciliation_completed` | bank recon |

### CRM
| Event | Trigger |
|-------|---------|
| `crm.customer_created` | customer insert |
| `crm.vip_purchase` | rule: high value + tagged VIP |
| `crm.complaint_logged` | helpdesk ticket |

### Security
| Event | Trigger |
|-------|---------|
| `security.login_failed` | `log_security_event` |
| `security.new_device_login` | new device fingerprint |
| `security.permission_changed` | role/member update |

### System
| Event | Trigger |
|-------|---------|
| `system.backup_completed` | maintenance RPC |
| `system.backup_failed` | maintenance RPC |
| `system.queue_backlog` | health probe threshold |
| `system.api_failure` | Sentry / health |

---

## 6. Channel integrations

### 6.1 Email (Phase 6) — Resend recommended

- Env: `RESEND_API_KEY` (platform) or per-org via channel config
- HTML templates with org branding (logo URL from `organizations`)
- Attachments: generated PDF/CSV stored in Supabase Storage, signed URL in email
- Bounce handling: Resend webhooks → update delivery status

### 6.2 WhatsApp (Phase 4) — Meta Cloud API

- Per-org WABA connection in Settings → Channels
- Template messages for outbound (Meta pre-approval required)
- Session messages within 24h window
- Media: invoice PDF upload → `document` message type
- Webhook: `POST /api/communications/webhooks/whatsapp` for delivery receipts

### 6.3 Telegram (Phase 5) — Bot API

- Org creates bot via @BotFather, stores token in vault
- `sendMessage`, `sendDocument` for reports
- Support groups/channels via chat_id in recipient groups
- Webhook optional for read callbacks

### 6.4 In-app (Phase 12)

- Insert `in_app_notifications` row
- Supabase Realtime subscription on `in_app_notifications` for bell badge
- Mark read on click

### 6.5 Future channels

| Channel | Adapter stub | Notes |
|---------|--------------|-------|
| SMS | `channels/sms.ts` | Twilio/Africa's Talking |
| Push | `channels/push.ts` | FCM via service worker |
| Teams | `channels/teams.ts` | Extend security webhook pattern |
| Slack | `channels/slack.ts` | Already partially exists |
| Webhook | `channels/webhook.ts` | HMAC-signed outbound |

---

## 7. Rules engine

```
ON event_received:
  FOR each active rule WHERE rule.event_type = event.type OR rule.event_type = '*':
    IF evaluate_conditions(rule.conditions, event.payload):
      IF within_time_restrictions(rule, org.timezone):
        FOR each channel IN rule.channels:
          recipients = resolve_recipients(rule.recipient_spec, event)
          FOR each recipient:
            template = resolve_template(rule, channel, event.type)
            body = render(template, event.payload)
            INSERT notification_deliveries (...)
```

Condition operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `matches` (regex).

Recipient spec:
```json
{
  "roles": ["manager", "finance"],
  "groups": ["uuid-finance-managers"],
  "users": ["uuid-user"],
  "include_entity_actor": true
}
```

---

## 8. Scheduled reports (Phase 8–9)

Cron `run_notification_schedules()` every minute:

1. Select schedules WHERE `next_run_at <= now()` AND `is_active`
2. Generate report via existing RPCs (`profit_and_loss`, `sales_register_analytics`, `list_low_stock_items`)
3. Render to CSV (existing) / PDF (new: `@react-pdf/renderer` or Puppeteer on worker)
4. Enqueue delivery with attachment
5. Update `last_run_at`, compute `next_run_at` from cron + timezone

Report types:
| Code | Source RPC | Formats |
|------|------------|---------|
| `sales.daily` | dashboard_stats + sales list | PDF, CSV |
| `sales.weekly` | sales_register_analytics | PDF, CSV |
| `financial.pnl` | profit_and_loss | PDF |
| `financial.balance_sheet` | balance_sheet | PDF |
| `inventory.stock` | list_low_stock_items | CSV, Excel |
| `inventory.movement` | stock movements | CSV |

Branding: org name, logo (`organizations.logo_url`), footer, optional watermark in PDF template.

---

## 9. Notification Center UI (Phase 12)

Route: `/communications` (tenant app, requires `settings` or new `communications` permission)

| Page | Path | Features |
|------|------|----------|
| Dashboard | `/communications` | Sent today, queued, failed, delivery rate, channel breakdown |
| Queue | `/communications/queue` | Pending/processing deliveries, cancel |
| Templates | `/communications/templates` | CRUD, preview, placeholders help |
| Rules | `/communications/rules` | Visual rule builder |
| Schedules | `/communications/schedules` | Cron builder + report picker |
| History | `/communications/history` | Filterable delivery log |
| Failed | `/communications/failed` | Retry bulk/single |
| Settings | `/communications/settings` | Channel configs |
| Recipients | `/communications/recipients` | Groups management |
| Analytics | `/communications/analytics` | 30-day charts |

Bell icon (`app-header.tsx`): dropdown with last 20 in-app notifications, unread count badge, link to inbox.

---

## 10. Security (Phase 14)

| Action | Permission |
|--------|------------|
| View own in-app notifications | authenticated member |
| View delivery history | `user_can_manage(org)` |
| Edit templates/rules/channels | `user_can_manage(org)` |
| Retry failed deliveries | `user_can_manage(org)` |
| View provider secrets | never in UI — vault refs only |
| Platform system alerts | `platform_admin` |

- RLS on all tables: `organization_id IN user_organization_ids()`
- Write policies: `user_can_manage(organization_id)`
- Audit: `notification_audit_log` on every config change
- Webhook inbound: verify Meta/Telegram signatures
- Rate limit: max 100 notifications/org/minute (configurable)

---

## 11. Performance & scalability (Phases 15–17)

### Targets

| Tier | Throughput | Architecture |
|------|------------|--------------|
| Standard | 100/min | Single worker, batch 50 |
| Growth | 1,000/min | Worker batch 200, 5-min cron |
| Enterprise | 10,000/min | Dedicated worker route, horizontal cron shards by org_id hash |

### Guarantees

- Business RPCs: **0 ms** added latency (enqueue is same transaction tail or async trigger)
- Worker isolated from POS path
- `FOR UPDATE SKIP LOCKED` prevents double-send
- Idempotency keys prevent duplicate events
- Dead-letter queue for manual intervention
- Index on `(status, next_attempt_at)` for worker poll

### Monitoring

- Extend `get_platform_health_probe` with `notification_queue_depth`
- Sentry capture on channel adapter failures
- Dashboard analytics for delivery rate SLA

---

## 12. Implementation plan

### Sprint 0 — Foundation (Week 1)
- [ ] Migration `00078_notification_platform.sql` — schema + core RPCs
- [ ] `lib/notifications/` package structure
- [ ] `enqueue_notification_event` wired into `complete_sale` (pilot)
- [ ] Extend `process-queue` with `process_notification_deliveries`
- [ ] In-app channel + bell icon functional

### Sprint 1 — Email (Week 2)
- [ ] Resend integration (`channels/email.ts`)
- [ ] Template renderer with placeholders
- [ ] Templates UI (CRUD)
- [ ] Team invite email (replace copy-link)
- [ ] Invoice reminder email (replace manual log)

### Sprint 2 — Rules & recipients (Week 3)
- [ ] Rules engine (DB + evaluator)
- [ ] Rules UI
- [ ] Recipient groups UI
- [ ] POS high-value sale rule (pilot)
- [ ] Low stock scheduled scan → event

### Sprint 3 — Telegram (Week 4)
- [ ] Bot API channel adapter
- [ ] Channel config UI
- [ ] Manager alerts via Telegram
- [ ] Daily sales report to Telegram group

### Sprint 4 — WhatsApp (Week 5)
- [ ] Meta Cloud API adapter
- [ ] Template message management
- [ ] Payment confirmation + invoice PDF
- [ ] Inbound delivery webhook

### Sprint 5 — Scheduled reports (Week 6)
- [ ] `notification_schedules` runner
- [ ] PDF generation (`@react-pdf/renderer`)
- [ ] Excel export (ExcelJS)
- [ ] Schedules UI + cron builder
- [ ] Daily/weekly/monthly presets

### Sprint 6 — Notification Center UI (Week 7)
- [x] Dashboard, queue, history, failed retry pages
- [x] Analytics charts
- [x] Permissions + audit log viewer

### Sprint 7 — Module rollout (Week 8)
- [x] Inventory events (`stock_adjustment`, `out_of_stock`, low-stock scan)
- [x] Accounting events (`payment_received`, `journal_posted`)
- [x] CRM / helpdesk events (`customer_created`, `complaint_logged`)
- [x] Security events (tenant-scoped `login_failed`)
- [x] System health alerts (`queue_backlog` + health probe depths)

### Sprint 8 — Hardening (Week 9)
- [x] Load test 1,000/min (`npm run load-test:notifications`)
- [x] Security review (`docs/NOTIFICATION_SECURITY_REVIEW.md`)
- [x] User documentation (`docs/COMMUNICATIONS_USER_GUIDE.md`)
- [x] DLQ admin tools (inspect / retry / cancel / purge + rate limits)

---

## 13. Environment variables

```bash
# Platform defaults (fallback when org has no channel config)
RESEND_API_KEY=
NOTIFICATION_FROM_EMAIL=notifications@yourdomain.com
NOTIFICATION_FROM_NAME=NexusERP

# WhatsApp (platform webhook verification)
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=

# Telegram
TELEGRAM_WEBHOOK_SECRET=

# Worker
CRON_SECRET=                    # existing
NOTIFICATION_BATCH_SIZE=50
NOTIFICATION_MAX_ATTEMPTS=5

# Feature flags
NOTIFICATION_EMAIL_ENABLED=true
NOTIFICATION_WHATSAPP_ENABLED=false
NOTIFICATION_TELEGRAM_ENABLED=false
```

---

## 14. Module integration contract

### From SQL (preferred for atomicity)

```sql
-- At end of complete_sale, after sale committed:
PERFORM public.enqueue_notification_event(
  p_organization_id,
  'pos.sale_completed',
  'sale',
  v_sale_id,
  jsonb_build_object(
    'receipt_no', v_receipt_no,
    'total', v_total,
    'customer_name', COALESCE(p_customer_name, v_cust_name),
    'store_id', p_store_id,
    'cashier_id', v_staff_id
  ),
  v_sale_id::text || ':sale_completed'
);
```

### From TypeScript (server actions / API routes)

```typescript
import { publishNotificationEvent } from "@/lib/notifications/enqueue";

await publishNotificationEvent({
  organizationId: orgId,
  eventType: "crm.customer_created",
  entityType: "customer",
  entityId: customerId,
  payload: { name, phone, email },
  idempotencyKey: `${customerId}:created`,
});
```

### Never do

```typescript
// ❌ Direct provider call from POS or sale RPC
await resend.emails.send({ ... });
await fetch("https://api.telegram.org/...");
```

---

## 15. Testing strategy

| Layer | Tests |
|-------|-------|
| Rules engine | Unit: condition evaluation |
| Template renderer | Unit: placeholder substitution |
| Channel adapters | Integration: mock provider APIs |
| enqueue RPC | DB: idempotency, RLS |
| Worker | Integration: claim → send → complete |
| E2E | Sale → notification appears in inbox |

---

## 16. References

- Existing queue pattern: `supabase/migrations/20260618000049_auth_throttle_phase_b.sql`
- Process worker: `apps/web/src/app/api/webhooks/process-queue/route.ts`
- Security dispatch: `apps/web/src/lib/security-alert-dispatch.ts`
- Extension roadmap: `docs/EXTENSIONS.md`, `ODOO_ROADMAP.md`

# Notification Center — Security Review (Sprint 8)

Scope: tenant communications surface (Sprints 0–8). Review date: 2026-07-08.

## Trust boundaries

| Boundary | Control |
|----------|---------|
| Business RPCs → providers | Never call Resend/Telegram/WhatsApp from POS/checkout; only `enqueue_notification_event` |
| Worker | Service role via `/api/webhooks/process-queue` guarded by `CRON_SECRET` / webhook secret |
| Tenant UI RPCs | `user_can_manage_communications(org)` on manage/queue/DLQ/audit/rules |
| Channel secrets | Stored in `notification_channel_configs`; UI shows hints only, not full tokens |
| Inbound WhatsApp | Signature/`verify_token` on webhook route |

## Findings & mitigations (this sprint)

| ID | Severity | Finding | Mitigation |
|----|----------|---------|------------|
| N8-1 | Medium | Unbounded enqueue could amplify outbound cost | Per-org rate limit (default 100/min) on `enqueue_notification_event`; configurable column |
| N8-2 | Medium | DLQ retry used generic `user_can_manage` | Aligned retry/cancel/list to `user_can_manage_communications` |
| N8-3 | Low | Cancel could not clear `dead_letter` | Cancel accepts failed + dead_letter; bulk cancel + purge audited |
| N8-4 | Low | Load-test RPC abuse | `load_test_enqueue_notifications` restricted to service_role |
| N8-5 | Info | Body/payload exposed in delivery detail | Truncate body to 4k; only communications managers |

## Residual risks

- Shared platform Telegram/WhatsApp tokens: prefer per-org tokens in production.
- Without Upstash, HTTP rate limits on auth routes are per-instance only (existing platform note).
- Template rendering is placeholder substitution only — do not put untrusted HTML into email if expanding formats later.

## Checklist before production

- [ ] `CRON_SECRET` set and cron workflow authenticated  
- [ ] Resend / Telegram / WhatsApp feature flags intentional  
- [ ] Default Telegram/WhatsApp rules remain inactive until credentials verified  
- [ ] Review Communications → Audit after first week  
- [ ] Run `npm run load-test:notifications` against staging once  

## Not in scope

- Full formal pen-test  
- SMS/Push/Teams adapters  
- Cross-tenant Superadmin abuse beyond existing platform admin RLS  

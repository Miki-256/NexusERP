# Phase 2+ Extension Points

This document describes where to plug in subscriptions, offline mode, payment webhooks, and hardware—without refactoring core v1 flows.

## Subscriptions (billing)

**Hook:** `organizations` table — add columns:

- `plan_id`, `subscription_status`, `stripe_customer_id`, `trial_ends_at`

**Integration points:**

1. **Middleware** (`apps/web/src/lib/supabase/middleware.ts`) — redirect suspended tenants to `/billing`.
2. **Platform admin** — new route group `app/(platform)/` for tenant list and usage (transaction count query on `sales`).
3. **Webhooks** — `app/api/webhooks/stripe/route.ts` updates org status; use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS.

**Suggested providers:** Stripe Billing, Paddle.

---

## Offline PWA

**Hook:** POS checkout in `apps/web/src/components/pos/payment-modal.tsx` and `complete_sale` RPC.

**Approach:**

1. Add `next-pwa` or Workbox to `apps/web`.
2. Queue sales in IndexedDB when `navigator.onLine === false`:

   ```ts
   interface PendingSale {
     idempotencyKey: string;
     payload: CheckoutInput;
     createdAt: string;
   }
   ```

3. Background sync replays `complete_sale` when online; idempotency key prevents duplicates.
4. Catalog/inventory: cache product list in IndexedDB on shift open; show stale-stock warning offline.

**Conflict resolution:** Server wins on stock; client shows retry UI if `Insufficient stock` returns after sync.

---

## Payment provider webhooks

**Hook:** `payments` table — add `external_id`, `webhook_status`.

**Integration points:**

1. Edge Function or `app/api/webhooks/[provider]/route.ts` per provider (M-Pesa, Telebirr, etc.).
2. Match webhook `reference` to `payments.reference`; set `status` from `pending` → `completed` or `failed`.
3. Optional: create sale in `pending` state until webhook confirms (v1.1 manager approval flow).

**Do not** replace manual cashier confirmation in v1 until reconciliation UI exists.

---

## ESC/POS printers & cash drawer

**Hook:** `ReceiptPrint` component (`apps/web/src/components/pos/receipt-print.tsx`).

**Options:**

1. **Browser print** (current) — sufficient for USB printers driven by OS.
2. **Local agent** — small Electron or Go service on `localhost:9xxx` accepting JSON receipt → ESC/POS bytes.
3. **QZ Tray** — browser plugin for raw printing without Electron.

Add `printMode: 'browser' | 'escpos'` to org receipt settings.

---

## Accounting / e-commerce API

**Hook:** `audit_logs` + `sales` tables.

Expose read-only REST:

- `GET /api/v1/sales?since=` — service role per tenant API key in `organization_api_keys`.
- Webhooks on `sale.completed` via Supabase Database Webhooks or pg_notify → Edge Function.

---

## Multi-language

**Hook:** UI strings in components; org `default_locale` on `organizations`.

Use `next-intl` with message files under `apps/web/messages/{en,am}/`.

---

## PIN lock (register)

**Hook:** `PosScreen` session gate after `openShift`.

Store bcrypt hash on `registers.pin_hash`; unlock modal sets session cookie `register_unlocked_until`.

---

## File map (quick reference)

| Feature | Primary files |
|---------|----------------|
| Checkout | `payment-modal.tsx`, `supabase/.../functions.sql` → `complete_sale` |
| Tenancy | `migrations/*_rls_policies.sql`, `org-context.ts` |
| Auth/onboarding | `(auth)/*`, `onboarding/page.tsx`, `create_organization_with_owner` |
| Receipts | `receipt-print.tsx` |
| Reports | `dashboard_stats` RPC, `reports/page.tsx` |

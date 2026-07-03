# Deploying NexusERP

## Pre-prod (Vercel)

Deploy from the **repo root** (not `apps/web`):

```bash
cd ~/NexusERP
npm run deploy:live      # ← makes https://nexus-erp-preprod.vercel.app live (exits when Ready; safe to Ctrl+C after)
npm run deploy:preview   # test URL only — does NOT update the main pre-prod site
```

**First-time / new machine:** authenticate with Vercel before deploying:

```bash
npx vercel login
```

Or use a deploy token (no browser):

```bash
# Create at https://vercel.com/account/tokens → Full Account or scoped to nexus-erp-preprod
VERCEL_TOKEN=your_token npm run deploy:live
```

Do not commit `VERCEL_TOKEN` to git.

**Live pre-prod:** https://nexus-erp-preprod.vercel.app

### “Ready” but not live on the main URL?

Vercel has two deployment types:

| Command | Vercel environment | Main URL updated? |
|---------|-------------------|-----------------|
| `vercel deploy` or `npm run deploy:preview` | **Preview** | **No** — you get a one-off URL like `nexus-erp-preprod-xxxxx.vercel.app` |
| `vercel deploy --prod` or `npm run deploy:live` | **Production** | **Yes** — `nexus-erp-preprod.vercel.app` points to this build |

Your screenshot shows **Source: `vercel deploy`** (no `--prod`), so the build succeeded (**Ready**) but only exists as a **preview**. That is why POS/tools fixes are not visible on the stable pre-prod link.

**Fix:** run from repo root:

```bash
npm run deploy:live
```

Or in the Vercel dashboard: open the deployment → **⋯** menu → **Promote to Production** (if enabled on your plan).

After a production deploy, open https://nexus-erp-preprod.vercel.app and hard-refresh (or use a private tab) to bypass cache.

### Required Vercel env vars (Production + Preview)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client key |
| `SUPABASE_URL` | Server runtime (same as above) |
| `SUPABASE_ANON_KEY` | Server runtime (same publishable key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Webhooks, admin API |
| `NEXT_PUBLIC_APP_URL` | Auth redirects (`https://nexus-erp-preprod.vercel.app`) |
| `POS_WEBHOOK_SECRET` | Mobile-money webhook auth |
| `CRON_SECRET` | Vercel Cron auth (auto-set if using Vercel dashboard cron) |
| `UPSTASH_REDIS_REST_URL` | **Production:** shared login/signup rate limits across Vercel instances |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token (pair with URL above) |

Optional: `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` for error monitoring.

### Upstash Redis (Week 1 — production stability)

Without Upstash, each Vercel lambda uses its own in-memory rate limit bucket — login throttling is ineffective under load.

1. Create a free database at [upstash.com](https://upstash.com) → **Redis** → copy REST URL + token.
2. Vercel → **Project → Settings → Environment Variables** → add for **Production** (and Preview if testing):
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. Redeploy (`npm run deploy:live`).

The app logs a one-time warning in production if these are missing.

### Connection pooler (Phase 2)

The Next.js app uses **Supabase REST** (`@supabase/supabase-js`) — no Postgres wire pooler needed for normal API routes.

For **CLI and scripts** (`npm run db:baseline`, `supabase db query`), use the Supavisor pooler URL from Supabase Dashboard → **Connect** → **Transaction pooler** (port `6543`). Optional env: `SUPABASE_POOLER_URL`.

### Phase 2 database scale

```bash
npm run phase2:db
```

Adds daily sales rollups (`org_daily_sales_summary`), faster `profit_and_loss`, scoped DB audit triggers, and 90-day log retention. The webhook cron refreshes rollups automatically.

### Phase 3 enterprise scale

```bash
npm run phase3:db      # Archive tables + BRIN index + maintenance RPC
npm run phase3:load    # 50 VU POS load test (p95 < 500ms target)
```

**Read replica (Supabase Pro):** Dashboard → **Project Settings → Infrastructure → Read Replicas**. Set on Vercel:

| Variable | Value |
|----------|--------|
| `SUPABASE_READ_URL` | Read replica API URL (same format as primary) |

Financials, reports, and dashboard use `createReportingClient()` which routes to the replica when set.

**Cold sales archive:** `archive_cold_sales()` moves completed sales older than 24 months (when daily summaries exist). Maintenance **auto-archives every Sunday UTC**. Force manually:

```bash
curl -X POST "${APP_URL}/api/webhooks/process-queue?archive_sales=1" \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

Or set `FORCE_SALES_ARCHIVE=true` on Vercel. Disable with `SKIP_SALES_ARCHIVE=true`.

### Supabase migrations

Apply SQL migrations in order from `supabase/migrations/` via:

1. **SQL Editor** (easiest): paste each new migration file and Run
2. **CLI**: `npm run db:push` (after `npx supabase login` + `npx supabase link --project-ref YOUR_REF`)

Verify remote RPCs:

```bash
npm run verify:supabase
```

### Supabase auth redirects

In Supabase Dashboard → **Authentication → URL Configuration**:

| Setting | Value |
|---------|--------|
| **Site URL** | `https://nexus-erp-preprod.vercel.app` (or `http://localhost:3003` for local only) |
| **Redirect URLs** | Add **all** of these (one per line): |

```
https://nexus-erp-preprod.vercel.app/auth/callback
http://localhost:3003/auth/callback
```

**Important:** If Site URL is `http://localhost:3000`, email links (confirm / reset) will open port **3000** and fail. The app runs on port **3003** locally (`npm run dev`).

Set `NEXT_PUBLIC_APP_URL` on Vercel to your public URL so server-side auth redirects match production.

## CI (GitHub Actions)

On push/PR to `main`:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run build`

On push to `main`, optionally verifies Supabase RPCs if repo secrets are set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Webhook queue cron

Vercel Hobby allows **at most one cron run per day**. This project uses **daily at 06:00 UTC** (`0 6 * * *` in `vercel.json`).

Each cron run also refreshes 7 days of sales rollups, prunes `db_activity_log` (90 days), and returns `queue_depth` and `stale_rollup_orgs` in the JSON response.

Set `CRON_SECRET` in Vercel — cron invocations send `Authorization: Bearer <CRON_SECRET>`.

### Every 5 minutes (recommended for production)

Pick **one** of these (in addition to the daily Vercel cron):

**Option A — GitHub Actions (free, repo secrets required)**

Add repository secrets:

| Secret | Example |
|--------|---------|
| `APP_URL` | `https://nexus-erp-preprod.vercel.app` |
| `CRON_SECRET` | same value as Vercel `CRON_SECRET` |

Workflow `.github/workflows/cron-process-queue.yml` runs `*/5 * * * *` when secrets are set.

**Option B — External scheduler (cron-job.org)**

1. Create job → URL: `https://nexus-erp-preprod.vercel.app/api/webhooks/process-queue`
2. Method: `POST`
3. Header: `Authorization: Bearer <CRON_SECRET>`
4. Schedule: every 5 minutes

**Option C — Local / server cron**

```bash
CRON_SECRET=your-secret APP_URL=https://nexus-erp-preprod.vercel.app npm run cron:process-queue
```

**Option D — Vercel Pro**

Change `vercel.json` schedule to `*/5 * * * *`.

The process-queue endpoint drains **payment webhooks** and the **sale ledger post queue** (async GL after POS checkout when `pos_auto_post_sales` is enabled). Without a 5-minute cron, ledger posts accumulate — check **Admin → Health** or `GET /api/health` (returns `503` when `ledger_queue_pending` > 100).

### Public health probe

Uptime monitors and `.github/workflows/cron-health-monitor.yml` call:

```bash
curl -s https://nexus-erp-preprod.vercel.app/api/health
```

Response includes `status` (`healthy` | `degraded`), `ledger_queue_pending`, and `payment_webhook_queue_pending`. No auth required.

**Full launch checklist:** [docs/LAUNCH-OPS.md](docs/LAUNCH-OPS.md) and `npm run setup:launch-ops`.

### Week 1 production checklist

```bash
npm run week1:production   # migration 00054, payments index, 90-day rollup backfill
```

Then:

1. Set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` on Vercel → redeploy
2. Enable 5-min cron (GitHub Actions secrets or cron-job.org)
3. Confirm cron health: response should show `summaries_refreshed` > 0 and `stale_rollup_orgs: 0`

Monitor rollup freshness (SQL Editor):

```sql
SELECT * FROM rollup_freshness_stale_orgs(2);
```

### Week 2 query efficiency

```bash
npm run week2:production   # financials_chart_data, list_products_page, dashboard_bundle RPCs
```

- **Financials** uses rollup-based chart RPC (no full sales/payments scan).
- **Products** paginates 50 per page with server-side search.
- **Dashboard** loads one `dashboard_bundle` RPC instead of 6+ parallel queries.

### Week 3 security hardening

```bash
npm run week3:production
```

- **Auth throttle** + **log_security_event**: `anon` revoked — login API uses service role only.
- **POS RPCs** (`complete_sale`, `verify_pos_staff_pin`, etc.) keep `anon` for kiosk mode.
- **Product deactivate** clears DB image URL and removes storage file; cron purges orphan images (50/run).

### Month 2 enterprise scale

```bash
npm run month2:production
```

- **RLS hot tables** use `user_has_org_access(organization_id)` (faster than `IN (SELECT user_organization_ids())`).
- **POS audit trim:** `db_activity_log` triggers removed from `sales` / `payments` (business events still in `audit_logs`).
- **Cold sales archive:** auto on **Sunday UTC** each maintenance run; GitHub workflow `cron-enterprise-archive.yml` as backup.
- **Read replica:** set `SUPABASE_READ_URL` on Vercel — financials, dashboard, sales register use `createReportingClient()`.

## Local dev

```bash
npm run dev          # http://localhost:3003
npm run build
npm run typecheck
npm run test:e2e:install   # once — Playwright Chromium
npm run test:e2e           # smoke: login → POS sale → sales list
```

Copy `apps/web/.env.local.example` → `apps/web/.env.local` and fill in Supabase keys.

For E2E smoke, also set in `apps/web/.env.local`:

- `E2E_EMAIL` / `E2E_PASSWORD` — owner or manager account
- `E2E_STAFF_PIN` — cashier PIN for POS staff on the register
- Optional: `E2E_BASE_URL` (defaults to `http://localhost:3003`)
- Optional: `E2E_REGISTER_ID`, `E2E_STAFF_NAME`

Apply migration **`20260618000045_phase_c_quality.sql`** for sales register performance indexes.

### Production launch checklist (certification gates)

Run before pointing real businesses at production:

```bash
npm run verify:supabase          # all RPCs through latest migration
npm run verify:production-env    # env vars (use CHECK_PRODUCTION_ENV=1 in CI to fail on gaps)
npm run test:unit
npm run test:integration         # needs E2E_EMAIL/E2E_PASSWORD against staging DB
curl -sf https://YOUR_APP/api/health | jq .
```

**Must be true on launch day:**

| Gate | How to verify |
|------|----------------|
| Migrations applied | `npm run verify:supabase` — no missing RPCs |
| 5-min cron | GitHub Action `cron-process-queue.yml` green, or external scheduler |
| Upstash | `UPSTASH_REDIS_*` set on Vercel Production |
| Health monitor | Uptime tool on `GET /api/health`; alert on HTTP 503 |
| Ledger queue | Admin → Health shows 0 failed ledger posts |

### Backup & recovery runbook

**Database (Supabase)**

1. **Pro plan:** enable **Point-in-Time Recovery** in Supabase Dashboard → Project Settings → Database → Backups.
2. **Restore drill (quarterly):** clone project to a staging ref, run `npm run verify:supabase`, smoke login + one POS sale.
3. **Logical export:** Admin → Organizations → Export JSON (`/api/admin/organizations/[id]/export`) for tenant-level disaster recovery.

**Application (Vercel)**

1. **Rollback:** Vercel → Deployments → select previous **Production** deployment → **Promote to Production** (instant revert of app code; does not revert DB migrations).
2. **Migration rollback:** Supabase migrations are forward-only. To undo a bad migration, apply a corrective SQL migration — never edit applied migration files.

**Cold data archive**

- Completed sales older than 24 months archive to `sales_archive` when daily summaries exist. Weekly GitHub workflow `cron-enterprise-archive.yml` is backup.

### Rollback strategy

| Layer | Action | Time |
|-------|--------|------|
| App code | Vercel promote previous deployment | Minutes |
| Env vars | Revert in Vercel settings + redeploy | Minutes |
| Database schema | Forward corrective migration only | Hours (planned) |
| Tenant data | PITR restore or org JSON re-import | Hours |

After any rollback, run `GET /api/health` and check Admin → Health queue depths.

## CI secrets (optional)

| Secret | Enables |
|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` + key | Remote RPC verify on `main` |
| `APP_URL` + `CRON_SECRET` | GitHub Actions 5-min process-queue cron + weekly sales archive |
| `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_STAFF_PIN` | Playwright smoke on `main` |
| `E2E_BASE_URL` | Run E2E against pre-prod instead of starting dev server |

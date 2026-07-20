# Launch ops — do once before production

Complete these four gates. Run the automated checker after each step:

```bash
npm run setup:launch-ops
```

---

## 0. Super-admin Health (recommended daily)

**URL:** `/admin/health` on the live app

After migrations `00174`–`00175` and a recent deploy, platform admins with **write** (super_admin / support) can:

| Control | Purpose |
|---------|---------|
| **Drain queues now** | Runs the same worker as the 5-min process-queue cron (ledger, refunds, webhooks, notifications, HR webhooks, maintenance) and records a heartbeat |
| **Retry** on ledger errors | Re-posts a single failed sale→GL queue row |
| **Post up to 100** on unposted-by-org | Batch-posts historical completed sales missing journal entries for that tenant |
| Queue cards | Ledger, payment webhooks, refund ledger, notifications, HR webhooks, stale rollups, unposted sales |
| Org tables | Ledger backlog and unposted completed sales by tenant (with auto-post flag) |

Security role is **read-only** on this page (no Drain / Retry).

If the amber banner says queues need attention: click **Drain queues now**, then **Refresh**. If heartbeat stays stale (>15 min), fix the GitHub Actions cron (section 1).

### Support L4 (tenant workspace + org inspect)

Requires migration `00178`.

| Control | Where | Purpose |
|---------|--------|---------|
| **Inspect** | Health org backlog / unposted tables | Per-tenant ledger queue, webhook queue, unposted sales sample; Retry / Post up to 100 |
| **Ops inspector** | Admin → Organization detail | Same drill-down embedded on the org page |
| **Open tenant workspace** | Admin → Organization detail | Temporary **manager** membership (max 4h), reason required (≥8 chars), platform-audited; amber banner with **End support session** |

Rules:

- Only `super_admin` / `support` (write roles) can start/end sessions
- Suspended orgs cannot be opened
- Ending (or expiry) removes/restores the temporary membership
- Every start/end/expire writes `support.session_*` to platform audit

### Per-tenant module overrides (L5)

Requires migration `00179`.

On **Admin → Organization**, use **Module overrides** to enable/disable modules for one tenant without changing the global flags page. Effective access = org override (if set) → global flag → plan modules. Tenant navigation already filters via `get_org_enabled_app_ids`.

### Governance — dual control (L5)

Requires migration `00180`.

| Control | Where | Purpose |
|---------|--------|---------|
| **Approvals** | `/admin/approvals` | Second write admin approves/rejects suspend & export |
| **Dual control settings** | Admin → Settings | Enable/disable; choose actions; solo-admin bypass |
| **Suspend / Export** | Org detail | Reason required; queues approval when dual control applies |
| **Audit filters** | Admin → Audit | Server-side actor, prefix (org/support/governance), date range |

With **solo_admin_bypass** (default on), a single write admin can still act immediately. With two+ write admins, suspend/export need a different reviewer.

---

## 1. Five-minute process-queue cron (GitHub Actions)

**Workflow:** `.github/workflows/cron-process-queue.yml` (every 5 min)

### Set repository secrets

GitHub → **your repo** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret | Value |
|--------|--------|
| `APP_URL` | `https://nexus-erp-preprod.vercel.app` (no trailing slash) |
| `CRON_SECRET` | Same value as Vercel (see step 2) |

### CLI (if `gh` is installed)

```bash
# Generate a secret if you do not have one yet:
node scripts/setup-launch-ops.mjs --generate-cron-secret

# After adding CRON_SECRET to apps/web/.env.local:
npm run setup:launch-ops:github
```

### Verify

```bash
CRON_SECRET=your-secret APP_URL=https://nexus-erp-preprod.vercel.app npm run cron:process-queue
```

Or: **Actions** → **Process webhook queue** → **Run workflow** → should succeed.

Prefer verifying from **Admin → Health** after a drain: heartbeat should show a recent success time.

---

## 2. `CRON_SECRET` on Vercel (+ Upstash)

### Vercel → Project → Settings → Environment Variables → **Production**

| Variable | Required | Notes |
|----------|----------|--------|
| `CRON_SECRET` | Yes | Random 32+ char string; must match GitHub secret |
| `UPSTASH_REDIS_REST_URL` | Yes | From [upstash.com](https://upstash.com) → Redis → REST |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Pair with URL above |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Needed for `/api/health` probe |

Generate cron secret:

```bash
node scripts/setup-launch-ops.mjs --generate-cron-secret
```

**Redeploy after changing env vars:**

```bash
npm run deploy:live
```

---

## 3. Health monitor (GitHub Actions)

**Workflow:** `.github/workflows/cron-health-monitor.yml` (every 5 min)

Uses the same `APP_URL` secret. Fails the workflow when:

- `GET /api/health` returns HTTP **503**
- JSON `status` is **degraded**

### Enable notifications

GitHub → **Settings** → **Notifications** → watch this repo for **Failed workflows**.

Optional: add Slack/email via GitHub Actions marketplace.

### Verify (after deploy with middleware fix)

Public liveness (no auth):

```bash
curl -sS https://nexus-erp-preprod.vercel.app/api/health | jq .
# Expect: {"ok":true,"status":"healthy","mode":"liveness",...} and HTTP 200
```

Detailed queue probe (requires `CRON_SECRET`):

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" https://nexus-erp-preprod.vercel.app/api/health | jq .
# Expect ledger/webhook queue depths; HTTP 503 when degraded
```

---

## 4. Integration tests (staging DB)

Add to `apps/web/.env.local`:

```env
LOAD_TEST_EMAIL=owner@your-org.com
LOAD_TEST_PASSWORD=your-password
# or E2E_EMAIL / E2E_PASSWORD
```

Run:

```bash
npm run verify:supabase
npm run test:integration
```

Or full launch check:

```bash
npm run setup:launch-ops
```

---

## CI secrets (recommended for `main`)

| Secret | Enables |
|--------|---------|
| `APP_URL` + `CRON_SECRET` | 5-min cron + health monitor |
| `E2E_EMAIL` + `E2E_PASSWORD` | Integration + Playwright smoke |
| `NEXT_PUBLIC_SUPABASE_URL` + key | RPC verify on push |
| `SUPABASE_SERVICE_ROLE_KEY` | Health probe + platform integration tests |

---

## Production readiness audits (CI)

These run on every PR / push to `main`:

| Command | Purpose |
|---------|---------|
| `npm run audit:stable-rpcs` | STABLE/VOLATILE write RPC safety |
| `npm run audit:rls` | Block legacy RLS patterns in new migrations |
| `npm run audit:api-auth` | Cron/webhook/admin route auth markers |
| `npm run audit:financials-scope` | Area-scoped financials data loading |
| `npm run audit:e2e` | Required Playwright specs present |
| `npm run audit:launch-ops` | Launch workflows + scripts wired |

Pre-launch local gate:

```bash
CHECK_PRODUCTION_ENV=1 npm run verify:production-env
npm run setup:launch-ops
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/api/health` returns login HTML | Redeploy latest code (middleware excludes public APIs) |
| Cron returns 401 | `CRON_SECRET` mismatch between Vercel and GitHub |
| Health 503 | Ledger/webhook queue backlog — run process-queue manually |
| Login rate limit weak | Set Upstash on Vercel Production and redeploy |

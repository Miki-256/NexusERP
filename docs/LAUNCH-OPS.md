# Launch ops — do once before production

Complete these four gates. Run the automated checker after each step:

```bash
npm run setup:launch-ops
```

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

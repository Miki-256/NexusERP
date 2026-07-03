#!/usr/bin/env bash
# External cron helper — run every 5 minutes via GitHub Actions, cron-job.org, or local cron.
# Requires CRON_SECRET and APP_URL in environment.
set -euo pipefail

APP_URL="${APP_URL:-${E2E_BASE_URL:-https://nexus-erp-preprod.vercel.app}}"
CRON_SECRET="${CRON_SECRET:?Set CRON_SECRET}"

tmp=$(mktemp)
http_code=$(curl -fsS -o "$tmp" -w "%{http_code}" -X POST "${APP_URL}/api/webhooks/process-queue" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json") || {
  echo "curl failed"
  exit 1
}

cat "$tmp"
echo ""
rm -f "$tmp"

if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
  echo "HTTP $http_code" >&2
  exit 1
fi


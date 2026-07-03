#!/usr/bin/env bash
# Stop dev servers and wipe Next.js cache. Run BEFORE starting dev — never while dev is running.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3003}"

if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "Stopping dev servers on ports 3000, 3001, ${PORT}…"
else
  echo "Stopping any stray Next.js dev processes…"
fi

for p in 3000 3001 "$PORT"; do
  lsof -ti:"$p" 2>/dev/null | xargs kill -9 2>/dev/null || true
done
pkill -f "next dev" 2>/dev/null || true
sleep 0.5

echo "Removing .next and webpack cache…"
rm -rf "$ROOT/.next" "$ROOT/node_modules/.cache"

echo "Done. Start dev with: PORT=${PORT} npm run dev"
echo "Or full safe start:    PORT=${PORT} npm run dev:fresh"

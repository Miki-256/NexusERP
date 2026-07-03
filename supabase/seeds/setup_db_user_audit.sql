-- One-time setup: audit DBeaver / direct DB users (e.g. dagi)
-- Run in Supabase SQL Editor AFTER enabling pgAudit in Dashboard → Database → Extensions
--
-- What you get:
--   INSERT / UPDATE / DELETE → queryable in db_activity_log (see queries below)
--   SELECT / all SQL         → Supabase Dashboard → Logs → Postgres Logs (pgAudit)

-- 1) Apply migration 20260618000046_db_user_audit.sql first (or run that file contents here)

-- 2) Enable pgAudit for dagi (and any other DBeaver user)
SELECT public.enable_db_user_pgaudit('dagi');

-- For another user:
-- SELECT public.enable_db_user_pgaudit('analyst_maria');

-- 3) Verify pgAudit is configured
SELECT rolname, rolconfig
FROM pg_roles
WHERE rolname IN ('dagi')
  AND rolconfig IS NOT NULL;

-- ── View write activity (INSERT/UPDATE/DELETE) ──
SELECT *
FROM public.list_db_activity_log('dagi', NULL, 50, 0);

-- Or directly:
SELECT id, db_user, action, table_name, row_id, created_at
FROM db_activity_log
WHERE db_user = 'dagi'
ORDER BY created_at DESC
LIMIT 50;

-- Filter by table:
SELECT *
FROM db_activity_log
WHERE db_user = 'dagi' AND table_name = 'sales'
ORDER BY created_at DESC;

-- ── View SELECT activity (pgAudit → Postgres Logs) ──
-- Supabase Dashboard → Logs → Postgres Logs → Log Explorer, run:
/*
SELECT
  cast(t.timestamp as datetime) AS timestamp,
  event_message
FROM postgres_logs AS t
  CROSS JOIN unnest(metadata) AS m
  CROSS JOIN unnest(m.parsed) AS p
WHERE event_message LIKE 'AUDIT%'
  AND event_message ILIKE '%dagi%'
ORDER BY timestamp DESC
LIMIT 100;
*/

-- Also filter READ / SELECT:
/*
WHERE event_message LIKE 'AUDIT%READ%SELECT%'
*/

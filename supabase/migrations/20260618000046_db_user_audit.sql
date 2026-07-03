-- Audit direct database users (e.g. DBeaver: dagi) — writes in db_activity_log,
-- SELECT/read/write/ddl in Supabase Postgres Logs via pgAudit (enable extension in Dashboard first).

CREATE TABLE IF NOT EXISTS public.db_activity_log (
  id BIGSERIAL PRIMARY KEY,
  db_user TEXT NOT NULL DEFAULT session_user,
  client_addr INET,
  application_name TEXT,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_id TEXT,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_db_activity_log_created
  ON public.db_activity_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_db_activity_log_user
  ON public.db_activity_log (db_user, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_db_activity_log_table
  ON public.db_activity_log (table_name, created_at DESC);

COMMENT ON TABLE public.db_activity_log IS
  'Row-level audit for INSERT/UPDATE/DELETE by any DB role (incl. DBeaver). SELECT is logged via pgAudit → Postgres Logs.';

CREATE OR REPLACE FUNCTION public.log_db_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO db_activity_log (
      db_user, client_addr, application_name, action, table_name, row_id, new_data
    )
    VALUES (
      session_user,
      inet_client_addr(),
      NULLIF(current_setting('application_name', true), ''),
      'INSERT',
      TG_TABLE_NAME,
      to_jsonb(NEW) ->> 'id',
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO db_activity_log (
      db_user, client_addr, application_name, action, table_name, row_id, old_data, new_data
    )
    VALUES (
      session_user,
      inet_client_addr(),
      NULLIF(current_setting('application_name', true), ''),
      'UPDATE',
      TG_TABLE_NAME,
      to_jsonb(NEW) ->> 'id',
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO db_activity_log (
      db_user, client_addr, application_name, action, table_name, row_id, old_data
    )
    VALUES (
      session_user,
      inet_client_addr(),
      NULLIF(current_setting('application_name', true), ''),
      'DELETE',
      TG_TABLE_NAME,
      to_jsonb(OLD) ->> 'id',
      to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- Attach row audit to all public tables except log/meta tables.
DO $$
DECLARE
  r RECORD;
  v_skip TEXT[] := ARRAY[
    'db_activity_log',
    'schema_migrations',
    'supabase_migrations'
  ];
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND NOT (tablename = ANY (v_skip))
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_%I_row_changes ON public.%I',
      r.tablename,
      r.tablename
    );
    EXECUTE format(
      'CREATE TRIGGER audit_%I_row_changes
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.log_db_activity()',
      r.tablename,
      r.tablename
    );
  END LOOP;
END $$;

-- pgAudit: logs SELECT, INSERT, UPDATE, DELETE, DDL per database role → Postgres Logs.
CREATE EXTENSION IF NOT EXISTS pgaudit;

CREATE OR REPLACE FUNCTION public.enable_db_user_pgaudit(p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_role) THEN
    RAISE EXCEPTION 'Role % does not exist', p_role;
  END IF;
  EXECUTE format(
    'ALTER ROLE %I SET pgaudit.log TO ''read, write, ddl, role, function''',
    p_role
  );
  EXECUTE format('ALTER ROLE %I SET pgaudit.log_relation TO ''on''', p_role);
  EXECUTE format('ALTER ROLE %I SET pgaudit.log_statement_once TO ''off''', p_role);
END;
$$;

COMMENT ON FUNCTION public.enable_db_user_pgaudit IS
  'Enable full pgAudit (incl. SELECT) for a DB role. View logs: Supabase Dashboard → Logs → Postgres Logs.';

-- Enable for dagi if present (safe no-op pattern via function).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dagi') THEN
    PERFORM public.enable_db_user_pgaudit('dagi');
  END IF;
END $$;

-- Query helpers (run as postgres / service role).
CREATE OR REPLACE FUNCTION public.list_db_activity_log(
  p_db_user TEXT DEFAULT NULL,
  p_table_name TEXT DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  db_user TEXT,
  client_addr INET,
  application_name TEXT,
  action TEXT,
  table_name TEXT,
  row_id TEXT,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.db_user,
    l.client_addr,
    l.application_name,
    l.action,
    l.table_name,
    l.row_id,
    l.old_data,
    l.new_data,
    l.created_at
  FROM db_activity_log l
  WHERE (p_db_user IS NULL OR l.db_user = p_db_user)
    AND (p_table_name IS NULL OR l.table_name = p_table_name)
  ORDER BY l.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500))
  OFFSET GREATEST(0, p_offset);
$$;

REVOKE ALL ON FUNCTION public.list_db_activity_log FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_db_activity_log TO postgres;
GRANT EXECUTE ON FUNCTION public.enable_db_user_pgaudit TO postgres;

-- Only superuser/service should read raw audit rows directly.
REVOKE ALL ON public.db_activity_log FROM PUBLIC;
GRANT SELECT ON public.db_activity_log TO postgres;

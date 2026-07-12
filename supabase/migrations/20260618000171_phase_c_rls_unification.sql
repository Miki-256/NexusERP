-- Phase C: unify tenant RLS policies on user_has_org_access() (indexed hot path from 00057).

CREATE OR REPLACE FUNCTION public._phase_c_rls_rewrite_org_access(expr TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT := COALESCE(expr, '');
  v_prev TEXT;
BEGIN
  LOOP
    v_prev := v;
    v := regexp_replace(
      v,
      '(\w+\.)?organization_id\s+IN\s*\(\s*SELECT\s+public\.user_organization_ids\s*\(\s*\)\s*\)',
      'public.user_has_org_access(\1organization_id)',
      'gi'
    );
    EXIT WHEN v = v_prev;
  END LOOP;
  RETURN NULLIF(v, '');
END;
$$;

DO $$
DECLARE
  pol RECORD;
  v_qual TEXT;
  v_with_check TEXT;
  v_sql TEXT;
  v_roles TEXT;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        COALESCE(qual, '') LIKE '%user_organization_ids()%'
        OR COALESCE(with_check, '') LIKE '%user_organization_ids()%'
      )
    ORDER BY tablename, policyname
  LOOP
    v_qual := public._phase_c_rls_rewrite_org_access(pol.qual);
    v_with_check := public._phase_c_rls_rewrite_org_access(pol.with_check);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname,
      pol.schemaname,
      pol.tablename
    );

    v_sql := format('CREATE POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    IF pol.permissive IS NOT NULL THEN
      v_sql := v_sql || format(' AS %s', upper(pol.permissive));
    END IF;

    v_sql := v_sql || format(' FOR %s', pol.cmd);

    IF pol.roles IS NOT NULL AND array_length(pol.roles, 1) > 0 THEN
      SELECT string_agg(quote_ident(r), ', ')
      INTO v_roles
      FROM unnest(pol.roles) AS r;
      v_sql := v_sql || ' TO ' || v_roles;
    END IF;

    IF v_qual IS NOT NULL THEN
      v_sql := v_sql || ' USING (' || v_qual || ')';
    END IF;

    IF v_with_check IS NOT NULL THEN
      v_sql := v_sql || ' WITH CHECK (' || v_with_check || ')';
    END IF;

    EXECUTE v_sql;
  END LOOP;
END $$;

DROP FUNCTION public._phase_c_rls_rewrite_org_access(TEXT);

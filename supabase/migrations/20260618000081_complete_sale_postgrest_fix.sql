-- Repair: expose complete_sale to PostgREST for POS (anon + authenticated).
-- Run this if checkout returns 404 on /rpc/complete_sale even though the function exists.

-- Drop legacy 10-parameter overload (confuses PostgREST matching).
DROP FUNCTION IF EXISTS public.complete_sale(
  UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, JSONB
);

-- Grant EXECUTE on every complete_sale overload (current signature + any stragglers).
DO $$
DECLARE
  r RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'complete_sale'
  ) THEN
    RAISE EXCEPTION
      'complete_sale is missing. Apply 20260618000075_pos_gift_cards_loyalty.sql first.';
  END IF;

  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'complete_sale'
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.complete_sale(%s) TO anon, authenticated, service_role',
      r.args
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

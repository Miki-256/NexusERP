-- Run this in Supabase SQL Editor if migration 00021 failed with "function name is not unique".
-- Then re-run the full 20260618000021_multi_org_switcher.sql file.

DROP FUNCTION IF EXISTS public.get_my_workspace();
DROP FUNCTION IF EXISTS public.get_my_workspace(UUID);
DROP FUNCTION IF EXISTS public.get_my_app_permissions();
DROP FUNCTION IF EXISTS public.get_my_app_permissions(UUID);

-- Run this if Phase A failed with "cannot change return type of existing function"
-- on admin_list_platform_admins. Then re-run 00025 from the PATCH section onward,
-- or re-run the full 20260618000025_platform_admin_phase_a_fix.sql file.

DROP FUNCTION IF EXISTS public.admin_list_platform_admins();
DROP FUNCTION IF EXISTS public.admin_grant_platform_admin(TEXT);
DROP FUNCTION IF EXISTS public.admin_grant_platform_admin(TEXT, platform_admin_role);
DROP FUNCTION IF EXISTS public.admin_set_platform_admin_role(UUID, platform_admin_role);

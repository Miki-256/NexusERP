-- Phase 0: Security hardening
-- Fixes audit findings S6, S7, S8 on the inherited foundation.
-- Safe to run after the initial schema + rls + functions migrations.

-- ---------------------------------------------------------------------------
-- S7: Remove the open INSERT on organizations.
-- Org creation must go through create_organization_with_owner() (SECURITY DEFINER),
-- which bypasses RLS, so no client-facing INSERT policy is needed.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS org_insert ON organizations;

-- ---------------------------------------------------------------------------
-- S6: Replace the weakened stores policy.
-- Old policy allowed writes when request.jwt.claims was merely present
-- (i.e. any authenticated user). Split into member-SELECT + manager-WRITE.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS stores_all ON stores;

CREATE POLICY stores_select ON stores FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY stores_insert ON stores FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY stores_update ON stores FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

CREATE POLICY stores_delete ON stores FOR DELETE
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

-- ---------------------------------------------------------------------------
-- S8: Lock down direct writes to sales / sale_lines.
-- Completed sales are written by complete_sale() (SECURITY DEFINER, bypasses RLS),
-- and voids by void_sale(). Clients only need SELECT. Keep INSERT for the RPC's
-- caller context unnecessary -> remove permissive update; restrict mutations.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS sales_update ON sales;
DROP POLICY IF EXISTS sales_insert ON sales;

CREATE POLICY sales_update_manage ON sales FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
  );

-- sale_lines: make client access read-only (writes happen via SECURITY DEFINER RPCs).
DROP POLICY IF EXISTS sale_lines_all ON sale_lines;

CREATE POLICY sale_lines_select ON sale_lines FOR SELECT
  USING (
    sale_id IN (
      SELECT id FROM sales WHERE organization_id IN (SELECT public.user_organization_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- S5: Platform-admin model + non-approved orgs cannot operate.
-- Add an explicit approval/status to organizations and a platform_admins table
-- so Super Admin checks are enforced server-side (S1).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_status') THEN
    CREATE TYPE org_status AS ENUM ('pending', 'active', 'suspended');
  END IF;
END $$;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS status org_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- Existing orgs are treated as active so we don't lock anyone out on migration.
UPDATE organizations SET status = 'active' WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- Server-side platform-admin check used by super-admin RPCs/policies.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;

-- Only platform admins can read the platform_admins table.
DROP POLICY IF EXISTS platform_admins_select ON platform_admins;
CREATE POLICY platform_admins_select ON platform_admins FOR SELECT
  USING (public.is_platform_admin());

-- Restrict org access to approved (active) orgs for normal members; platform
-- admins can see everything.
CREATE OR REPLACE FUNCTION public.user_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.organization_id
  FROM organization_members m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
    AND m.is_active = true
    AND (o.status = 'active' OR public.is_platform_admin());
$$;

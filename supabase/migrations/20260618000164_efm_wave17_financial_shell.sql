-- EFM Wave 17 — Fiori-grade financial shell preferences

CREATE TABLE IF NOT EXISTS public.user_financial_shell_preferences (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  default_area TEXT NOT NULL DEFAULT 'home',
  density TEXT NOT NULL DEFAULT 'cozy' CHECK (density IN ('cozy', 'compact')),
  pinned_tabs JSONB NOT NULL DEFAULT '[]'::jsonb,
  show_launchpad BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_financial_shell_prefs_user
  ON user_financial_shell_preferences(user_id);

ALTER TABLE user_financial_shell_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_financial_shell_prefs_select ON user_financial_shell_preferences;
CREATE POLICY user_financial_shell_prefs_select ON user_financial_shell_preferences FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND user_id = auth.uid()
  );
DROP POLICY IF EXISTS user_financial_shell_prefs_write ON user_financial_shell_preferences;
CREATE POLICY user_financial_shell_prefs_write ON user_financial_shell_preferences FOR ALL
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND user_id = auth.uid()
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND user_id = auth.uid()
  );

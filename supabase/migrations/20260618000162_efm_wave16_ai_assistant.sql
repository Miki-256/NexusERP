-- EFM Wave 16 — AI financial assistant schema

-- ---------------------------------------------------------------------------
-- Org-level AI assistant controls
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS financial_ai_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS financial_ai_provider TEXT NOT NULL DEFAULT 'internal'
    CHECK (financial_ai_provider IN ('internal', 'openai')),
  ADD COLUMN IF NOT EXISTS financial_ai_model TEXT NOT NULL DEFAULT 'gpt-4o-mini';

-- ---------------------------------------------------------------------------
-- Conversation threads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_ai_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Financial Q&A',
  period_from DATE,
  period_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_ai_conversations_org_user
  ON financial_ai_conversations(organization_id, user_id, updated_at DESC);

ALTER TABLE financial_ai_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_ai_conversations_select ON financial_ai_conversations;
CREATE POLICY financial_ai_conversations_select ON financial_ai_conversations FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (user_id = auth.uid() OR public.user_can_manage(organization_id))
  );
DROP POLICY IF EXISTS financial_ai_conversations_write ON financial_ai_conversations;
CREATE POLICY financial_ai_conversations_write ON financial_ai_conversations FOR ALL
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND user_id = auth.uid()
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_ai_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES financial_ai_conversations(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_ai_messages_conversation
  ON financial_ai_messages(conversation_id, created_at);

ALTER TABLE financial_ai_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_ai_messages_select ON financial_ai_messages;
CREATE POLICY financial_ai_messages_select ON financial_ai_messages FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS financial_ai_messages_write ON financial_ai_messages;
CREATE POLICY financial_ai_messages_write ON financial_ai_messages FOR ALL
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND EXISTS (
      SELECT 1 FROM financial_ai_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND EXISTS (
      SELECT 1 FROM financial_ai_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Saved / generated insights
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_ai_insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  period_from DATE,
  period_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_ai_insights_org
  ON financial_ai_insights(organization_id, created_at DESC);

ALTER TABLE financial_ai_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_ai_insights_select ON financial_ai_insights;
CREATE POLICY financial_ai_insights_select ON financial_ai_insights FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS financial_ai_insights_write ON financial_ai_insights;
CREATE POLICY financial_ai_insights_write ON financial_ai_insights FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

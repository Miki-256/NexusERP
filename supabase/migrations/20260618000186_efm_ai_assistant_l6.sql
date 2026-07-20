-- EFM AI Assistant L6 — shared org conversations + always-draft AI journal suggestions

-- ---------------------------------------------------------------------------
-- Shared visibility
-- ---------------------------------------------------------------------------
ALTER TABLE public.financial_ai_conversations
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'org'));

CREATE INDEX IF NOT EXISTS idx_financial_ai_conversations_org_shared
  ON financial_ai_conversations(organization_id, updated_at DESC)
  WHERE visibility = 'org';

DROP POLICY IF EXISTS financial_ai_conversations_select ON financial_ai_conversations;
CREATE POLICY financial_ai_conversations_select ON financial_ai_conversations FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND (
      user_id = auth.uid()
      OR visibility = 'org'
      OR public.user_can_manage(organization_id)
    )
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

DROP POLICY IF EXISTS financial_ai_messages_select ON financial_ai_messages;
CREATE POLICY financial_ai_messages_select ON financial_ai_messages FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND EXISTS (
      SELECT 1 FROM financial_ai_conversations c
      WHERE c.id = conversation_id
        AND (
          c.user_id = auth.uid()
          OR c.visibility = 'org'
          OR public.user_can_manage(c.organization_id)
        )
    )
  );

DROP POLICY IF EXISTS financial_ai_messages_write ON financial_ai_messages;
CREATE POLICY financial_ai_messages_write ON financial_ai_messages FOR ALL
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND EXISTS (
      SELECT 1 FROM financial_ai_conversations c
      WHERE c.id = conversation_id
        AND (
          c.user_id = auth.uid()
          OR (c.visibility = 'org' AND public.user_has_org_access(c.organization_id))
        )
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND EXISTS (
      SELECT 1 FROM financial_ai_conversations c
      WHERE c.id = conversation_id
        AND (
          c.user_id = auth.uid()
          OR (c.visibility = 'org' AND public.user_has_org_access(c.organization_id))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Conversation RPCs (visibility-aware)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_financial_ai_conversation(UUID, TEXT, DATE, DATE);

CREATE OR REPLACE FUNCTION public.create_financial_ai_conversation(
  p_org_id UUID,
  p_title TEXT DEFAULT 'Financial Q&A',
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_visibility TEXT DEFAULT 'private'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row financial_ai_conversations%ROWTYPE;
  v_visibility TEXT := lower(trim(COALESCE(p_visibility, 'private')));
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_visibility NOT IN ('private', 'org') THEN
    RAISE EXCEPTION 'visibility must be private or org';
  END IF;

  INSERT INTO financial_ai_conversations (
    organization_id, user_id, title, period_from, period_to, visibility
  )
  VALUES (
    p_org_id,
    auth.uid(),
    COALESCE(NULLIF(trim(p_title), ''), 'Financial Q&A'),
    p_from,
    p_to,
    v_visibility
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'period_from', v_row.period_from,
    'period_to', v_row.period_to,
    'visibility', v_row.visibility,
    'created_at', v_row.created_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_financial_ai_conversation(UUID, TEXT, DATE, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_financial_ai_conversation_visibility(
  p_conversation_id UUID,
  p_visibility TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv financial_ai_conversations%ROWTYPE;
  v_visibility TEXT := lower(trim(COALESCE(p_visibility, 'private')));
BEGIN
  SELECT * INTO v_conv FROM financial_ai_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;
  IF v_conv.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_visibility NOT IN ('private', 'org') THEN
    RAISE EXCEPTION 'visibility must be private or org';
  END IF;

  UPDATE financial_ai_conversations
  SET visibility = v_visibility, updated_at = now()
  WHERE id = p_conversation_id
  RETURNING * INTO v_conv;

  RETURN jsonb_build_object(
    'id', v_conv.id,
    'visibility', v_conv.visibility,
    'updated_at', v_conv.updated_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_financial_ai_conversation_visibility(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_financial_ai_conversations(
  p_org_id UUID,
  p_limit INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY row_data->>'updated_at' DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', c.id,
          'title', c.title,
          'period_from', c.period_from,
          'period_to', c.period_to,
          'visibility', c.visibility,
          'is_owner', c.user_id = auth.uid(),
          'updated_at', c.updated_at,
          'message_count', (
            SELECT COUNT(*) FROM financial_ai_messages m WHERE m.conversation_id = c.id
          )
        ) AS row_data
        FROM financial_ai_conversations c
        WHERE c.organization_id = p_org_id
          AND (
            c.user_id = auth.uid()
            OR c.visibility = 'org'
          )
        ORDER BY c.updated_at DESC
        LIMIT v_limit
      ) rows
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_financial_ai_conversations(UUID, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_financial_ai_conversation(p_conversation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv financial_ai_conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conv FROM financial_ai_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF NOT public.user_has_org_access(v_conv.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_conv.user_id <> auth.uid()
     AND v_conv.visibility <> 'org'
     AND NOT public.user_can_manage(v_conv.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'id', v_conv.id,
    'organization_id', v_conv.organization_id,
    'title', v_conv.title,
    'period_from', v_conv.period_from,
    'period_to', v_conv.period_to,
    'visibility', v_conv.visibility,
    'is_owner', v_conv.user_id = auth.uid(),
    'created_at', v_conv.created_at,
    'updated_at', v_conv.updated_at,
    'messages', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'role', m.role,
            'content', m.content,
            'metadata', m.metadata,
            'created_at', m.created_at
          )
          ORDER BY m.created_at
        )
        FROM financial_ai_messages m
        WHERE m.conversation_id = v_conv.id
      ),
      '[]'::jsonb
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_financial_ai_conversation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.append_financial_ai_message(
  p_conversation_id UUID,
  p_role TEXT,
  p_content TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv financial_ai_conversations%ROWTYPE;
  v_msg financial_ai_messages%ROWTYPE;
BEGIN
  SELECT * INTO v_conv FROM financial_ai_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF NOT public.user_has_org_access(v_conv.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_conv.user_id <> auth.uid()
     AND NOT (v_conv.visibility = 'org') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_role NOT IN ('user', 'assistant', 'system') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  INSERT INTO financial_ai_messages (conversation_id, organization_id, role, content, metadata)
  VALUES (p_conversation_id, v_conv.organization_id, p_role, trim(p_content), COALESCE(p_metadata, '{}'::jsonb))
  RETURNING * INTO v_msg;

  UPDATE financial_ai_conversations
  SET updated_at = now(),
      title = CASE
        WHEN p_role = 'user' AND title = 'Financial Q&A' THEN left(trim(p_content), 80)
        ELSE title
      END
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'id', v_msg.id,
    'role', v_msg.role,
    'content', v_msg.content,
    'metadata', v_msg.metadata,
    'created_at', v_msg.created_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.append_financial_ai_message(UUID, TEXT, TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_financial_ai_conversation(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv financial_ai_conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conv FROM financial_ai_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_conv.user_id <> auth.uid() AND NOT public.user_can_manage(v_conv.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM financial_ai_conversations WHERE id = p_conversation_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_financial_ai_conversation(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Always-draft AI journal suggestion (reuses Wave 14 approval path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_ai_journal_entry_draft(
  p_org_id UUID,
  p_date DATE,
  p_memo TEXT,
  p_lines JSONB,
  p_journal_code TEXT DEFAULT 'GEN',
  p_conversation_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ai_enabled BOOLEAN;
  v_line JSONB;
  v_resolved JSONB := '[]'::jsonb;
  v_account_id UUID;
  v_code TEXT;
  v_entry_id UUID;
  v_memo TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(financial_ai_enabled, true) INTO v_ai_enabled
  FROM organizations WHERE id = p_org_id;
  IF v_ai_enabled IS FALSE THEN
    RAISE EXCEPTION 'Financial AI is disabled for this organization';
  END IF;

  IF p_conversation_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM financial_ai_conversations c
      WHERE c.id = p_conversation_id
        AND c.organization_id = p_org_id
        AND (
          c.user_id = auth.uid()
          OR c.visibility = 'org'
          OR public.user_can_manage(p_org_id)
        )
    ) THEN
      RAISE EXCEPTION 'Conversation not found or access denied';
    END IF;
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'At least two journal lines are required';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_account_id := NULLIF(v_line->>'accountId', '')::UUID;
    v_code := NULLIF(trim(v_line->>'account_code'), '');
    IF v_account_id IS NULL AND v_code IS NOT NULL THEN
      SELECT id INTO v_account_id
      FROM accounts
      WHERE organization_id = p_org_id
        AND code = v_code
        AND COALESCE(is_active, true)
      LIMIT 1;
    END IF;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Unknown account (provide accountId or account_code): %',
        COALESCE(v_code, v_line->>'accountId', '?');
    END IF;

    v_resolved := v_resolved || jsonb_build_array(
      jsonb_build_object(
        'accountId', v_account_id,
        'debit', COALESCE((v_line->>'debit')::NUMERIC, 0),
        'credit', COALESCE((v_line->>'credit')::NUMERIC, 0),
        'description', NULLIF(v_line->>'description', '')
      )
    );
  END LOOP;

  v_memo := COALESCE(
    NULLIF(trim(p_memo), ''),
    'AI suggested journal entry (draft — requires approval)'
  );
  IF position('[AI suggestion]' in v_memo) = 0 THEN
    v_memo := '[AI suggestion] ' || v_memo;
  END IF;

  v_entry_id := public._post_journal_entry_balanced(
    p_org_id,
    COALESCE(NULLIF(trim(p_journal_code), ''), 'GEN'),
    COALESCE(p_date, current_date),
    v_memo,
    'ai_suggestion',
    p_conversation_id,
    v_resolved,
    auth.uid(),
    'draft'::journal_entry_status
  );

  RETURN jsonb_build_object(
    'journal_entry_id', v_entry_id,
    'status', 'draft',
    'source_type', 'ai_suggestion',
    'memo', v_memo,
    'approve_path', '/financials?tab=journal',
    'conversation_id', p_conversation_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_ai_journal_entry_draft(UUID, DATE, TEXT, JSONB, TEXT, UUID) TO authenticated;

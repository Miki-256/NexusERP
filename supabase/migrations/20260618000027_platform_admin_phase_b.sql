-- Phase B: Support toolkit — user search, tenant lookup, org notes, broadcast & maintenance.

CREATE TABLE IF NOT EXISTS organization_support_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_email TEXT,
  note TEXT NOT NULL CHECK (char_length(trim(note)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_support_notes_org ON organization_support_notes(organization_id, created_at DESC);

ALTER TABLE organization_support_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_support_notes_select ON organization_support_notes;
CREATE POLICY org_support_notes_select ON organization_support_notes FOR SELECT
  USING (public.platform_admin_can_read());

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_admin_select ON platform_settings;
CREATE POLICY platform_settings_admin_select ON platform_settings FOR SELECT
  USING (public.platform_admin_can_read());

INSERT INTO platform_settings (key, value)
VALUES
  ('broadcast_banner', '{"enabled": false, "message": "", "variant": "info"}'::jsonb),
  ('maintenance_mode', '{"enabled": false, "message": "Nexus ERP is temporarily unavailable for maintenance.", "block_signup": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- User search & profiles
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_query TEXT,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  created_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  org_count BIGINT,
  is_platform_admin BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q TEXT := trim(COALESCE(p_query, ''));
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_q = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    (SELECT COUNT(*) FROM organization_members m WHERE m.user_id = u.id AND m.is_active) AS org_count,
    EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id) AS is_platform_admin
  FROM auth.users u
  WHERE lower(u.email) LIKE '%' || lower(v_q) || '%'
  ORDER BY u.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_search_users TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_user_profile(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_memberships JSONB;
  v_is_admin BOOLEAN;
  v_admin_role platform_admin_role;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_user FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = p_user_id) INTO v_is_admin;
  v_admin_role := NULL;
  IF v_is_admin THEN
    SELECT role INTO v_admin_role FROM platform_admins WHERE user_id = p_user_id;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'organization_id', o.id,
        'organization_name', o.name,
        'organization_status', o.status,
        'member_id', m.id,
        'role', m.role,
        'is_active', m.is_active,
        'joined_at', m.created_at
      )
      ORDER BY m.created_at
    ),
    '[]'::jsonb
  ) INTO v_memberships
  FROM organization_members m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_user_id;

  RETURN jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_user.id,
      'email', v_user.email,
      'created_at', v_user.created_at,
      'last_sign_in_at', v_user.last_sign_in_at,
      'email_confirmed_at', v_user.email_confirmed_at
    ),
    'is_platform_admin', v_is_admin,
    'platform_admin_role', v_admin_role,
    'memberships', v_memberships
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_user_profile TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_lookup_by_email(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_pending JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_user
  FROM auth.users
  WHERE lower(email) = lower(trim(COALESCE(p_email, '')));

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', false,
      'email', trim(p_email),
      'user', NULL,
      'memberships', '[]'::jsonb,
      'pending_invites', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'invite_id', si.id,
        'organization_id', si.organization_id,
        'organization_name', o.name,
        'role', si.role,
        'created_at', si.created_at
      )
      ORDER BY si.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_pending
  FROM staff_invites si
  JOIN organizations o ON o.id = si.organization_id
  WHERE lower(si.email) = lower(v_user.email)
    AND si.accepted_at IS NULL;

  RETURN (
    SELECT jsonb_build_object(
      'found', true,
      'email', v_user.email,
      'user', jsonb_build_object(
        'id', v_user.id,
        'email', v_user.email,
        'created_at', v_user.created_at,
        'last_sign_in_at', v_user.last_sign_in_at
      ),
      'memberships', (public.admin_get_user_profile(v_user.id)->'memberships'),
      'pending_invites', v_pending
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_lookup_by_email TO authenticated;

-- ---------------------------------------------------------------------------
-- Organization support notes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_org_support_notes(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'note', n.note,
          'author_email', n.author_email,
          'created_at', n.created_at
        )
        ORDER BY n.created_at DESC
      )
      FROM organization_support_notes n
      WHERE n.organization_id = p_org_id
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_org_support_notes TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_add_org_support_note(p_org_id UUID, p_note TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_email TEXT;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF trim(COALESCE(p_note, '')) = '' THEN
    RAISE EXCEPTION 'Note cannot be empty';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO organization_support_notes (organization_id, author_user_id, author_email, note)
  VALUES (p_org_id, auth.uid(), v_email, trim(p_note))
  RETURNING id INTO v_id;

  PERFORM public.log_platform_audit(
    'support.note_add',
    'organization',
    p_org_id,
    p_org_id,
    jsonb_build_object('note_id', v_id, 'preview', left(trim(p_note), 120))
  );

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_add_org_support_note TO authenticated;

-- ---------------------------------------------------------------------------
-- Platform settings (broadcast banner + maintenance mode)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_platform_broadcast()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE((value->>'enabled')::boolean, false) THEN value
    ELSE NULL
  END
  FROM platform_settings
  WHERE key = 'broadcast_banner';
$$;
GRANT EXECUTE ON FUNCTION public.get_platform_broadcast TO authenticated;

CREATE OR REPLACE FUNCTION public.get_platform_maintenance_status()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(value, '{"enabled": false}'::jsonb)
  FROM platform_settings
  WHERE key = 'maintenance_mode';
$$;
GRANT EXECUTE ON FUNCTION public.get_platform_maintenance_status TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.admin_get_platform_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN (
    SELECT jsonb_object_agg(key, value)
    FROM platform_settings
    WHERE key IN ('broadcast_banner', 'maintenance_mode')
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_platform_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_platform_settings(p_settings JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_banner JSONB;
  v_maintenance JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_banner := p_settings->'broadcast_banner';
  v_maintenance := p_settings->'maintenance_mode';

  IF v_banner IS NOT NULL THEN
    IF NOT public.platform_admin_can_write() THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    INSERT INTO platform_settings (key, value, updated_at, updated_by)
    VALUES ('broadcast_banner', v_banner, now(), auth.uid())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
    PERFORM public.log_platform_audit('settings.broadcast', 'platform_settings', NULL, NULL, v_banner);
  END IF;

  IF v_maintenance IS NOT NULL THEN
    IF NOT public.platform_admin_can_manage_admins() THEN
      RAISE EXCEPTION 'Only super admins can change maintenance mode';
    END IF;
    INSERT INTO platform_settings (key, value, updated_at, updated_by)
    VALUES ('maintenance_mode', v_maintenance, now(), auth.uid())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
    PERFORM public.log_platform_audit('settings.maintenance', 'platform_settings', NULL, NULL, v_maintenance);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_settings TO authenticated;

-- Include support notes in org detail
CREATE OR REPLACE FUNCTION public.admin_get_organization_detail(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_members JSONB;
  v_stores JSONB;
  v_status_history JSONB;
  v_notes JSONB;
  v_base JSONB;
BEGIN
  IF NOT public.platform_admin_can_read() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'member_id', m.id,
        'user_id', m.user_id,
        'email', u.email,
        'role', m.role,
        'is_active', m.is_active,
        'joined_at', m.created_at
      )
      ORDER BY m.created_at
    ),
    '[]'::jsonb
  ) INTO v_members
  FROM organization_members m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = p_org_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'store_id', s.id,
        'name', s.name,
        'created_at', s.created_at
      )
      ORDER BY s.name
    ),
    '[]'::jsonb
  ) INTO v_stores
  FROM stores s
  WHERE s.organization_id = p_org_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'action', l.action,
        'actor_email', l.actor_email,
        'payload', l.payload,
        'created_at', l.created_at
      )
      ORDER BY l.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_status_history
  FROM platform_audit_logs l
  WHERE l.organization_id = p_org_id
    AND l.entity_type = 'organization'
    AND l.action IN ('org.approve', 'org.suspend', 'org.reject', 'org.reactivate');

  v_notes := public.admin_list_org_support_notes(p_org_id);

  v_base := jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'status', v_org.status,
      'plan', v_org.plan,
      'currency', v_org.currency,
      'timezone', v_org.timezone,
      'tax_rate', v_org.tax_rate,
      'created_at', v_org.created_at,
      'updated_at', v_org.updated_at
    ),
    'members', v_members,
    'stores', v_stores,
    'status_history', v_status_history,
    'support_notes', v_notes,
    'stats', jsonb_build_object(
      'sales_count', (SELECT COUNT(*) FROM sales WHERE organization_id = p_org_id AND status = 'completed'),
      'sales_total', (SELECT COALESCE(SUM(total), 0) FROM sales WHERE organization_id = p_org_id AND status = 'completed')
    )
  );

  RETURN v_base;
END;
$$;

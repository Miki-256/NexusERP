-- Organization API keys for external catalog / integrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS org_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'default',
  key_prefix TEXT NOT NULL,
  key_secret_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_org_api_keys_prefix ON org_api_keys(key_prefix) WHERE revoked_at IS NULL;

ALTER TABLE org_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_api_keys_select ON org_api_keys;
CREATE POLICY org_api_keys_select ON org_api_keys FOR SELECT
  USING (public.user_can_manage(organization_id));

CREATE OR REPLACE FUNCTION public.create_org_api_key(
  p_organization_id UUID,
  p_label TEXT DEFAULT 'default'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw TEXT;
  v_prefix TEXT;
  v_hash TEXT;
BEGIN
  IF NOT public.user_can_manage(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_raw := 'nxk_' || encode(gen_random_bytes(24), 'hex');
  v_prefix := left(v_raw, 12);
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');

  INSERT INTO org_api_keys (organization_id, label, key_prefix, key_secret_hash)
  VALUES (p_organization_id, COALESCE(NULLIF(trim(p_label), ''), 'default'), v_prefix, v_hash);

  RETURN v_raw;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_org_api_key TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_org_api_key(p_api_key TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_prefix TEXT;
  v_hash TEXT;
BEGIN
  IF p_api_key IS NULL OR length(trim(p_api_key)) < 16 THEN
    RETURN NULL;
  END IF;
  v_prefix := left(trim(p_api_key), 12);
  v_hash := encode(digest(trim(p_api_key), 'sha256'), 'hex');

  SELECT organization_id INTO v_org_id
  FROM org_api_keys
  WHERE key_prefix = v_prefix
    AND key_secret_hash = v_hash
    AND revoked_at IS NULL
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    UPDATE org_api_keys SET last_used_at = now() WHERE key_prefix = v_prefix AND key_secret_hash = v_hash;
  END IF;

  RETURN v_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_org_api_keys(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', k.id,
          'label', k.label,
          'key_prefix', k.key_prefix,
          'created_at', k.created_at,
          'last_used_at', k.last_used_at
        )
        ORDER BY k.created_at DESC
      )
      FROM org_api_keys k
      WHERE k.organization_id = p_organization_id AND k.revoked_at IS NULL
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_org_api_keys TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_org_api_key(p_key_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM org_api_keys WHERE id = p_key_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Key not found'; END IF;
  IF NOT public.user_can_manage(v_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE org_api_keys SET revoked_at = now() WHERE id = p_key_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_org_api_key TO service_role;

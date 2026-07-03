-- Subscription Phase 2: tenant upgrade requests (manual approval, no Stripe).

CREATE TABLE IF NOT EXISTS plan_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_plan TEXT NOT NULL REFERENCES platform_plans(id),
  current_plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  note TEXT,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_change_requests_org ON plan_change_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_plan_change_requests_status ON plan_change_requests(status);

ALTER TABLE plan_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_change_requests_select ON plan_change_requests;
CREATE POLICY plan_change_requests_select ON plan_change_requests FOR SELECT
  USING (
    public.platform_admin_can_read()
    OR organization_id IN (SELECT public.user_organization_ids())
  );

DROP POLICY IF EXISTS plan_change_requests_insert ON plan_change_requests;
CREATE POLICY plan_change_requests_insert ON plan_change_requests FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage(organization_id)
    AND requested_by = auth.uid()
    AND status = 'pending'
  );

CREATE OR REPLACE FUNCTION public.request_plan_change(
  p_organization_id UUID,
  p_requested_plan TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current TEXT;
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.user_can_manage(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_plans WHERE id = p_requested_plan) THEN
    RAISE EXCEPTION 'Unknown plan: %', p_requested_plan;
  END IF;

  SELECT plan INTO v_current FROM organizations WHERE id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;
  IF v_current = p_requested_plan THEN
    RAISE EXCEPTION 'Already on the % plan', p_requested_plan;
  END IF;

  IF EXISTS (
    SELECT 1 FROM plan_change_requests
    WHERE organization_id = p_organization_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending upgrade request already exists';
  END IF;

  INSERT INTO plan_change_requests (
    organization_id, requested_plan, current_plan, note, requested_by
  ) VALUES (
    p_organization_id, p_requested_plan, v_current, p_note, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_plan_change TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_plan_change_requests(p_status TEXT DEFAULT 'pending')
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
          'id', r.id,
          'organization_id', r.organization_id,
          'organization_name', o.name,
          'current_plan', r.current_plan,
          'requested_plan', r.requested_plan,
          'status', r.status,
          'note', r.note,
          'requester_email', u.email,
          'created_at', r.created_at
        )
        ORDER BY r.created_at DESC
      )
      FROM plan_change_requests r
      JOIN organizations o ON o.id = r.organization_id
      JOIN auth.users u ON u.id = r.requested_by
      WHERE p_status IS NULL OR r.status = p_status
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_plan_change_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_plan_change_request(
  p_request_id UUID,
  p_approve BOOLEAN,
  p_review_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req plan_change_requests%ROWTYPE;
BEGIN
  IF NOT public.platform_admin_can_write() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM plan_change_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  IF p_approve THEN
    PERFORM public.admin_set_org_plan(v_req.organization_id, v_req.requested_plan);
    UPDATE plan_change_requests
    SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_review_note
    WHERE id = p_request_id;
  ELSE
    UPDATE plan_change_requests
    SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_review_note
    WHERE id = p_request_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_review_plan_change_request TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_plan_change_requests(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'current_plan', r.current_plan,
          'requested_plan', r.requested_plan,
          'status', r.status,
          'note', r.note,
          'review_note', r.review_note,
          'created_at', r.created_at,
          'reviewed_at', r.reviewed_at
        )
        ORDER BY r.created_at DESC
      )
      FROM plan_change_requests r
      WHERE r.organization_id = p_organization_id
    ),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_my_plan_change_requests TO authenticated;

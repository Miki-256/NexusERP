-- HCM Wave 9: integrations & exports — GL mappings, data export, outbound webhooks.

-- ---------------------------------------------------------------------------
-- Payroll GL summary mappings (fallback when pay components lack GL codes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_payroll_gl_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mapping_key TEXT NOT NULL,
  gl_account_code TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, mapping_key)
);

CREATE INDEX IF NOT EXISTS idx_hr_payroll_gl_mappings_org
  ON hr_payroll_gl_mappings(organization_id);

-- ---------------------------------------------------------------------------
-- Outbound HR webhook endpoints
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_webhook_endpoints_org
  ON hr_webhook_endpoints(organization_id, is_active);

-- ---------------------------------------------------------------------------
-- Webhook delivery queue (processed by cron / process-queue route)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_webhook_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL REFERENCES hr_webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_webhook_queue_pending
  ON hr_webhook_queue(status, created_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_webhook_queue_idempotency
  ON hr_webhook_queue(endpoint_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE hr_payroll_gl_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_webhook_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_payroll_gl_mappings_select ON hr_payroll_gl_mappings;
CREATE POLICY hr_payroll_gl_mappings_select ON hr_payroll_gl_mappings FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS hr_payroll_gl_mappings_write ON hr_payroll_gl_mappings;
CREATE POLICY hr_payroll_gl_mappings_write ON hr_payroll_gl_mappings FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS hr_webhook_endpoints_select ON hr_webhook_endpoints;
CREATE POLICY hr_webhook_endpoints_select ON hr_webhook_endpoints FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_manage_hr(organization_id)
  );

DROP POLICY IF EXISTS hr_webhook_endpoints_write ON hr_webhook_endpoints;
CREATE POLICY hr_webhook_endpoints_write ON hr_webhook_endpoints FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS hr_webhook_queue_deny ON hr_webhook_queue;
CREATE POLICY hr_webhook_queue_deny ON hr_webhook_queue
  FOR ALL USING (false);

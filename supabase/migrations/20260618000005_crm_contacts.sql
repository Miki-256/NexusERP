-- Phase 3: CRM + Contacts
-- Enriches customers (contacts) and adds a sales pipeline (opportunities) with
-- follow-up activities.

-- Enrich contacts
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- CRM pipeline stages
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_stage') THEN
    CREATE TYPE crm_stage AS ENUM ('lead', 'qualified', 'proposal', 'won', 'lost');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_type') THEN
    CREATE TYPE activity_type AS ENUM ('call', 'email', 'meeting', 'note');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  stage crm_stage NOT NULL DEFAULT 'lead',
  expected_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  probability INT NOT NULL DEFAULT 10 CHECK (probability BETWEEN 0 AND 100),
  owner_id UUID REFERENCES auth.users(id),
  notes TEXT,
  closed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opps_org_stage ON opportunities(organization_id, stage);

DROP TRIGGER IF EXISTS opportunities_updated_at ON opportunities;
CREATE TRIGGER opportunities_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  type activity_type NOT NULL DEFAULT 'note',
  summary TEXT NOT NULL,
  due_date DATE,
  done BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_act_org ON crm_activities(organization_id, due_date);

-- RLS: any active org member can manage CRM records (sales staff).
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY opps_all ON opportunities FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY crm_act_all ON crm_activities FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

-- Contact summary (lifetime spend + order count) matched by phone on sales.
CREATE OR REPLACE FUNCTION public.customer_summary(p_org_id UUID)
RETURNS TABLE (
  customer_id UUID,
  name TEXT,
  phone TEXT,
  email TEXT,
  total_spent NUMERIC,
  order_count BIGINT,
  last_order TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.name, c.phone, c.email,
    COALESCE(SUM(s.total), 0) AS total_spent,
    COUNT(s.id) AS order_count,
    MAX(s.created_at) AS last_order
  FROM customers c
  LEFT JOIN sales s
    ON s.organization_id = c.organization_id
   AND s.customer_phone = c.phone
   AND s.status = 'completed'
  WHERE c.organization_id = p_org_id
    AND public.user_has_org_access(p_org_id)
  GROUP BY c.id, c.name, c.phone, c.email
  ORDER BY total_spent DESC;
$$;
GRANT EXECUTE ON FUNCTION public.customer_summary TO authenticated;

-- Mark an opportunity won/lost and stamp closed_at.
CREATE OR REPLACE FUNCTION public.set_opportunity_stage(p_opp_id UUID, p_stage crm_stage)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM opportunities WHERE id = p_opp_id;
  IF NOT public.user_has_org_access(v_org) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  UPDATE opportunities
  SET stage = p_stage,
      closed_at = CASE WHEN p_stage IN ('won', 'lost') THEN now() ELSE NULL END
  WHERE id = p_opp_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_opportunity_stage TO authenticated;

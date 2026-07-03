-- Phase 6: Odoo-style modules — Invoicing, Credits, Projects, Helpdesk,
-- Manufacturing, Documents, Recruitment, Time Off.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE invoice_status AS ENUM ('draft', 'posted', 'paid', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_status') THEN
    CREATE TYPE ticket_status AS ENUM ('new', 'in_progress', 'waiting', 'resolved', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_priority') THEN
    CREATE TYPE ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'done', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mo_status') THEN
    CREATE TYPE mo_status AS ENUM ('draft', 'confirmed', 'done', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_status') THEN
    CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'applicant_status') THEN
    CREATE TYPE applicant_status AS ENUM ('new', 'interview', 'offer', 'hired', 'refused');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Customer invoicing (Odoo Invoicing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  invoice_no TEXT NOT NULL,
  invoice_date DATE NOT NULL DEFAULT current_date,
  due_date DATE,
  status invoice_status NOT NULL DEFAULT 'draft',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  paid_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_org_no ON customer_invoices(organization_id, invoice_no);
CREATE INDEX IF NOT EXISTS idx_invoices_org_date ON customer_invoices(organization_id, invoice_date DESC);

CREATE TABLE IF NOT EXISTS customer_invoice_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_lines_invoice ON customer_invoice_lines(invoice_id);

-- ---------------------------------------------------------------------------
-- Store credits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_credits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, customer_id)
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT,
  sale_id UUID REFERENCES sales(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_org ON credit_transactions(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Projects & tasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  customer_id UUID REFERENCES customers(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);

CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status task_status NOT NULL DEFAULT 'todo',
  due_date DATE,
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON project_tasks(project_id);

-- ---------------------------------------------------------------------------
-- Helpdesk
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS helpdesk_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  description TEXT,
  customer_id UUID REFERENCES customers(id),
  contact_email TEXT,
  status ticket_status NOT NULL DEFAULT 'new',
  priority ticket_priority NOT NULL DEFAULT 'normal',
  assigned_to UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tickets_org ON helpdesk_tickets(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Manufacturing (BOM + MO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  output_variant_id UUID NOT NULL REFERENCES product_variants(id),
  output_qty NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (output_qty > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boms_org ON boms(organization_id);

CREATE TABLE IF NOT EXISTS bom_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  component_variant_id UUID NOT NULL REFERENCES product_variants(id),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_bom_lines_bom ON bom_lines(bom_id);

CREATE TABLE IF NOT EXISTS manufacturing_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bom_id UUID NOT NULL REFERENCES boms(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  status mo_status NOT NULL DEFAULT 'draft',
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  scheduled_date DATE,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mo_org ON manufacturing_orders(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Documents (metadata)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  mime_type TEXT,
  tags TEXT[],
  linked_type TEXT,
  linked_id UUID,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Recruitment
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  department TEXT,
  description TEXT,
  is_open BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_org ON job_positions(organization_id);

CREATE TABLE IF NOT EXISTS job_applicants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status applicant_status NOT NULL DEFAULT 'new',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_applicants_pos ON job_applicants(position_id);

-- ---------------------------------------------------------------------------
-- Time off
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status leave_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_leave_org ON leave_requests(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE customer_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applicants ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- invoices
CREATE POLICY inv_select ON customer_invoices FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY inv_write ON customer_invoices FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY inv_lines_select ON customer_invoice_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY inv_lines_write ON customer_invoice_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- credits
CREATE POLICY credits_select ON customer_credits FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY credits_write ON customer_credits FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY credit_tx_select ON credit_transactions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY credit_tx_insert ON credit_transactions FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- projects
CREATE POLICY projects_select ON projects FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY projects_write ON projects FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY tasks_select ON project_tasks FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY tasks_write ON project_tasks FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

-- helpdesk
CREATE POLICY tickets_select ON helpdesk_tickets FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY tickets_write ON helpdesk_tickets FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

-- manufacturing
CREATE POLICY boms_select ON boms FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY boms_write ON boms FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY bom_lines_select ON bom_lines FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY bom_lines_write ON bom_lines FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY mo_select ON manufacturing_orders FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY mo_write ON manufacturing_orders FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- documents
CREATE POLICY docs_select ON documents FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY docs_write ON documents FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

-- recruitment
CREATE POLICY jobs_select ON job_positions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY jobs_write ON job_positions FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

CREATE POLICY applicants_select ON job_applicants FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY applicants_write ON job_applicants FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

-- leave
CREATE POLICY leave_select ON leave_requests FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY leave_insert ON leave_requests FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY leave_update ON leave_requests FOR UPDATE
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

-- ---------------------------------------------------------------------------
-- RPC: next invoice number
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_invoice_no(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq INT;
BEGIN
  SELECT COUNT(*) + 1 INTO v_seq FROM customer_invoices WHERE organization_id = p_org_id;
  RETURN 'INV/' || to_char(current_date, 'YYYY') || '/' || lpad(v_seq::text, 5, '0');
END;
$$;
GRANT EXECUTE ON FUNCTION public.next_invoice_no TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: create customer invoice with lines
-- p_lines: [{description, quantity, unitPrice}]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_customer_invoice(
  p_org_id UUID,
  p_customer_id UUID,
  p_invoice_date DATE,
  p_due_date DATE,
  p_tax_rate NUMERIC,
  p_notes TEXT,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id UUID;
  v_line JSONB;
  v_subtotal NUMERIC := 0;
  v_tax NUMERIC;
  v_total NUMERIC;
  v_inv_no TEXT;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_line_total NUMERIC;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_inv_no := public.next_invoice_no(p_org_id);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := COALESCE((v_line->>'quantity')::NUMERIC, 1);
    v_price := COALESCE((v_line->>'unitPrice')::NUMERIC, 0);
    v_line_total := round(v_qty * v_price, 2);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_tax := round(v_subtotal * COALESCE(p_tax_rate, 0) / 100, 2);
  v_total := v_subtotal + v_tax;

  INSERT INTO customer_invoices (
    organization_id, customer_id, invoice_no, invoice_date, due_date,
    status, subtotal, tax_amount, total, notes, created_by
  ) VALUES (
    p_org_id, p_customer_id, v_inv_no, COALESCE(p_invoice_date, current_date), p_due_date,
    'draft', v_subtotal, v_tax, v_total, p_notes, auth.uid()
  ) RETURNING id INTO v_invoice_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := COALESCE((v_line->>'quantity')::NUMERIC, 1);
    v_price := COALESCE((v_line->>'unitPrice')::NUMERIC, 0);
    v_line_total := round(v_qty * v_price, 2);
    INSERT INTO customer_invoice_lines (invoice_id, organization_id, description, quantity, unit_price, line_total)
    VALUES (v_invoice_id, p_org_id, v_line->>'description', v_qty, v_price, v_line_total);
  END LOOP;

  RETURN v_invoice_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_customer_invoice TO authenticated;

-- Post invoice: Dr AR, Cr Revenue, Cr Tax
CREATE OR REPLACE FUNCTION public.post_customer_invoice(p_invoice_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_entry_id UUID;
  v_net NUMERIC;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_inv.status <> 'draft' THEN RAISE EXCEPTION 'Invoice is not draft'; END IF;

  PERFORM public.ensure_default_accounts(v_inv.organization_id);
  v_net := v_inv.subtotal;

  v_entry_id := public.post_journal_entry(
    v_inv.organization_id, 'INV', v_inv.invoice_date,
    'Invoice ' || v_inv.invoice_no, 'invoice', p_invoice_id,
    jsonb_build_array(
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '1100'),
        'debit', v_inv.total, 'credit', 0, 'description', 'Accounts receivable'),
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '4000'),
        'debit', 0, 'credit', v_net, 'description', 'Sales revenue'),
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '2100'),
        'debit', 0, 'credit', v_inv.tax_amount, 'description', 'Tax payable')
    )
  );

  UPDATE customer_invoices SET status = 'posted', journal_entry_id = v_entry_id WHERE id = p_invoice_id;
  RETURN v_entry_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_customer_invoice TO authenticated;

CREATE OR REPLACE FUNCTION public.pay_customer_invoice(
  p_invoice_id UUID,
  p_payment_method payment_method
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_pay_acct UUID;
  v_entry_id UUID;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_inv.status <> 'posted' THEN RAISE EXCEPTION 'Invoice must be posted first'; END IF;

  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(v_inv.organization_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(v_inv.organization_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(v_inv.organization_id, '1020')
    ELSE public.account_id_by_code(v_inv.organization_id, '1000')
  END;

  v_entry_id := public.post_journal_entry(
    v_inv.organization_id, 'INV', current_date,
    'Payment ' || v_inv.invoice_no, 'invoice_payment', p_invoice_id,
    jsonb_build_array(
      jsonb_build_object('accountId', v_pay_acct, 'debit', v_inv.total, 'credit', 0, 'description', 'Payment received'),
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '1100'),
        'debit', 0, 'credit', v_inv.total, 'description', 'AR cleared')
    )
  );

  UPDATE customer_invoices SET status = 'paid', paid_entry_id = v_entry_id WHERE id = p_invoice_id;
  RETURN v_entry_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.pay_customer_invoice TO authenticated;

-- Issue store credit
CREATE OR REPLACE FUNCTION public.issue_customer_credit(
  p_org_id UUID,
  p_customer_id UUID,
  p_amount NUMERIC,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  INSERT INTO credit_transactions (organization_id, customer_id, amount, reason, created_by)
  VALUES (p_org_id, p_customer_id, p_amount, p_reason, auth.uid())
  RETURNING id INTO v_tx_id;

  INSERT INTO customer_credits (organization_id, customer_id, balance)
  VALUES (p_org_id, p_customer_id, p_amount)
  ON CONFLICT (organization_id, customer_id)
  DO UPDATE SET balance = customer_credits.balance + p_amount, updated_at = now();

  RETURN v_tx_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.issue_customer_credit TO authenticated;

-- Complete manufacturing order: consume BOM components, add finished goods
CREATE OR REPLACE FUNCTION public.complete_manufacturing_order(p_mo_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mo manufacturing_orders%ROWTYPE;
  v_bom boms%ROWTYPE;
  v_line RECORD;
  v_need NUMERIC;
  v_stock NUMERIC;
  v_batches NUMERIC;
BEGIN
  SELECT * INTO v_mo FROM manufacturing_orders WHERE id = p_mo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO not found'; END IF;
  IF NOT public.user_can_manage(v_mo.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_mo.status NOT IN ('draft', 'confirmed') THEN RAISE EXCEPTION 'MO already completed or cancelled'; END IF;

  SELECT * INTO v_bom FROM boms WHERE id = v_mo.bom_id;

  FOR v_line IN
    SELECT bl.* FROM bom_lines bl WHERE bl.bom_id = v_bom.id
  LOOP
    v_need := v_line.quantity * (v_mo.quantity / v_bom.output_qty);
    SELECT quantity INTO v_stock FROM inventory_levels
    WHERE organization_id = v_mo.organization_id AND store_id = v_mo.store_id AND variant_id = v_line.component_variant_id;
    IF COALESCE(v_stock, 0) < v_need THEN
      RAISE EXCEPTION 'Insufficient component stock for variant %', v_line.component_variant_id;
    END IF;
    UPDATE inventory_levels SET quantity = quantity - v_need, updated_at = now()
    WHERE organization_id = v_mo.organization_id AND store_id = v_mo.store_id AND variant_id = v_line.component_variant_id;
  END LOOP;

  v_batches := v_mo.quantity;
  INSERT INTO inventory_levels (organization_id, store_id, variant_id, quantity)
  VALUES (v_mo.organization_id, v_mo.store_id, v_bom.output_variant_id, v_batches)
  ON CONFLICT (store_id, variant_id)
  DO UPDATE SET quantity = inventory_levels.quantity + v_batches, updated_at = now();

  UPDATE manufacturing_orders SET status = 'done', completed_at = now() WHERE id = p_mo_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_manufacturing_order TO authenticated;

-- Review leave request
CREATE OR REPLACE FUNCTION public.review_leave_request(
  p_request_id UUID,
  p_status leave_status
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req leave_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM leave_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.user_can_manage(v_req.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE leave_requests SET status = p_status, reviewed_by = auth.uid() WHERE id = p_request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.review_leave_request TO authenticated;

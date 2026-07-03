-- Fix sale ledger posting.
--
-- Root causes observed on remote:
-- 1) Phase A created _post_journal_entry_balanced(8 args) and Phase C/E added a
--    9-arg overload with DEFAULT p_status. 8-arg call sites then fail with
--    "function is not unique", so auto-post and batch post write nothing.
-- 2) Phase E function body inserts store_id/project_id/department_id, but those
--    columns (and analytic_departments) were never applied on remote.

-- ---------------------------------------------------------------------------
-- Missing Phase E analytic columns (idempotent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analytic_departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_analytic_departments_org ON analytic_departments(organization_id);

ALTER TABLE analytic_departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analytic_departments_select ON analytic_departments;
CREATE POLICY analytic_departments_select ON analytic_departments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS analytic_departments_write ON analytic_departments;
CREATE POLICY analytic_departments_write ON analytic_departments FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

ALTER TABLE journal_entry_lines
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES analytic_departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jel_store ON journal_entry_lines(organization_id, store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jel_project ON journal_entry_lines(organization_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jel_department ON journal_entry_lines(organization_id, department_id) WHERE department_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Collapse overloaded JE writer to one canonical signature
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._post_journal_entry_balanced(
  UUID, TEXT, DATE, TEXT, TEXT, UUID, JSONB, UUID
);

DROP FUNCTION IF EXISTS public._post_journal_entry_balanced(
  UUID, TEXT, DATE, TEXT, TEXT, UUID, JSONB, UUID, journal_entry_status
);

CREATE OR REPLACE FUNCTION public._post_journal_entry_balanced(
  p_org_id UUID,
  p_journal_code TEXT,
  p_date DATE,
  p_memo TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_lines JSONB,
  p_created_by UUID DEFAULT NULL,
  p_status journal_entry_status DEFAULT 'posted'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journal_id UUID;
  v_entry_id UUID;
  v_line JSONB;
  v_debits NUMERIC := 0;
  v_credits NUMERIC := 0;
  v_status journal_entry_status := COALESCE(p_status, 'posted'::journal_entry_status);
BEGIN
  IF v_status = 'posted'::journal_entry_status THEN
    PERFORM public._assert_accounting_date_open(p_org_id, COALESCE(p_date, current_date));
  END IF;

  SELECT id INTO v_journal_id FROM journals WHERE organization_id = p_org_id AND code = p_journal_code;
  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'Journal % not found', p_journal_code;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_debits  := v_debits  + COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_credits := v_credits + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF abs(v_debits - v_credits) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry not balanced: debits % vs credits %', v_debits, v_credits;
  END IF;

  INSERT INTO journal_entries (
    organization_id, journal_id, entry_date, memo, source_type, source_id, created_by, entry_status
  )
  VALUES (
    p_org_id, v_journal_id, COALESCE(p_date, current_date), p_memo,
    p_source_type, p_source_id, p_created_by, v_status
  )
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO journal_entry_lines (
      entry_id, organization_id, account_id, debit, credit, description,
      store_id, project_id, department_id
    )
    VALUES (
      v_entry_id, p_org_id,
      (v_line->>'accountId')::UUID,
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description',
      NULLIF(v_line->>'storeId', '')::UUID,
      NULLIF(v_line->>'projectId', '')::UUID,
      NULLIF(v_line->>'departmentId', '')::UUID
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;

-- Surface the first failure reason so the Financials banner is actionable.
CREATE OR REPLACE FUNCTION public.post_unposted_sales_batch(
  p_org_id UUID,
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID;
  v_posted INT := 0;
  v_skipped INT := 0;
  v_entry_id UUID;
  v_limit INT := GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
  v_first_error TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_sale_id IN
    SELECT s.id
    FROM sales s
    WHERE s.organization_id = p_org_id
      AND s.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.sale_id = s.id AND p.status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.organization_id = s.organization_id
          AND je.source_type = 'sale' AND je.source_id = s.id
      )
    ORDER BY s.created_at ASC
    LIMIT v_limit
  LOOP
    BEGIN
      v_entry_id := public.post_sale_to_ledger_internal(v_sale_id);
      IF v_entry_id IS NOT NULL THEN
        v_posted := v_posted + 1;
      ELSE
        v_skipped := v_skipped + 1;
        IF v_first_error IS NULL THEN
          v_first_error := 'Sale skipped (pending payment or already posted)';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      IF v_first_error IS NULL THEN
        v_first_error := SQLERRM;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'posted', v_posted,
    'skipped', v_skipped,
    'remaining', public.count_unposted_sales(p_org_id),
    'first_error', v_first_error
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_unposted_sales_batch(UUID, INT) TO authenticated;

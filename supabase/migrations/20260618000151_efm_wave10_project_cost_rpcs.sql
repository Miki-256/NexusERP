-- EFM Wave 10 — Cost & project accounting RPCs (requires 00150 schema)

-- ---------------------------------------------------------------------------
-- Cost center RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_cost_centers(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', cc.id,
        'code', cc.code,
        'name', cc.name,
        'parent_id', cc.parent_id,
        'analytic_department_id', cc.analytic_department_id,
        'is_active', cc.is_active,
        'project_count', COALESCE((
          SELECT COUNT(*)::INT FROM projects p
          WHERE p.cost_center_id = cc.id AND p.organization_id = p_org_id
        ), 0)
      ) ORDER BY cc.code
    )
    FROM cost_centers cc
    WHERE cc.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_cost_centers(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_cost_center(
  p_org_id UUID,
  p_cost_center_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_parent_id UUID DEFAULT NULL,
  p_analytic_department_id UUID DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF p_cost_center_id IS NOT NULL THEN
    UPDATE cost_centers
    SET
      code = trim(p_code),
      name = trim(p_name),
      parent_id = p_parent_id,
      analytic_department_id = p_analytic_department_id,
      is_active = COALESCE(p_is_active, true)
    WHERE id = p_cost_center_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Cost center not found'; END IF;
  ELSE
    INSERT INTO cost_centers (
      organization_id, code, name, parent_id, analytic_department_id, is_active
    ) VALUES (
      p_org_id, trim(p_code), trim(p_name), p_parent_id, p_analytic_department_id, COALESCE(p_is_active, true)
    ) RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_cost_center(UUID, UUID, TEXT, TEXT, UUID, UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- Project financial profile
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_project_financials(
  p_org_id UUID,
  p_project_id UUID,
  p_project_code TEXT DEFAULT NULL,
  p_budget_cost NUMERIC DEFAULT NULL,
  p_budget_revenue NUMERIC DEFAULT NULL,
  p_contract_value NUMERIC DEFAULT NULL,
  p_cost_center_id UUID DEFAULT NULL,
  p_accounting_status TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_accounting_status IS NOT NULL
     AND p_accounting_status NOT IN ('planning', 'active', 'on_hold', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid accounting status';
  END IF;

  UPDATE projects
  SET
    project_code = COALESCE(NULLIF(trim(p_project_code), ''), project_code),
    budget_cost = COALESCE(p_budget_cost, budget_cost),
    budget_revenue = COALESCE(p_budget_revenue, budget_revenue),
    contract_value = COALESCE(p_contract_value, contract_value),
    cost_center_id = COALESCE(p_cost_center_id, cost_center_id),
    accounting_status = COALESCE(p_accounting_status, accounting_status),
    start_date = COALESCE(p_start_date, start_date),
    end_date = COALESCE(p_end_date, end_date)
  WHERE id = p_project_id AND organization_id = p_org_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  RETURN p_project_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_project_financials(UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_project_cost_budget(
  p_org_id UUID,
  p_project_id UUID,
  p_lines JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line JSONB;
  v_count INT := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  DELETE FROM project_cost_budget_lines WHERE project_id = p_project_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    IF COALESCE((v_line->>'amount')::NUMERIC, 0) <= 0 THEN CONTINUE; END IF;
    IF COALESCE(v_line->>'category', 'other') NOT IN ('labor', 'materials', 'subcontract', 'overhead', 'other') THEN
      RAISE EXCEPTION 'Invalid cost category';
    END IF;

    INSERT INTO project_cost_budget_lines (
      project_id, organization_id, cost_category, account_id, budget_amount, notes
    ) VALUES (
      p_project_id,
      p_org_id,
      COALESCE(v_line->>'category', 'other'),
      NULLIF(v_line->>'accountId', '')::UUID,
      (v_line->>'amount')::NUMERIC,
      NULLIF(trim(v_line->>'notes'), '')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_project_cost_budget(UUID, UUID, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- Job cost helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._project_jel_cost(
  p_org_id UUID,
  p_project_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE(
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  amount NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.code,
    a.name,
    a.type,
    SUM(
      CASE
        WHEN a.type = 'income' THEN jel.credit - jel.debit
        WHEN a.type IN ('expense', 'asset') THEN jel.debit - jel.credit
        ELSE 0
      END
    ) AS amount
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE jel.organization_id = p_org_id
    AND jel.project_id = p_project_id
    AND je.entry_date BETWEEN p_from AND p_to
    AND public._je_is_posted(je.entry_status)
  GROUP BY a.id, a.code, a.name, a.type
  HAVING SUM(
    CASE
      WHEN a.type = 'income' THEN abs(jel.credit - jel.debit)
      WHEN a.type IN ('expense', 'asset') THEN abs(jel.debit - jel.credit)
      ELSE 0
    END
  ) > 0;
$$;

-- ---------------------------------------------------------------------------
-- Project job cost summary (all projects)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_projects_job_cost(
  p_org_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'project_code', p.project_code,
        'accounting_status', p.accounting_status,
        'cost_center_id', p.cost_center_id,
        'cost_center_name', cc.name,
        'budget_cost', COALESCE(p.budget_cost, 0),
        'budget_revenue', COALESCE(p.budget_revenue, 0),
        'contract_value', p.contract_value,
        'actual_revenue', COALESCE(rev.amount, 0),
        'actual_cost', COALESCE(cost.amount, 0),
        'margin', COALESCE(rev.amount, 0) - COALESCE(cost.amount, 0),
        'cost_variance', COALESCE(p.budget_cost, 0) - COALESCE(cost.amount, 0),
        'percent_complete', CASE
          WHEN COALESCE(p.budget_cost, 0) > 0
          THEN round(COALESCE(cost.amount, 0) / p.budget_cost * 100, 1)
          ELSE NULL
        END
      ) ORDER BY p.name
    )
    FROM projects p
    LEFT JOIN cost_centers cc ON cc.id = p.cost_center_id
    LEFT JOIN LATERAL (
      SELECT SUM(jel.credit - jel.debit) AS amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE jel.project_id = p.id
        AND jel.organization_id = p_org_id
        AND a.type = 'income'
        AND je.entry_date BETWEEN p_from AND p_to
        AND public._je_is_posted(je.entry_status)
    ) rev ON true
    LEFT JOIN LATERAL (
      SELECT SUM(jel.debit - jel.credit) AS amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE jel.project_id = p.id
        AND jel.organization_id = p_org_id
        AND a.type IN ('expense', 'asset')
        AND je.entry_date BETWEEN p_from AND p_to
        AND public._je_is_posted(je.entry_status)
    ) cost ON true
    WHERE p.organization_id = p_org_id
      AND (rev.amount IS NOT NULL OR cost.amount IS NOT NULL OR p.budget_cost IS NOT NULL OR p.budget_revenue IS NOT NULL)
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_projects_job_cost(UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Project job cost detail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_project_job_cost(
  p_project_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project projects%ROWTYPE;
  v_revenue NUMERIC := 0;
  v_cogs NUMERIC := 0;
  v_opex NUMERIC := 0;
  v_total_cost NUMERIC := 0;
  v_budget_lines JSONB;
  v_account_lines JSONB;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF NOT public.user_has_org_access(v_project.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_revenue
  FROM public._project_jel_cost(v_project.organization_id, p_project_id, p_from, p_to)
  WHERE account_type = 'income';

  SELECT COALESCE(SUM(amount), 0) INTO v_cogs
  FROM public._project_jel_cost(v_project.organization_id, p_project_id, p_from, p_to)
  WHERE account_code = '5000';

  SELECT COALESCE(SUM(amount), 0) INTO v_opex
  FROM public._project_jel_cost(v_project.organization_id, p_project_id, p_from, p_to)
  WHERE account_type = 'expense' AND account_code <> '5000';

  v_total_cost := v_cogs + v_opex;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'account_code', account_code,
      'account_name', account_name,
      'account_type', account_type,
      'amount', round(amount, 2)
    ) ORDER BY account_code
  ), '[]'::jsonb) INTO v_account_lines
  FROM public._project_jel_cost(v_project.organization_id, p_project_id, p_from, p_to);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', bl.id,
      'cost_category', bl.cost_category,
      'account_id', bl.account_id,
      'account_code', a.code,
      'budget_amount', bl.budget_amount,
      'actual_amount', COALESCE((
        SELECT SUM(jel.debit - jel.credit)
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE jel.project_id = p_project_id
          AND jel.organization_id = v_project.organization_id
          AND (bl.account_id IS NULL OR jel.account_id = bl.account_id)
          AND je.entry_date BETWEEN p_from AND p_to
          AND public._je_is_posted(je.entry_status)
      ), 0),
      'variance', bl.budget_amount - COALESCE((
        SELECT SUM(jel.debit - jel.credit)
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE jel.project_id = p_project_id
          AND jel.organization_id = v_project.organization_id
          AND (bl.account_id IS NULL OR jel.account_id = bl.account_id)
          AND je.entry_date BETWEEN p_from AND p_to
          AND public._je_is_posted(je.entry_status)
      ), 0),
      'notes', bl.notes
    ) ORDER BY bl.cost_category
  ), '[]'::jsonb) INTO v_budget_lines
  FROM project_cost_budget_lines bl
  LEFT JOIN accounts a ON a.id = bl.account_id
  WHERE bl.project_id = p_project_id;

  RETURN jsonb_build_object(
    'project_id', v_project.id,
    'project_name', v_project.name,
    'project_code', v_project.project_code,
    'accounting_status', v_project.accounting_status,
    'from', p_from,
    'to', p_to,
    'budget_cost', COALESCE(v_project.budget_cost, 0),
    'budget_revenue', COALESCE(v_project.budget_revenue, 0),
    'contract_value', v_project.contract_value,
    'actual_revenue', round(v_revenue, 2),
    'actual_cogs', round(v_cogs, 2),
    'actual_operating_expenses', round(v_opex, 2),
    'actual_cost', round(v_total_cost, 2),
    'margin', round(v_revenue - v_total_cost, 2),
    'cost_variance', round(COALESCE(v_project.budget_cost, 0) - v_total_cost, 2),
    'percent_complete', CASE
      WHEN COALESCE(v_project.budget_cost, 0) > 0
      THEN round(v_total_cost / v_project.budget_cost * 100, 1)
      ELSE NULL
    END,
    'account_lines', v_account_lines,
    'budget_lines', v_budget_lines,
    'allocations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pa.id,
          'allocation_date', pa.allocation_date,
          'amount', pa.amount,
          'cost_category', pa.cost_category,
          'memo', pa.memo
        ) ORDER BY pa.allocation_date DESC
      )
      FROM project_cost_allocations pa
      WHERE pa.project_id = p_project_id
        AND pa.allocation_date BETWEEN p_from AND p_to
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_project_job_cost(UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Cost center P&L rollup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cost_center_summary(
  p_org_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', cc.id,
        'code', cc.code,
        'name', cc.name,
        'project_count', COALESCE((
          SELECT COUNT(*)::INT FROM projects p WHERE p.cost_center_id = cc.id
        ), 0),
        'revenue', COALESCE(rev.amount, 0),
        'cost', COALESCE(cost.amount, 0),
        'margin', COALESCE(rev.amount, 0) - COALESCE(cost.amount, 0)
      ) ORDER BY cc.code
    )
    FROM cost_centers cc
    LEFT JOIN LATERAL (
      SELECT SUM(
        CASE WHEN a.type = 'income' THEN jel.credit - jel.debit ELSE 0 END
      ) AS amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN accounts a ON a.id = jel.account_id
      JOIN projects p ON p.id = jel.project_id
      WHERE p.cost_center_id = cc.id
        AND jel.organization_id = p_org_id
        AND je.entry_date BETWEEN p_from AND p_to
        AND public._je_is_posted(je.entry_status)
    ) rev ON true
    LEFT JOIN LATERAL (
      SELECT SUM(
        CASE WHEN a.type IN ('expense', 'asset') THEN jel.debit - jel.credit ELSE 0 END
      ) AS amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN accounts a ON a.id = jel.account_id
      JOIN projects p ON p.id = jel.project_id
      WHERE p.cost_center_id = cc.id
        AND jel.organization_id = p_org_id
        AND je.entry_date BETWEEN p_from AND p_to
        AND public._je_is_posted(je.entry_status)
    ) cost ON true
    WHERE cc.organization_id = p_org_id AND cc.is_active
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_cost_center_summary(UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Post project cost allocation (Dr project expense, Cr source expense)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_project_cost_allocation(
  p_org_id UUID,
  p_project_id UUID,
  p_amount NUMERIC,
  p_source_account_id UUID,
  p_destination_account_id UUID,
  p_allocation_date DATE DEFAULT NULL,
  p_cost_category TEXT DEFAULT 'other',
  p_memo TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project projects%ROWTYPE;
  v_entry_id UUID;
  v_alloc_id UUID;
  v_date DATE := COALESCE(p_allocation_date, current_date);
  v_lines JSONB;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF p_cost_category NOT IN ('labor', 'materials', 'subcontract', 'overhead', 'other') THEN
    RAISE EXCEPTION 'Invalid cost category';
  END IF;

  SELECT * INTO v_project FROM projects WHERE id = p_project_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;

  PERFORM public.ensure_default_accounts(p_org_id);

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'accountId', p_destination_account_id,
      'debit', p_amount,
      'credit', 0,
      'description', COALESCE(p_memo, 'Project cost allocation'),
      'projectId', p_project_id
    ),
    jsonb_build_object(
      'accountId', p_source_account_id,
      'debit', 0,
      'credit', p_amount,
      'description', COALESCE(p_memo, 'Project cost allocation')
    )
  );

  v_entry_id := public._post_journal_entry_balanced(
    p_org_id, 'MISC', v_date,
    COALESCE(p_memo, 'Project cost: ' || v_project.name),
    'project_cost_allocation', p_project_id,
    v_lines, auth.uid(), 'posted'
  );

  INSERT INTO project_cost_allocations (
    organization_id, project_id, allocation_date, amount,
    cost_category, memo, journal_entry_id, created_by
  ) VALUES (
    p_org_id, p_project_id, v_date, p_amount,
    p_cost_category, NULLIF(trim(p_memo), ''), v_entry_id, auth.uid()
  ) RETURNING id INTO v_alloc_id;

  RETURN v_alloc_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_project_cost_allocation(UUID, UUID, NUMERIC, UUID, UUID, DATE, TEXT, TEXT) TO authenticated;

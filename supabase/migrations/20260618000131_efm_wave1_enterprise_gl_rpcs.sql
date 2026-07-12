-- EFM Wave 1 — Enterprise GL RPCs

-- ---------------------------------------------------------------------------
-- Audit helper (append-only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._log_journal_entry_audit(
  p_org_id UUID,
  p_entry_id UUID,
  p_action TEXT,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO journal_entry_audit_log (organization_id, entry_id, action, actor_id, details)
  VALUES (p_org_id, p_entry_id, p_action, auth.uid(), COALESCE(p_details, '{}'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- Postable account guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_accounts_postable(p_lines JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line JSONB;
  v_acct accounts%ROWTYPE;
BEGIN
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_acct FROM accounts WHERE id = (v_line->>'accountId')::UUID;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account not found';
    END IF;
    IF NOT v_acct.is_postable THEN
      RAISE EXCEPTION 'Account % (%) is a header account and cannot receive postings', v_acct.code, v_acct.name;
    END IF;
    IF NOT v_acct.is_active THEN
      RAISE EXCEPTION 'Account % is inactive', v_acct.code;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Balanced JE writer — enforce postable accounts on posted entries
-- ---------------------------------------------------------------------------
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
    PERFORM public._assert_accounts_postable(p_lines);
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

  PERFORM public._log_journal_entry_audit(
    p_org_id, v_entry_id,
    CASE WHEN v_status = 'draft'::journal_entry_status THEN 'created_draft' ELSE 'posted' END,
    jsonb_build_object('journal_code', p_journal_code, 'source_type', p_source_type)
  );

  RETURN v_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- COA list (flat with hierarchy fields)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_accounts(p_org_id UUID)
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
        'id', a.id,
        'code', a.code,
        'name', a.name,
        'type', a.type,
        'is_active', a.is_active,
        'is_postable', a.is_postable,
        'parent_account_id', a.parent_account_id,
        'sort_order', a.sort_order,
        'created_at', a.created_at
      ) ORDER BY a.sort_order, a.code
    )
    FROM accounts a
    WHERE a.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- COA tree (nested children)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_accounts_tree(p_org_id UUID)
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
    WITH RECURSIVE tree AS (
      SELECT
        a.id, a.code, a.name, a.type, a.is_active, a.is_postable,
        a.parent_account_id, a.sort_order, 0 AS depth,
        ARRAY[a.sort_order, 0] AS sort_path
      FROM accounts a
      WHERE a.organization_id = p_org_id AND a.parent_account_id IS NULL

      UNION ALL

      SELECT
        c.id, c.code, c.name, c.type, c.is_active, c.is_postable,
        c.parent_account_id, c.sort_order, t.depth + 1,
        t.sort_path || ARRAY[c.sort_order, t.depth + 1]
      FROM accounts c
      JOIN tree t ON c.parent_account_id = t.id
      WHERE c.organization_id = p_org_id
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', id,
        'code', code,
        'name', name,
        'type', type,
        'is_active', is_active,
        'is_postable', is_postable,
        'parent_account_id', parent_account_id,
        'sort_order', sort_order,
        'depth', depth
      ) ORDER BY sort_path, code
    )
    FROM tree
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_accounts_tree(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- COA upsert with hierarchy
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_account(UUID, UUID, TEXT, TEXT, account_type, BOOLEAN);

CREATE OR REPLACE FUNCTION public.upsert_account(
  p_org_id UUID,
  p_account_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_type account_type,
  p_is_active BOOLEAN DEFAULT true,
  p_parent_account_id UUID DEFAULT NULL,
  p_is_postable BOOLEAN DEFAULT true,
  p_sort_order INT DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_code TEXT := trim(p_code);
  v_name TEXT := trim(p_name);
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_code = '' OR v_name = '' THEN
    RAISE EXCEPTION 'Code and name are required';
  END IF;

  IF p_parent_account_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM accounts
      WHERE id = p_parent_account_id AND organization_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'Parent account not found';
    END IF;
    IF p_account_id IS NOT NULL AND p_parent_account_id = p_account_id THEN
      RAISE EXCEPTION 'Account cannot be its own parent';
    END IF;
  END IF;

  IF p_account_id IS NULL THEN
    INSERT INTO accounts (
      organization_id, code, name, type, is_active,
      parent_account_id, is_postable, sort_order
    )
    VALUES (
      p_org_id, v_code, v_name, p_type, COALESCE(p_is_active, true),
      p_parent_account_id, COALESCE(p_is_postable, true), COALESCE(p_sort_order, 0)
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = p_account_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM accounts
    WHERE organization_id = p_org_id AND code = v_code AND id <> p_account_id
  ) THEN
    RAISE EXCEPTION 'Account code already exists';
  END IF;

  UPDATE accounts
  SET
    code = v_code,
    name = v_name,
    type = p_type,
    is_active = COALESCE(p_is_active, true),
    parent_account_id = p_parent_account_id,
    is_postable = COALESCE(p_is_postable, true),
    sort_order = COALESCE(p_sort_order, 0)
  WHERE id = p_account_id AND organization_id = p_org_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_account(UUID, UUID, TEXT, TEXT, account_type, BOOLEAN, UUID, BOOLEAN, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Approve draft — add audit log
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_journal_entry(p_entry_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry journal_entries%ROWTYPE;
  v_lines JSONB;
BEGIN
  SELECT * INTO v_entry FROM journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;
  IF NOT public.user_can_manage(v_entry.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_entry.entry_status <> 'draft'::journal_entry_status THEN
    RAISE EXCEPTION 'Only draft entries can be approved';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'accountId', jel.account_id,
      'debit', jel.debit,
      'credit', jel.credit,
      'description', jel.description,
      'storeId', jel.store_id,
      'projectId', jel.project_id,
      'departmentId', jel.department_id
    )
  ), '[]'::jsonb)
  INTO v_lines
  FROM journal_entry_lines jel
  WHERE jel.entry_id = p_entry_id;

  PERFORM public._assert_accounting_date_open(v_entry.organization_id, v_entry.entry_date);
  PERFORM public._assert_accounts_postable(v_lines);

  UPDATE journal_entries
  SET entry_status = 'posted'::journal_entry_status
  WHERE id = p_entry_id;

  PERFORM public._log_journal_entry_audit(v_entry.organization_id, p_entry_id, 'approved', '{}'::jsonb);

  RETURN p_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reverse a posted journal entry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_entry_id UUID,
  p_reversal_date DATE DEFAULT NULL,
  p_memo TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry journal_entries%ROWTYPE;
  v_journal_code TEXT;
  v_lines JSONB := '[]'::jsonb;
  v_reversal_id UUID;
  v_date DATE;
BEGIN
  SELECT * INTO v_entry FROM journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;
  IF NOT public.user_can_manage(v_entry.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_entry.entry_status <> 'posted'::journal_entry_status THEN
    RAISE EXCEPTION 'Only posted entries can be reversed';
  END IF;
  IF v_entry.reversal_entry_id IS NOT NULL OR v_entry.reversed_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Entry is already reversed or is a reversal';
  END IF;
  IF v_entry.source_type = 'reversal' THEN
    RAISE EXCEPTION 'Cannot reverse a reversal entry';
  END IF;

  SELECT j.code INTO v_journal_code
  FROM journals j WHERE j.id = v_entry.journal_id;

  v_date := COALESCE(p_reversal_date, current_date);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'accountId', jel.account_id,
      'debit', jel.credit,
      'credit', jel.debit,
      'description', COALESCE('Reversal: ' || jel.description, 'Reversal'),
      'storeId', jel.store_id,
      'projectId', jel.project_id,
      'departmentId', jel.department_id
    )
  ), '[]'::jsonb)
  INTO v_lines
  FROM journal_entry_lines jel
  WHERE jel.entry_id = p_entry_id;

  v_reversal_id := public._post_journal_entry_balanced(
    v_entry.organization_id,
    v_journal_code,
    v_date,
    COALESCE(NULLIF(trim(p_memo), ''), 'Reversal of ' || COALESCE(v_entry.memo, 'journal entry')),
    'reversal',
    p_entry_id,
    v_lines,
    auth.uid(),
    'posted'::journal_entry_status
  );

  UPDATE journal_entries
  SET reversal_entry_id = v_reversal_id,
      reversed_at = now(),
      reversed_by = auth.uid()
  WHERE id = p_entry_id;

  UPDATE journal_entries
  SET reversed_entry_id = p_entry_id
  WHERE id = v_reversal_id;

  PERFORM public._log_journal_entry_audit(
    v_entry.organization_id, p_entry_id, 'reversed',
    jsonb_build_object('reversal_entry_id', v_reversal_id)
  );
  PERFORM public._log_journal_entry_audit(
    v_entry.organization_id, v_reversal_id, 'reversal_created',
    jsonb_build_object('reversed_entry_id', p_entry_id)
  );

  RETURN v_reversal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(UUID, DATE, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Opening balance import
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_opening_balances(
  p_org_id UUID,
  p_date DATE,
  p_lines JSONB,
  p_memo TEXT DEFAULT 'Opening balances'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one line is required';
  END IF;

  PERFORM public.ensure_default_accounts(p_org_id);

  v_entry_id := public._post_journal_entry_balanced(
    p_org_id, 'GEN', p_date, COALESCE(NULLIF(trim(p_memo), ''), 'Opening balances'),
    'opening_balance', gen_random_uuid(), p_lines, auth.uid(), 'posted'::journal_entry_status
  );

  PERFORM public._log_journal_entry_audit(
    p_org_id, v_entry_id, 'opening_balance_imported',
    jsonb_build_object('line_count', jsonb_array_length(p_lines))
  );

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_opening_balances(UUID, DATE, JSONB, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Journal attachments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_journal_entry_attachment(
  p_entry_id UUID,
  p_file_name TEXT,
  p_file_url TEXT DEFAULT NULL,
  p_mime_type TEXT DEFAULT NULL,
  p_file_size_bytes BIGINT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry journal_entries%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO v_entry FROM journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;
  IF NOT public.user_can_manage(v_entry.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF trim(p_file_name) = '' THEN
    RAISE EXCEPTION 'File name is required';
  END IF;

  INSERT INTO journal_entry_attachments (
    organization_id, entry_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by
  ) VALUES (
    v_entry.organization_id, p_entry_id, trim(p_file_name), p_file_url, p_mime_type, p_file_size_bytes, auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public._log_journal_entry_audit(
    v_entry.organization_id, p_entry_id, 'attachment_added',
    jsonb_build_object('attachment_id', v_id, 'file_name', trim(p_file_name))
  );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_journal_entry_attachment(UUID, TEXT, TEXT, TEXT, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_journal_entry_attachments(p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;
  IF NOT public.user_has_org_access(v_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'file_name', a.file_name,
        'file_url', a.file_url,
        'mime_type', a.mime_type,
        'file_size_bytes', a.file_size_bytes,
        'created_at', a.created_at
      ) ORDER BY a.created_at DESC
    )
    FROM journal_entry_attachments a
    WHERE a.entry_id = p_entry_id
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_journal_entry_attachments(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_journal_entry_audit_log(p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;
  IF NOT public.user_has_org_access(v_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'action', l.action,
        'actor_id', l.actor_id,
        'details', l.details,
        'created_at', l.created_at
      ) ORDER BY l.created_at DESC
    )
    FROM journal_entry_audit_log l
    WHERE l.entry_id = p_entry_id
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_journal_entry_audit_log(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Allocation rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_allocation_rules(p_org_id UUID)
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
        'id', r.id,
        'name', r.name,
        'journal_code', r.journal_code,
        'source_account_id', r.source_account_id,
        'source_account_code', sa.code,
        'allocation_basis', r.allocation_basis,
        'targets', r.targets,
        'is_active', r.is_active
      ) ORDER BY r.name
    )
    FROM allocation_rules r
    JOIN accounts sa ON sa.id = r.source_account_id
    WHERE r.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_allocation_rules(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_allocation_rule(
  p_org_id UUID,
  p_rule_id UUID,
  p_name TEXT,
  p_source_account_id UUID,
  p_targets JSONB,
  p_journal_code TEXT DEFAULT 'GEN',
  p_allocation_basis TEXT DEFAULT 'percent',
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT := trim(p_name);
  v_target JSONB;
  v_total NUMERIC := 0;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  IF p_allocation_basis NOT IN ('percent', 'equal') THEN
    RAISE EXCEPTION 'Invalid allocation basis';
  END IF;
  IF jsonb_array_length(COALESCE(p_targets, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one target account is required';
  END IF;

  IF p_allocation_basis = 'percent' THEN
    FOR v_target IN SELECT * FROM jsonb_array_elements(p_targets) LOOP
      v_total := v_total + COALESCE((v_target->>'percent')::NUMERIC, 0);
    END LOOP;
    IF abs(v_total - 100) > 0.01 THEN
      RAISE EXCEPTION 'Target percentages must sum to 100 (got %)', v_total;
    END IF;
  END IF;

  IF p_rule_id IS NULL THEN
    INSERT INTO allocation_rules (
      organization_id, name, journal_code, source_account_id, allocation_basis, targets, is_active, created_by
    ) VALUES (
      p_org_id, v_name, COALESCE(NULLIF(trim(p_journal_code), ''), 'GEN'),
      p_source_account_id, p_allocation_basis, p_targets, COALESCE(p_is_active, true), auth.uid()
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  UPDATE allocation_rules
  SET
    name = v_name,
    journal_code = COALESCE(NULLIF(trim(p_journal_code), ''), 'GEN'),
    source_account_id = p_source_account_id,
    allocation_basis = p_allocation_basis,
    targets = p_targets,
    is_active = COALESCE(p_is_active, true)
  WHERE id = p_rule_id AND organization_id = p_org_id
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Allocation rule not found';
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_allocation_rule(UUID, UUID, TEXT, UUID, JSONB, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_allocation_rule(
  p_rule_id UUID,
  p_amount NUMERIC,
  p_date DATE DEFAULT NULL,
  p_memo TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule allocation_rules%ROWTYPE;
  v_target JSONB;
  v_lines JSONB := '[]'::jsonb;
  v_count INT;
  v_each NUMERIC;
  v_pct NUMERIC;
  v_amt NUMERIC;
  v_entry_id UUID;
  v_date DATE := COALESCE(p_date, current_date);
BEGIN
  SELECT * INTO v_rule FROM allocation_rules WHERE id = p_rule_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allocation rule not found';
  END IF;
  IF NOT public.user_can_manage(v_rule.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF NOT v_rule.is_active THEN
    RAISE EXCEPTION 'Allocation rule is inactive';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'accountId', v_rule.source_account_id,
    'debit', 0,
    'credit', p_amount,
    'description', 'Allocation source'
  ));

  v_count := jsonb_array_length(v_rule.targets);

  IF v_rule.allocation_basis = 'equal' THEN
    v_each := round(p_amount / v_count, 2);
    FOR v_target IN SELECT * FROM jsonb_array_elements(v_rule.targets) LOOP
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', (v_target->>'accountId')::UUID,
        'debit', v_each,
        'credit', 0,
        'description', 'Allocated share'
      ));
    END LOOP;
  ELSE
    FOR v_target IN SELECT * FROM jsonb_array_elements(v_rule.targets) LOOP
      v_pct := COALESCE((v_target->>'percent')::NUMERIC, 0);
      v_amt := round(p_amount * v_pct / 100, 2);
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', (v_target->>'accountId')::UUID,
        'debit', v_amt,
        'credit', 0,
        'description', 'Allocated ' || v_pct || '%'
      ));
    END LOOP;
  END IF;

  v_entry_id := public._post_journal_entry_balanced(
    v_rule.organization_id,
    v_rule.journal_code,
    v_date,
    COALESCE(NULLIF(trim(p_memo), ''), 'Allocation — ' || v_rule.name),
    'allocation',
    p_rule_id,
    v_lines,
    auth.uid(),
    'posted'::journal_entry_status
  );

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_allocation_rule(UUID, NUMERIC, DATE, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Accrual with auto-reversal (one-shot)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_accrual_with_reversal(
  p_org_id UUID,
  p_journal_code TEXT,
  p_accrual_date DATE,
  p_reversal_date DATE,
  p_memo TEXT,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accrual_id UUID;
  v_reversal_lines JSONB := '[]'::jsonb;
  v_line JSONB;
  v_reversal_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_reversal_date <= p_accrual_date THEN
    RAISE EXCEPTION 'Reversal date must be after accrual date';
  END IF;

  v_accrual_id := public._post_journal_entry_balanced(
    p_org_id, p_journal_code, p_accrual_date, p_memo,
    'accrual', gen_random_uuid(), p_lines, auth.uid(), 'posted'::journal_entry_status
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_reversal_lines := v_reversal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_line->>'accountId',
      'debit', COALESCE((v_line->>'credit')::NUMERIC, 0),
      'credit', COALESCE((v_line->>'debit')::NUMERIC, 0),
      'description', 'Auto-reversal: ' || COALESCE(v_line->>'description', '')
    ));
  END LOOP;

  v_reversal_id := public._post_journal_entry_balanced(
    p_org_id, p_journal_code, p_reversal_date, 'Auto-reversal — ' || p_memo,
    'accrual_reversal', v_accrual_id, v_reversal_lines, auth.uid(), 'posted'::journal_entry_status
  );

  UPDATE journal_entries
  SET reversal_entry_id = v_reversal_id, reversed_at = now(), reversed_by = auth.uid()
  WHERE id = v_accrual_id;

  UPDATE journal_entries
  SET reversed_entry_id = v_accrual_id
  WHERE id = v_reversal_id;

  RETURN jsonb_build_object('accrual_entry_id', v_accrual_id, 'reversal_entry_id', v_reversal_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_accrual_with_reversal(UUID, TEXT, DATE, DATE, TEXT, JSONB) TO authenticated;

-- Extend list_journal_entries_page to show reversal flags
CREATE OR REPLACE FUNCTION public.list_journal_entries_page(
  p_org_id UUID,
  p_from DATE,
  p_to DATE,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_source_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_total INT;
  v_entries JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM journal_entries je
  WHERE je.organization_id = p_org_id
    AND je.entry_date BETWEEN p_from AND p_to
    AND (p_source_type IS NULL OR je.source_type = p_source_type);

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'entry_date' DESC, row->>'created_at' DESC), '[]'::jsonb)
    INTO v_entries
  FROM (
    SELECT jsonb_build_object(
      'id', je.id,
      'entry_date', je.entry_date,
      'memo', je.memo,
      'reference', je.reference,
      'source_type', je.source_type,
      'source_id', je.source_id,
      'entry_status', je.entry_status,
      'reversal_entry_id', je.reversal_entry_id,
      'reversed_entry_id', je.reversed_entry_id,
      'created_at', je.created_at,
      'journal_code', j.code,
      'journal_name', j.name,
      'lines', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', jel.id,
            'debit', jel.debit,
            'credit', jel.credit,
            'description', jel.description,
            'account_code', a.code,
            'account_name', a.name,
            'account_type', a.type
          ) ORDER BY a.code
        )
        FROM journal_entry_lines jel
        JOIN accounts a ON a.id = jel.account_id
        WHERE jel.entry_id = je.id
      ), '[]'::jsonb)
    ) AS row
    FROM journal_entries je
    JOIN journals j ON j.id = je.journal_id
    WHERE je.organization_id = p_org_id
      AND je.entry_date BETWEEN p_from AND p_to
      AND (p_source_type IS NULL OR je.source_type = p_source_type)
    ORDER BY je.entry_date DESC, je.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('total', v_total, 'entries', v_entries);
END;
$$;

-- EFM Wave 8 — Tax compliance & e-invoicing RPCs (requires 00146 schema)

-- ---------------------------------------------------------------------------
-- Tax compliance settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tax_compliance_settings(p_org_id UUID)
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

  RETURN (
    SELECT jsonb_build_object(
      'tax_id', o.tax_id,
      'tax_rate', o.tax_rate,
      'tax_inclusive', o.tax_inclusive,
      'einvoice_enabled', COALESCE(o.einvoice_enabled, false),
      'einvoice_provider', COALESCE(o.einvoice_provider, 'internal'),
      'tax_filing_frequency', COALESCE(o.tax_filing_frequency, 'monthly')
    )
    FROM organizations o
    WHERE o.id = p_org_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_tax_compliance_settings(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tax_compliance_settings(
  p_org_id UUID,
  p_tax_id TEXT DEFAULT NULL,
  p_einvoice_enabled BOOLEAN DEFAULT NULL,
  p_einvoice_provider TEXT DEFAULT NULL,
  p_tax_filing_frequency TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_einvoice_provider IS NOT NULL
     AND p_einvoice_provider NOT IN ('internal', 'peppol', 'ethiopia_erca') THEN
    RAISE EXCEPTION 'Invalid e-invoice provider';
  END IF;

  IF p_tax_filing_frequency IS NOT NULL
     AND p_tax_filing_frequency NOT IN ('monthly', 'quarterly', 'annual') THEN
    RAISE EXCEPTION 'Invalid tax filing frequency';
  END IF;

  UPDATE organizations
  SET
    tax_id = COALESCE(NULLIF(trim(p_tax_id), ''), tax_id),
    einvoice_enabled = COALESCE(p_einvoice_enabled, einvoice_enabled),
    einvoice_provider = COALESCE(p_einvoice_provider, einvoice_provider),
    tax_filing_frequency = COALESCE(p_tax_filing_frequency, tax_filing_frequency)
  WHERE id = p_org_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_tax_compliance_settings(UUID, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Extended tax code RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_tax_codes(p_org_id UUID)
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
        'id', tc.id,
        'code', tc.code,
        'name', tc.name,
        'rate', tc.rate,
        'tax_type', tc.tax_type,
        'jurisdiction', tc.jurisdiction,
        'is_recoverable', tc.is_recoverable,
        'is_active', tc.is_active,
        'liability_account_id', tc.liability_account_id
      ) ORDER BY tc.code
    )
    FROM tax_codes tc
    WHERE tc.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_tax_codes(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_tax_code(
  p_org_id UUID,
  p_tax_code_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_rate NUMERIC,
  p_is_active BOOLEAN DEFAULT true,
  p_tax_type TEXT DEFAULT 'output',
  p_jurisdiction TEXT DEFAULT NULL,
  p_is_recoverable BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_tax_acct UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_rate < 0 OR p_rate > 100 THEN
    RAISE EXCEPTION 'Tax rate must be between 0 and 100';
  END IF;
  IF p_tax_type NOT IN ('output', 'input', 'withholding') THEN
    RAISE EXCEPTION 'Invalid tax type';
  END IF;

  PERFORM public.ensure_default_accounts(p_org_id);
  v_tax_acct := public.account_id_by_code(p_org_id, '2100');

  IF p_tax_code_id IS NOT NULL THEN
    UPDATE tax_codes
    SET
      code = trim(p_code),
      name = trim(p_name),
      rate = p_rate,
      tax_type = COALESCE(p_tax_type, tax_type),
      jurisdiction = NULLIF(trim(p_jurisdiction), ''),
      is_recoverable = COALESCE(p_is_recoverable, is_recoverable),
      is_active = COALESCE(p_is_active, true)
    WHERE id = p_tax_code_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Tax code not found';
    END IF;
  ELSE
    INSERT INTO tax_codes (
      organization_id, code, name, rate, liability_account_id, is_active,
      tax_type, jurisdiction, is_recoverable
    )
    VALUES (
      p_org_id, trim(p_code), trim(p_name), p_rate, v_tax_acct, COALESCE(p_is_active, true),
      COALESCE(p_tax_type, 'output'), NULLIF(trim(p_jurisdiction), ''), COALESCE(p_is_recoverable, true)
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_tax_code(UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_default_tax_codes(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate NUMERIC;
  v_tax_acct UUID;
BEGIN
  PERFORM public.ensure_default_accounts(p_org_id);
  SELECT tax_rate INTO v_rate FROM organizations WHERE id = p_org_id;
  v_tax_acct := public.account_id_by_code(p_org_id, '2100');

  INSERT INTO tax_codes (organization_id, code, name, rate, liability_account_id, tax_type, is_recoverable)
  VALUES
    (p_org_id, 'STANDARD', 'Standard rate', COALESCE(v_rate, 0), v_tax_acct, 'output', true),
    (p_org_id, 'ZERO', 'Zero rated', 0, v_tax_acct, 'output', true),
    (p_org_id, 'EXEMPT', 'Tax exempt', 0, v_tax_acct, 'output', true),
    (p_org_id, 'INPUT', 'Input VAT', COALESCE(v_rate, 0), v_tax_acct, 'input', true)
  ON CONFLICT (organization_id, code) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_default_tax_codes(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- VAT liability (output + input + net)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_vat_liability_report(
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
DECLARE
  v_output_tax NUMERIC := 0;
  v_input_tax NUMERIC := 0;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(SUM(cil.tax_amount), 0) - COALESCE((
    SELECT SUM(cnl.tax_amount)
    FROM customer_credit_note_lines cnl
    JOIN customer_credit_notes cn ON cn.id = cnl.credit_note_id
    WHERE cnl.organization_id = p_org_id
      AND cn.status = 'posted'
      AND cn.credit_date BETWEEN p_from AND p_to
  ), 0)
  INTO v_output_tax
  FROM customer_invoice_lines cil
  JOIN customer_invoices ci ON ci.id = cil.invoice_id
  WHERE cil.organization_id = p_org_id
    AND ci.status IN ('posted', 'paid')
    AND ci.invoice_date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(vbl.tax_amount), 0) INTO v_input_tax
  FROM vendor_bill_lines vbl
  JOIN vendor_bills vb ON vb.id = vbl.bill_id
  WHERE vbl.organization_id = p_org_id
    AND vb.status IN ('open', 'partially_paid', 'paid')
    AND vb.bill_date BETWEEN p_from AND p_to
    AND vbl.tax_amount > 0;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'output_tax', round(v_output_tax, 2),
    'input_tax', round(v_input_tax, 2),
    'net_payable', round(v_output_tax - v_input_tax, 2),
    'output_lines', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'code'))
      FROM (
        SELECT jsonb_build_object(
          'code', COALESCE(tc.code, 'UNSPECIFIED'),
          'name', COALESCE(tc.name, 'Unspecified'),
          'rate', COALESCE(tc.rate, cil.tax_rate, 0),
          'taxable_base', SUM(cil.line_total),
          'tax_amount', SUM(cil.tax_amount)
        ) AS row_data
        FROM customer_invoice_lines cil
        JOIN customer_invoices ci ON ci.id = cil.invoice_id
        LEFT JOIN tax_codes tc ON tc.id = cil.tax_code_id
        WHERE cil.organization_id = p_org_id
          AND ci.status IN ('posted', 'paid')
          AND ci.invoice_date BETWEEN p_from AND p_to
        GROUP BY tc.code, tc.name, tc.rate, cil.tax_rate

        UNION ALL

        SELECT jsonb_build_object(
          'code', COALESCE(tc.code, 'UNSPECIFIED'),
          'name', COALESCE(tc.name, 'Unspecified'),
          'rate', COALESCE(tc.rate, cnl.tax_rate, 0),
          'taxable_base', -SUM(cnl.line_total),
          'tax_amount', -SUM(cnl.tax_amount)
        )
        FROM customer_credit_note_lines cnl
        JOIN customer_credit_notes cn ON cn.id = cnl.credit_note_id
        LEFT JOIN tax_codes tc ON tc.id = cnl.tax_code_id
        WHERE cnl.organization_id = p_org_id
          AND cn.status = 'posted'
          AND cn.credit_date BETWEEN p_from AND p_to
        GROUP BY tc.code, tc.name, tc.rate, cnl.tax_rate
      ) t
    ), '[]'::jsonb),
    'input_lines', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'code'))
      FROM (
        SELECT jsonb_build_object(
          'code', COALESCE(tc.code, 'UNSPECIFIED'),
          'name', COALESCE(tc.name, 'Unspecified'),
          'rate', COALESCE(tc.rate, vbl.tax_rate, 0),
          'taxable_base', SUM(vbl.amount),
          'tax_amount', SUM(vbl.tax_amount)
        ) AS row_data
        FROM vendor_bill_lines vbl
        JOIN vendor_bills vb ON vb.id = vbl.bill_id
        LEFT JOIN tax_codes tc ON tc.id = vbl.tax_code_id
        WHERE vbl.organization_id = p_org_id
          AND vb.status IN ('open', 'partially_paid', 'paid')
          AND vb.bill_date BETWEEN p_from AND p_to
          AND vbl.tax_amount > 0
        GROUP BY tc.code, tc.name, tc.rate, vbl.tax_rate
      ) input_rows
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_vat_liability_report(UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Tax return periods
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tax_return_period(
  p_org_id UUID,
  p_from DATE,
  p_to DATE,
  p_return_type TEXT DEFAULT 'vat',
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_report JSONB;
  v_output NUMERIC;
  v_input NUMERIC;
  v_net NUMERIC;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_return_type NOT IN ('vat', 'withholding') THEN
    RAISE EXCEPTION 'Invalid return type';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'Invalid period range';
  END IF;

  v_report := public.get_vat_liability_report(p_org_id, p_from, p_to);
  v_output := COALESCE((v_report->>'output_tax')::NUMERIC, 0);
  v_input := COALESCE((v_report->>'input_tax')::NUMERIC, 0);
  v_net := COALESCE((v_report->>'net_payable')::NUMERIC, 0);

  INSERT INTO tax_return_periods (
    organization_id, return_type, period_from, period_to,
    output_tax, input_tax, net_payable, notes, created_by
  ) VALUES (
    p_org_id, p_return_type, p_from, p_to,
    v_output, v_input, v_net, NULLIF(trim(p_notes), ''), auth.uid()
  )
  ON CONFLICT (organization_id, return_type, period_from, period_to)
  DO UPDATE SET
    output_tax = EXCLUDED.output_tax,
    input_tax = EXCLUDED.input_tax,
    net_payable = EXCLUDED.net_payable,
    notes = COALESCE(EXCLUDED.notes, tax_return_periods.notes)
  WHERE tax_return_periods.status = 'draft'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_tax_return_period(UUID, DATE, DATE, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_tax_return_periods(
  p_org_id UUID,
  p_limit INT DEFAULT 24
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
        'id', tr.id,
        'return_type', tr.return_type,
        'period_from', tr.period_from,
        'period_to', tr.period_to,
        'status', tr.status,
        'output_tax', tr.output_tax,
        'input_tax', tr.input_tax,
        'net_payable', tr.net_payable,
        'notes', tr.notes,
        'filed_at', tr.filed_at,
        'created_at', tr.created_at
      ) ORDER BY tr.period_to DESC, tr.created_at DESC
    )
    FROM (
      SELECT * FROM tax_return_periods
      WHERE organization_id = p_org_id
      ORDER BY period_to DESC, created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 24), 1)
    ) tr
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_tax_return_periods(UUID, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.file_tax_return(p_return_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_return tax_return_periods%ROWTYPE;
BEGIN
  SELECT * INTO v_return FROM tax_return_periods WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tax return not found'; END IF;
  IF NOT public.user_can_manage(v_return.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_return.status <> 'draft' THEN RAISE EXCEPTION 'Only draft returns can be filed'; END IF;

  UPDATE tax_return_periods
  SET status = 'filed', filed_at = now(), filed_by = auth.uid()
  WHERE id = p_return_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.file_tax_return(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- E-invoicing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._build_einvoice_payload(
  p_org_id UUID,
  p_invoice_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_customer customers%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF v_inv.customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = v_inv.customer_id;
  END IF;

  RETURN jsonb_build_object(
    'invoice_no', v_inv.invoice_no,
    'invoice_date', v_inv.invoice_date,
    'due_date', v_inv.due_date,
    'subtotal', v_inv.subtotal,
    'tax_amount', v_inv.tax_amount,
    'total', v_inv.total,
    'seller', jsonb_build_object(
      'name', v_org.name,
      'tax_id', v_org.tax_id
    ),
    'buyer', jsonb_build_object(
      'name', COALESCE(v_customer.name, 'Walk-in'),
      'tax_id', NULL
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'description', cil.description,
          'quantity', cil.quantity,
          'unit_price', cil.unit_price,
          'line_total', cil.line_total,
          'tax_rate', cil.tax_rate,
          'tax_amount', cil.tax_amount
        ) ORDER BY cil.id
      )
      FROM customer_invoice_lines cil
      WHERE cil.invoice_id = p_invoice_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_einvoice(
  p_org_id UUID,
  p_invoice_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_existing UUID;
  v_doc_id UUID;
  v_payload JSONB;
  v_provider TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id AND organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF v_inv.status NOT IN ('posted', 'paid') THEN
    RAISE EXCEPTION 'Only posted or paid invoices can be e-invoiced';
  END IF;

  SELECT id INTO v_existing
  FROM einvoice_documents
  WHERE organization_id = p_org_id
    AND source_type = 'customer_invoice'
    AND source_id = p_invoice_id
    AND status IN ('pending', 'submitted', 'accepted')
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'An active e-invoice already exists for this invoice';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id;
  IF NOT COALESCE(v_org.einvoice_enabled, false) THEN
    RAISE EXCEPTION 'E-invoicing is not enabled for this organization';
  END IF;

  v_provider := COALESCE(v_org.einvoice_provider, 'internal');
  v_payload := public._build_einvoice_payload(p_org_id, p_invoice_id);

  INSERT INTO einvoice_documents (
    organization_id, source_type, source_id, document_number, provider,
    status, payload, submitted_at, created_by
  ) VALUES (
    p_org_id, 'customer_invoice', p_invoice_id, v_inv.invoice_no, v_provider,
    'submitted', v_payload, now(), auth.uid()
  ) RETURNING id INTO v_doc_id;

  IF v_provider = 'internal' THEN
    UPDATE einvoice_documents
    SET
      status = 'accepted',
      external_id = 'INT-' || upper(substr(replace(v_doc_id::text, '-', ''), 1, 12)),
      response = jsonb_build_object('provider', 'internal', 'message', 'Accepted (stub)'),
      accepted_at = now()
    WHERE id = v_doc_id;
  END IF;

  RETURN v_doc_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_einvoice(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_einvoice_documents(
  p_org_id UUID,
  p_limit INT DEFAULT 50
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
        'id', ed.id,
        'source_type', ed.source_type,
        'source_id', ed.source_id,
        'document_number', ed.document_number,
        'provider', ed.provider,
        'status', ed.status,
        'external_id', ed.external_id,
        'error_message', ed.error_message,
        'submitted_at', ed.submitted_at,
        'accepted_at', ed.accepted_at,
        'invoice_total', ci.total,
        'invoice_date', ci.invoice_date
      ) ORDER BY ed.created_at DESC
    )
    FROM (
      SELECT * FROM einvoice_documents
      WHERE organization_id = p_org_id
      ORDER BY created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    ) ed
    LEFT JOIN customer_invoices ci
      ON ed.source_type = 'customer_invoice' AND ci.id = ed.source_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_einvoice_documents(UUID, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_invoices_pending_einvoice(
  p_org_id UUID,
  p_limit INT DEFAULT 50
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
        'id', ci.id,
        'invoice_no', ci.invoice_no,
        'invoice_date', ci.invoice_date,
        'total', ci.total,
        'tax_amount', ci.tax_amount,
        'status', ci.status
      ) ORDER BY ci.invoice_date DESC
    )
    FROM (
      SELECT ci.*
      FROM customer_invoices ci
      WHERE ci.organization_id = p_org_id
        AND ci.status IN ('posted', 'paid')
        AND NOT EXISTS (
          SELECT 1 FROM einvoice_documents ed
          WHERE ed.organization_id = p_org_id
            AND ed.source_type = 'customer_invoice'
            AND ed.source_id = ci.id
            AND ed.status IN ('pending', 'submitted', 'accepted')
        )
      ORDER BY ci.invoice_date DESC
      LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    ) ci
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_invoices_pending_einvoice(UUID, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Withholding tax rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_withholding_tax_rules(p_org_id UUID)
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
        'id', w.id,
        'name', w.name,
        'rate', w.rate,
        'applies_to', w.applies_to,
        'is_active', w.is_active,
        'liability_account_id', w.liability_account_id
      ) ORDER BY w.name
    )
    FROM withholding_tax_rules w
    WHERE w.organization_id = p_org_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_withholding_tax_rules(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_withholding_tax_rule(
  p_org_id UUID,
  p_rule_id UUID,
  p_name TEXT,
  p_rate NUMERIC,
  p_applies_to TEXT DEFAULT 'vendor_payments',
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_tax_acct UUID;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_rate < 0 OR p_rate > 100 THEN RAISE EXCEPTION 'Rate must be 0–100'; END IF;
  IF p_applies_to NOT IN ('vendor_payments', 'customer_invoices') THEN
    RAISE EXCEPTION 'Invalid applies_to value';
  END IF;

  PERFORM public.ensure_default_accounts(p_org_id);
  v_tax_acct := public.account_id_by_code(p_org_id, '2100');

  IF p_rule_id IS NOT NULL THEN
    UPDATE withholding_tax_rules
    SET
      name = trim(p_name),
      rate = p_rate,
      applies_to = COALESCE(p_applies_to, applies_to),
      is_active = COALESCE(p_is_active, true)
    WHERE id = p_rule_id AND organization_id = p_org_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
  ELSE
    INSERT INTO withholding_tax_rules (
      organization_id, name, rate, applies_to, liability_account_id, is_active
    ) VALUES (
      p_org_id, trim(p_name), p_rate, COALESCE(p_applies_to, 'vendor_payments'), v_tax_acct, COALESCE(p_is_active, true)
    ) RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_withholding_tax_rule(UUID, UUID, TEXT, NUMERIC, TEXT, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- Extend tax_summary_report with net payable hint
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tax_summary_report(
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
DECLARE
  v_output NUMERIC;
  v_input NUMERIC;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(SUM(cil.tax_amount), 0) - COALESCE((
    SELECT SUM(cnl.tax_amount)
    FROM customer_credit_note_lines cnl
    JOIN customer_credit_notes cn ON cn.id = cnl.credit_note_id
    WHERE cnl.organization_id = p_org_id
      AND cn.status = 'posted'
      AND cn.credit_date BETWEEN p_from AND p_to
  ), 0)
  INTO v_output
  FROM customer_invoice_lines cil
  JOIN customer_invoices ci ON ci.id = cil.invoice_id
  WHERE cil.organization_id = p_org_id
    AND ci.status IN ('posted', 'paid')
    AND ci.invoice_date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(vbl.tax_amount), 0) INTO v_input
  FROM vendor_bill_lines vbl
  JOIN vendor_bills vb ON vb.id = vbl.bill_id
  WHERE vbl.organization_id = p_org_id
    AND vb.status IN ('open', 'partially_paid', 'paid')
    AND vb.bill_date BETWEEN p_from AND p_to;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'lines', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'code'))
      FROM (
        SELECT jsonb_build_object(
          'code', COALESCE(tc.code, 'UNSPECIFIED'),
          'name', COALESCE(tc.name, 'Unspecified'),
          'rate', COALESCE(tc.rate, cil.tax_rate, 0),
          'taxable_base', SUM(cil.line_total),
          'tax_collected', SUM(cil.tax_amount)
        ) AS row_data
        FROM customer_invoice_lines cil
        JOIN customer_invoices ci ON ci.id = cil.invoice_id
        LEFT JOIN tax_codes tc ON tc.id = cil.tax_code_id
        WHERE cil.organization_id = p_org_id
          AND ci.status IN ('posted', 'paid')
          AND ci.invoice_date BETWEEN p_from AND p_to
        GROUP BY tc.code, tc.name, tc.rate, cil.tax_rate

        UNION ALL

        SELECT jsonb_build_object(
          'code', COALESCE(tc.code, 'UNSPECIFIED'),
          'name', COALESCE(tc.name, 'Unspecified'),
          'rate', COALESCE(tc.rate, cnl.tax_rate, 0),
          'taxable_base', -SUM(cnl.line_total),
          'tax_collected', -SUM(cnl.tax_amount)
        )
        FROM customer_credit_note_lines cnl
        JOIN customer_credit_notes cn ON cn.id = cnl.credit_note_id
        LEFT JOIN tax_codes tc ON tc.id = cnl.tax_code_id
        WHERE cnl.organization_id = p_org_id
          AND cn.status = 'posted'
          AND cn.credit_date BETWEEN p_from AND p_to
        GROUP BY tc.code, tc.name, tc.rate, cnl.tax_rate
      ) t
    ), '[]'::jsonb),
    'total_tax', round(v_output, 2),
    'input_tax', round(v_input, 2),
    'net_payable', round(v_output - v_input, 2)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.tax_summary_report(UUID, DATE, DATE) TO authenticated;

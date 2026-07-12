-- Fix: get_vat_liability_report nested aggregate in input_lines (breaks AI context + executive dashboard)

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

-- EFM Wave 0 — foundation hardening (no breaking changes)

-- ---------------------------------------------------------------------------
-- Period reopen: remove closing journal entry (was leaving orphan close JEs)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_fiscal_period(p_period_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period fiscal_periods%ROWTYPE;
  v_latest_closed UUID;
  v_closing_id UUID;
BEGIN
  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period not found';
  END IF;
  IF NOT public.user_can_manage(v_period.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_period.status <> 'closed'::fiscal_period_status THEN
    RAISE EXCEPTION 'Period is not closed';
  END IF;

  SELECT fp.id INTO v_latest_closed
  FROM fiscal_periods fp
  WHERE fp.organization_id = v_period.organization_id
    AND fp.status = 'closed'::fiscal_period_status
  ORDER BY fp.end_date DESC
  LIMIT 1;

  IF v_latest_closed IS DISTINCT FROM p_period_id THEN
    RAISE EXCEPTION 'Only the most recently closed period can be reopened';
  END IF;

  v_closing_id := v_period.closing_entry_id;

  IF v_closing_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.id = v_closing_id
        AND je.organization_id = v_period.organization_id
        AND je.source_type = 'period_close'
        AND je.source_id = p_period_id
    ) THEN
      RAISE EXCEPTION 'Closing journal entry mismatch — cannot reopen safely';
    END IF;
  END IF;

  UPDATE fiscal_periods
  SET status = 'open'::fiscal_period_status,
      closed_at = NULL,
      closed_by = NULL,
      closing_entry_id = NULL
  WHERE id = p_period_id;

  IF v_closing_id IS NOT NULL THEN
    DELETE FROM journal_entry_lines WHERE entry_id = v_closing_id;
    DELETE FROM journal_entries WHERE id = v_closing_id;
  END IF;

  PERFORM public._refresh_accounting_lock_date(v_period.organization_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Paginated customer invoices (replaces direct table scans in integrations)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_customer_invoices_page(
  p_org_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_q TEXT := NULLIF(trim(p_search), '');
  v_total INT;
  v_rows JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM customer_invoices ci
  LEFT JOIN customers c ON c.id = ci.customer_id
  WHERE ci.organization_id = p_org_id
    AND (p_from IS NULL OR ci.invoice_date >= p_from)
    AND (p_to IS NULL OR ci.invoice_date <= p_to)
    AND (p_status IS NULL OR ci.status::text = p_status)
    AND (
      v_q IS NULL
      OR ci.invoice_no ILIKE '%' || v_q || '%'
      OR c.name ILIKE '%' || v_q || '%'
    );

  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'invoice_date' DESC, row_data->>'invoice_no' DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', ci.id,
      'invoice_no', ci.invoice_no,
      'invoice_date', ci.invoice_date,
      'due_date', ci.due_date,
      'status', ci.status,
      'subtotal', ci.subtotal,
      'tax_amount', ci.tax_amount,
      'total', ci.total,
      'customer_id', ci.customer_id,
      'customer_name', c.name,
      'journal_entry_id', ci.journal_entry_id,
      'paid_entry_id', ci.paid_entry_id,
      'created_at', ci.created_at
    ) AS row_data
    FROM customer_invoices ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = p_org_id
      AND (p_from IS NULL OR ci.invoice_date >= p_from)
      AND (p_to IS NULL OR ci.invoice_date <= p_to)
      AND (p_status IS NULL OR ci.status::text = p_status)
      AND (
        v_q IS NULL
        OR ci.invoice_no ILIKE '%' || v_q || '%'
        OR c.name ILIKE '%' || v_q || '%'
      )
    ORDER BY ci.invoice_date DESC, ci.invoice_no DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('total', v_total, 'invoices', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_customer_invoices_page(UUID, DATE, DATE, TEXT, INT, INT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Paginated vendor bills
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_vendor_bills_page(
  p_org_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_q TEXT := NULLIF(trim(p_search), '');
  v_total INT;
  v_rows JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM vendor_bills vb
  JOIN vendors v ON v.id = vb.vendor_id
  WHERE vb.organization_id = p_org_id
    AND (p_from IS NULL OR vb.bill_date >= p_from)
    AND (p_to IS NULL OR vb.bill_date <= p_to)
    AND (p_status IS NULL OR vb.status::text = p_status)
    AND (
      v_q IS NULL
      OR COALESCE(vb.bill_no, '') ILIKE '%' || v_q || '%'
      OR v.name ILIKE '%' || v_q || '%'
    );

  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'bill_date' DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', vb.id,
      'bill_no', vb.bill_no,
      'bill_date', vb.bill_date,
      'due_date', vb.due_date,
      'status', vb.status,
      'amount', vb.amount,
      'vendor_id', vb.vendor_id,
      'vendor_name', v.name,
      'po_id', vb.po_id,
      'journal_entry_id', vb.journal_entry_id,
      'paid_entry_id', vb.paid_entry_id,
      'created_at', vb.created_at
    ) AS row_data
    FROM vendor_bills vb
    JOIN vendors v ON v.id = vb.vendor_id
    WHERE vb.organization_id = p_org_id
      AND (p_from IS NULL OR vb.bill_date >= p_from)
      AND (p_to IS NULL OR vb.bill_date <= p_to)
      AND (p_status IS NULL OR vb.status::text = p_status)
      AND (
        v_q IS NULL
        OR COALESCE(vb.bill_no, '') ILIKE '%' || v_q || '%'
        OR v.name ILIKE '%' || v_q || '%'
      )
    ORDER BY vb.bill_date DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('total', v_total, 'bills', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_vendor_bills_page(UUID, DATE, DATE, TEXT, INT, INT, TEXT) TO authenticated;

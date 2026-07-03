-- Fix archive_cold_sales: sale_returns uses original_sale_id, not sale_id.

CREATE OR REPLACE FUNCTION public.archive_cold_sales(
  p_min_age_months INT DEFAULT 24,
  p_batch_size INT DEFAULT 200
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_sale RECORD;
  v_moved INT := 0;
  v_limit INT;
BEGIN
  v_limit := GREATEST(10, LEAST(COALESCE(p_batch_size, 200), 1000));
  v_cutoff := date_trunc('month', now()) - make_interval(months => GREATEST(12, LEAST(COALESCE(p_min_age_months, 24), 120)));

  FOR v_sale IN
    SELECT s.id
    FROM sales s
    WHERE s.status = 'completed'
      AND s.created_at < v_cutoff
      AND NOT EXISTS (SELECT 1 FROM sale_returns sr WHERE sr.original_sale_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM sales s2 WHERE s2.original_sale_id = s.id)
      AND EXISTS (
        SELECT 1 FROM org_daily_sales_summary ods
        WHERE ods.organization_id = s.organization_id
          AND ods.store_id = '00000000-0000-0000-0000-000000000000'::uuid
          AND ods.summary_date = (s.created_at AT TIME ZONE 'UTC')::date
      )
    ORDER BY s.created_at
    LIMIT v_limit
  LOOP
    INSERT INTO sales_archive
    SELECT s.*, now(), date_trunc('month', s.created_at AT TIME ZONE 'UTC')::date
    FROM sales s WHERE s.id = v_sale.id;

    INSERT INTO sale_lines_archive
    SELECT sl.*, now() FROM sale_lines sl WHERE sl.sale_id = v_sale.id;

    INSERT INTO payments_archive
    SELECT p.*, now() FROM payments p WHERE p.sale_id = v_sale.id;

    DELETE FROM sale_lines WHERE sale_id = v_sale.id;
    DELETE FROM payments WHERE sale_id = v_sale.id;
    DELETE FROM sales WHERE id = v_sale.id;

    v_moved := v_moved + 1;
  END LOOP;

  RETURN v_moved;
END;
$$;

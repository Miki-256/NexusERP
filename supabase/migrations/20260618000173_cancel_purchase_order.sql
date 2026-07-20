-- Allow managers to cancel draft/ordered purchase orders before receipt.

CREATE OR REPLACE FUNCTION public.cancel_purchase_order(
  p_po_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_note TEXT;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;

  IF NOT public.user_can_manage(v_po.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_po.status = 'cancelled' THEN
    RETURN p_po_id;
  END IF;

  IF v_po.status NOT IN ('draft', 'ordered') THEN
    RAISE EXCEPTION 'Only draft or ordered purchase orders can be cancelled (current status: %)', v_po.status;
  END IF;

  v_note := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF v_note IS NOT NULL THEN
    UPDATE purchase_orders
    SET
      status = 'cancelled',
      notes = CASE
        WHEN notes IS NULL OR btrim(notes) = '' THEN 'Cancelled: ' || v_note
        ELSE notes || E'\nCancelled: ' || v_note
      END
    WHERE id = p_po_id;
  ELSE
    UPDATE purchase_orders
    SET status = 'cancelled'
    WHERE id = p_po_id;
  END IF;

  RETURN p_po_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(UUID, TEXT) TO authenticated;

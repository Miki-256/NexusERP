-- Fix ambiguous uom_code: RETURNS TABLE out-params collide with product_uoms.uom_code
-- (especially ON CONFLICT (product_id, uom_code) and OUT assignments).

CREATE OR REPLACE FUNCTION public._resolve_line_uom(
  p_variant_id UUID,
  p_quantity NUMERIC,
  p_uom_code TEXT DEFAULT NULL,
  p_require_sale BOOLEAN DEFAULT false,
  p_require_purchase BOOLEAN DEFAULT false
)
RETURNS TABLE(uom_code TEXT, qty_base NUMERIC, conversion_factor NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_org_id UUID;
  v_code TEXT;
  v_lookup TEXT;
  v_factor NUMERIC;
  v_is_base BOOLEAN;
  v_is_sale BOOLEAN;
  v_is_purchase BOOLEAN;
  v_base_code TEXT;
  v_qty_base NUMERIC;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;

  SELECT pv.product_id, pv.organization_id, COALESCE(NULLIF(trim(p.base_uom_code), ''), 'ea')
  INTO v_product_id, v_org_id, v_base_code
  FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  WHERE pv.id = p_variant_id;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Variant not found';
  END IF;

  v_code := NULLIF(lower(trim(COALESCE(p_uom_code, ''))), '');
  IF v_code IS NULL OR v_code = 'null' OR v_code = 'undefined' THEN
    SELECT trim(pu.uom_code) INTO v_code
    FROM public.product_uoms pu
    WHERE pu.product_id = v_product_id AND pu.is_base
    LIMIT 1;
    v_code := COALESCE(NULLIF(v_code, ''), v_base_code, 'ea');
  END IF;

  v_lookup := v_code;

  SELECT pu.conversion_factor, pu.is_base, pu.is_sale, pu.is_purchase, trim(pu.uom_code)
  INTO v_factor, v_is_base, v_is_sale, v_is_purchase, v_code
  FROM public.product_uoms pu
  WHERE pu.product_id = v_product_id AND lower(pu.uom_code) = lower(v_lookup)
  LIMIT 1;

  IF NOT FOUND OR v_factor IS NULL THEN
    v_code := v_lookup;
    IF lower(v_code) = lower(v_base_code) OR lower(v_code) = 'ea' THEN
      v_factor := 1;
      v_is_base := true;
      v_is_sale := true;
      v_is_purchase := true;
      INSERT INTO public.product_uoms (
        organization_id, product_id, uom_code, uom_name, conversion_factor, is_base, is_sale, is_purchase
      )
      VALUES (v_org_id, v_product_id, v_code, v_code, 1, true, true, true)
      ON CONFLICT ON CONSTRAINT product_uoms_product_id_uom_code_key DO NOTHING;
    ELSE
      RAISE EXCEPTION 'Unknown UOM % for product', v_code;
    END IF;
  END IF;

  IF p_require_sale AND NOT COALESCE(v_is_sale, false) AND NOT COALESCE(v_is_base, false) THEN
    RAISE EXCEPTION 'UOM % is not enabled for sale', v_code;
  END IF;
  IF p_require_purchase AND NOT COALESCE(v_is_purchase, false) AND NOT COALESCE(v_is_base, false) THEN
    RAISE EXCEPTION 'UOM % is not enabled for purchase', v_code;
  END IF;

  IF v_factor IS NULL OR v_factor <= 0 THEN
    RAISE EXCEPTION 'Invalid conversion factor for UOM %', v_code;
  END IF;

  v_qty_base := round(p_quantity * v_factor, 6);

  -- Avoid assigning to OUT names that collide with table columns
  RETURN QUERY SELECT v_code::TEXT, v_qty_base, v_factor;
END;
$$;

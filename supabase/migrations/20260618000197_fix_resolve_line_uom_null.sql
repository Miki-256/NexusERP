-- Fix: Unknown UOM <NULL> for product
-- When no product_uoms row matches, SELECT INTO nullifies ALL targets including v_code,
-- so the ea/base fallback never ran. Preserve the lookup code across the SELECT.

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

  -- Treat JSON null / "null" / blank as missing
  v_code := NULLIF(lower(trim(COALESCE(p_uom_code, ''))), '');
  IF v_code IS NULL OR v_code = 'null' OR v_code = 'undefined' THEN
    SELECT u.uom_code INTO v_code
    FROM product_uoms u
    WHERE u.product_id = v_product_id AND u.is_base
    LIMIT 1;
    v_code := COALESCE(NULLIF(trim(v_code), ''), v_base_code, 'ea');
  END IF;

  v_lookup := v_code;

  SELECT u.conversion_factor, u.is_base, u.is_sale, u.is_purchase, u.uom_code
  INTO v_factor, v_is_base, v_is_sale, v_is_purchase, v_code
  FROM product_uoms u
  WHERE u.product_id = v_product_id AND lower(u.uom_code) = lower(v_lookup)
  LIMIT 1;

  -- SELECT INTO clears targets when no row — restore lookup code
  IF NOT FOUND OR v_factor IS NULL THEN
    v_code := v_lookup;
    IF lower(v_code) = lower(v_base_code) OR lower(v_code) = 'ea' THEN
      v_factor := 1;
      v_is_base := true;
      v_is_sale := true;
      v_is_purchase := true;
      INSERT INTO product_uoms (organization_id, product_id, uom_code, uom_name, conversion_factor, is_base, is_sale, is_purchase)
      VALUES (v_org_id, v_product_id, v_code, v_code, 1, true, true, true)
      ON CONFLICT (product_id, uom_code) DO NOTHING;
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

  uom_code := v_code;
  conversion_factor := v_factor;
  qty_base := round(p_quantity * v_factor, 6);
  RETURN NEXT;
END;
$$;

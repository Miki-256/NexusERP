-- Product images + update RPC

ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Storage bucket for product photos (public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path: {organization_id}/{product_id}/{filename}
DROP POLICY IF EXISTS product_images_select ON storage.objects;
DROP POLICY IF EXISTS product_images_insert ON storage.objects;
DROP POLICY IF EXISTS product_images_update ON storage.objects;
DROP POLICY IF EXISTS product_images_delete ON storage.objects;

CREATE POLICY product_images_select ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY product_images_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.user_organization_ids())
    AND public.user_can_manage((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY product_images_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.user_organization_ids())
    AND public.user_can_manage((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY product_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.user_organization_ids())
    AND public.user_can_manage((storage.foldername(name))[1]::uuid)
  );

-- Extend create to store image_url (replace old signature)
DROP FUNCTION IF EXISTS public.create_product_with_variant(
  UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, NUMERIC
);

CREATE OR REPLACE FUNCTION public.create_product_with_variant(
  p_organization_id UUID,
  p_name TEXT,
  p_category_id UUID,
  p_sku TEXT,
  p_barcode TEXT,
  p_sell_price NUMERIC,
  p_cost_price NUMERIC,
  p_tax_rate NUMERIC,
  p_store_id UUID,
  p_initial_qty NUMERIC DEFAULT 0,
  p_image_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_variant_id UUID;
BEGIN
  IF NOT public.user_can_manage(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO products (
    organization_id, category_id, name, sku, barcode,
    sell_price, cost_price, tax_rate, image_url
  )
  VALUES (
    p_organization_id, p_category_id, p_name, p_sku, p_barcode,
    p_sell_price, COALESCE(p_cost_price, 0), p_tax_rate, p_image_url
  )
  RETURNING id INTO v_product_id;

  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, p_organization_id, 'Default', p_sku, p_barcode, p_sell_price, COALESCE(p_cost_price, 0))
  RETURNING id INTO v_variant_id;

  IF p_store_id IS NOT NULL AND p_initial_qty > 0 THEN
    INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
    VALUES (p_store_id, v_variant_id, p_organization_id, p_initial_qty)
    ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;
  ELSIF p_store_id IS NOT NULL THEN
    INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
    VALUES (p_store_id, v_variant_id, p_organization_id, 0)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('product_id', v_product_id, 'variant_id', v_variant_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_variant(
  UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, NUMERIC, TEXT
) TO authenticated;

-- Update product + default variant
CREATE OR REPLACE FUNCTION public.update_product_with_variant(
  p_product_id UUID,
  p_name TEXT,
  p_category_id UUID,
  p_sku TEXT,
  p_barcode TEXT,
  p_sell_price NUMERIC,
  p_cost_price NUMERIC,
  p_tax_rate NUMERIC,
  p_image_url TEXT,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM products WHERE id = p_product_id;
  IF NOT FOUND OR NOT public.user_can_manage(v_org) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE products SET
    name = p_name,
    category_id = p_category_id,
    sku = p_sku,
    barcode = p_barcode,
    sell_price = p_sell_price,
    cost_price = COALESCE(p_cost_price, 0),
    tax_rate = p_tax_rate,
    image_url = p_image_url,
    is_active = COALESCE(p_is_active, true),
    updated_at = now()
  WHERE id = p_product_id;

  UPDATE product_variants SET
    sku = p_sku,
    barcode = p_barcode,
    sell_price = p_sell_price,
    cost_price = COALESCE(p_cost_price, 0),
    is_active = COALESCE(p_is_active, true)
  WHERE product_id = p_product_id AND name = 'Default';
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_product_with_variant TO authenticated;

-- Include image in POS catalog
CREATE OR REPLACE FUNCTION public.get_pos_catalog(p_register_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_store UUID;
  v_result JSONB;
BEGIN
  SELECT organization_id, store_id INTO v_org, v_store
  FROM registers WHERE id = p_register_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register not found';
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'name'), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'productId', p.id,
      'variantId', pv.id,
      'name', p.name,
      'variantName', pv.name,
      'sellPrice', COALESCE(pv.sell_price, p.sell_price),
      'barcode', COALESCE(pv.barcode, p.barcode),
      'sku', COALESCE(pv.sku, p.sku),
      'stock', COALESCE(il.quantity, 0),
      'categoryId', p.category_id,
      'categoryName', c.name,
      'imageUrl', p.image_url
    ) AS row,
    p.name
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN inventory_levels il ON il.variant_id = pv.id AND il.store_id = v_store
    WHERE p.organization_id = v_org AND p.is_active = true
  ) sub;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_catalog TO anon, authenticated;

-- Sample products for organization bc3717ca-62e9-4cfd-b0da-019499953072
-- Run in Supabase Dashboard → SQL Editor (runs as postgres, bypasses RLS)

DO $$
DECLARE
  v_org_id UUID := 'bc3717ca-62e9-4cfd-b0da-019499953072';
  v_store_id UUID;
  v_cat_bev UUID;
  v_cat_groc UUID;
  v_cat_house UUID;
  v_product_id UUID;
  v_variant_id UUID;
BEGIN
  SELECT id INTO v_store_id
  FROM stores
  WHERE organization_id = v_org_id AND is_active = true
  ORDER BY created_at
  LIMIT 1;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'No active store found for organization %', v_org_id;
  END IF;

  -- Categories
  INSERT INTO categories (organization_id, name, sort_order)
  VALUES (v_org_id, 'Beverages', 1)
  RETURNING id INTO v_cat_bev;

  INSERT INTO categories (organization_id, name, sort_order)
  VALUES (v_org_id, 'Groceries', 2)
  RETURNING id INTO v_cat_groc;

  INSERT INTO categories (organization_id, name, sort_order)
  VALUES (v_org_id, 'Household', 3)
  RETURNING id INTO v_cat_house;

  -- Helper: product + variant + stock
  -- 1. Bottled Water
  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_org_id, v_cat_bev, 'Bottled Water 1.5L', 'BEV-001', '1001001001001', 25.00, 15.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, v_org_id, 'Default', 'BEV-001', '1001001001001', 25.00, 15.00)
  RETURNING id INTO v_variant_id;
  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (v_store_id, v_variant_id, v_org_id, 120)
  ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

  -- 2. Coca-Cola
  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_org_id, v_cat_bev, 'Coca-Cola 500ml', 'BEV-002', '1001001001002', 35.00, 22.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, v_org_id, 'Default', 'BEV-002', '1001001001002', 35.00, 22.00)
  RETURNING id INTO v_variant_id;
  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (v_store_id, v_variant_id, v_org_id, 80)
  ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

  -- 3. Coffee Bun
  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_org_id, v_cat_groc, 'Coffee Bun (250g)', 'GRO-001', '2001001001001', 180.00, 120.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, v_org_id, 'Default', 'GRO-001', '2001001001001', 180.00, 120.00)
  RETURNING id INTO v_variant_id;
  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (v_store_id, v_variant_id, v_org_id, 45)
  ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

  -- 4. Bread
  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_org_id, v_cat_groc, 'White Bread Loaf', 'GRO-002', '2001001001002', 40.00, 25.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, v_org_id, 'Default', 'GRO-002', '2001001001002', 40.00, 25.00)
  RETURNING id INTO v_variant_id;
  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (v_store_id, v_variant_id, v_org_id, 60)
  ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

  -- 5. Sugar
  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_org_id, v_cat_groc, 'Sugar 1kg', 'GRO-003', '2001001001003', 95.00, 70.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, v_org_id, 'Default', 'GRO-003', '2001001001003', 95.00, 70.00)
  RETURNING id INTO v_variant_id;
  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (v_store_id, v_variant_id, v_org_id, 100)
  ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

  -- 6. Cooking Oil
  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_org_id, v_cat_groc, 'Cooking Oil 1L', 'GRO-004', '2001001001004', 220.00, 165.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, v_org_id, 'Default', 'GRO-004', '2001001001004', 220.00, 165.00)
  RETURNING id INTO v_variant_id;
  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (v_store_id, v_variant_id, v_org_id, 35)
  ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

  -- 7. Rice
  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_org_id, v_cat_groc, 'Rice 1kg', 'GRO-005', '2001001001005', 85.00, 60.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, v_org_id, 'Default', 'GRO-005', '2001001001005', 85.00, 60.00)
  RETURNING id INTO v_variant_id;
  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (v_store_id, v_variant_id, v_org_id, 90)
  ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

  -- 8. Milk
  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_org_id, v_cat_groc, 'Fresh Milk 1L', 'GRO-006', '2001001001006', 75.00, 55.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, v_org_id, 'Default', 'GRO-006', '2001001001006', 75.00, 55.00)
  RETURNING id INTO v_variant_id;
  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (v_store_id, v_variant_id, v_org_id, 40)
  ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

  -- 9. Soap
  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_org_id, v_cat_house, 'Laundry Soap Bar', 'HOU-001', '3001001001001', 35.00, 20.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, v_org_id, 'Default', 'HOU-001', '3001001001001', 35.00, 20.00)
  RETURNING id INTO v_variant_id;
  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (v_store_id, v_variant_id, v_org_id, 75)
  ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

  -- 10. Detergent
  INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_org_id, v_cat_house, 'Detergent Powder 500g', 'HOU-002', '3001001001002', 120.00, 85.00)
  RETURNING id INTO v_product_id;
  INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
  VALUES (v_product_id, v_org_id, 'Default', 'HOU-002', '3001001001002', 120.00, 85.00)
  RETURNING id INTO v_variant_id;
  INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
  VALUES (v_store_id, v_variant_id, v_org_id, 50)
  ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;

  RAISE NOTICE 'Seeded 10 products for org % on store %', v_org_id, v_store_id;
END $$;

-- Verify
SELECT p.name, p.sell_price, p.barcode, c.name AS category, il.quantity AS stock
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN product_variants pv ON pv.product_id = p.id
LEFT JOIN inventory_levels il ON il.variant_id = pv.id
WHERE p.organization_id = 'bc3717ca-62e9-4cfd-b0da-019499953072'
ORDER BY p.name;

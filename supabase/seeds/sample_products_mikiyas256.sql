-- Sample 20 products for the organization owned by mikiyas256@gmail.com
-- Run in Supabase Dashboard → SQL Editor (runs as postgres, bypasses RLS)

DO $$
DECLARE
  v_org_id UUID;
  v_store_id UUID;
  v_cat_bev UUID;
  v_cat_groc UUID;
  v_cat_house UUID;
  v_cat_dairy UUID;
  v_product_id UUID;
  v_variant_id UUID;
  rec RECORD;
BEGIN
  SELECT om.organization_id INTO v_org_id
  FROM auth.users u
  JOIN organization_members om ON om.user_id = u.id AND om.is_active = true
  WHERE u.email = 'mikiyas256@gmail.com'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization for mikiyas256@gmail.com';
  END IF;

  SELECT id INTO v_store_id FROM stores
  WHERE organization_id = v_org_id AND is_active = true ORDER BY created_at LIMIT 1;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'No active store for organization %', v_org_id;
  END IF;

  INSERT INTO categories (organization_id, name, sort_order)
  SELECT v_org_id, n, o FROM (VALUES ('Beverages',1),('Groceries',2),('Household',3),('Dairy & Proteins',4)) AS c(n,o)
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE organization_id = v_org_id AND name = c.n);

  SELECT id INTO v_cat_bev FROM categories WHERE organization_id = v_org_id AND name = 'Beverages';
  SELECT id INTO v_cat_groc FROM categories WHERE organization_id = v_org_id AND name = 'Groceries';
  SELECT id INTO v_cat_house FROM categories WHERE organization_id = v_org_id AND name = 'Household';
  SELECT id INTO v_cat_dairy FROM categories WHERE organization_id = v_org_id AND name = 'Dairy & Proteins';

  FOR rec IN
    SELECT * FROM (VALUES
      ('SMP-BEV-001', 'Bottled Water 1.5L', '1001001002001', 25.00, 15.00, 120, v_cat_bev),
      ('SMP-BEV-002', 'Coca-Cola 500ml', '1001001002002', 35.00, 22.00, 80, v_cat_bev),
      ('SMP-BEV-003', 'Orange Juice 1L', '1001001002003', 55.00, 38.00, 45, v_cat_bev),
      ('SMP-BEV-004', 'Mineral Water 500ml', '1001001002004', 15.00, 8.00, 200, v_cat_bev),
      ('SMP-GRO-001', 'Coffee Bun (250g)', '2001001002001', 180.00, 120.00, 45, v_cat_groc),
      ('SMP-GRO-002', 'White Bread Loaf', '2001001002002', 40.00, 25.00, 60, v_cat_groc),
      ('SMP-GRO-003', 'Sugar 1kg', '2001001002003', 95.00, 70.00, 100, v_cat_groc),
      ('SMP-GRO-004', 'Cooking Oil 1L', '2001001002004', 220.00, 165.00, 35, v_cat_groc),
      ('SMP-GRO-005', 'Rice 1kg', '2001001002005', 85.00, 60.00, 90, v_cat_groc),
      ('SMP-GRO-006', 'Pasta 500g', '2001001002006', 65.00, 45.00, 70, v_cat_groc),
      ('SMP-GRO-007', 'Tomato Paste 70g', '2001001002007', 28.00, 18.00, 85, v_cat_groc),
      ('SMP-GRO-008', 'Black Tea 25 bags', '2001001002008', 120.00, 85.00, 40, v_cat_groc),
      ('SMP-GRO-009', 'Salt 1kg', '2001001002009', 30.00, 18.00, 110, v_cat_groc),
      ('SMP-GRO-010', 'Honey 500g', '2001001002010', 250.00, 180.00, 25, v_cat_groc),
      ('SMP-HOU-001', 'Laundry Soap Bar', '3001001002001', 35.00, 20.00, 75, v_cat_house),
      ('SMP-HOU-002', 'Detergent Powder 500g', '3001001002002', 120.00, 85.00, 50, v_cat_house),
      ('SMP-HOU-003', 'Toilet Paper 4-roll', '3001001002003', 95.00, 65.00, 55, v_cat_house),
      ('SMP-HOU-004', 'Dish Soap 500ml', '3001001002004', 45.00, 28.00, 65, v_cat_house),
      ('SMP-DAI-001', 'Fresh Milk 1L', '4001001002001', 75.00, 55.00, 40, v_cat_dairy),
      ('SMP-DAI-002', 'Chicken Eggs (30 pack)', '4001001002002', 320.00, 250.00, 30, v_cat_dairy)
    ) AS t(sku, pname, barcode, sell, cost, qty, cat_id)
  LOOP
    IF EXISTS (SELECT 1 FROM products WHERE organization_id = v_org_id AND sku = rec.sku) THEN
      CONTINUE;
    END IF;

    INSERT INTO products (organization_id, category_id, name, sku, barcode, sell_price, cost_price)
    VALUES (v_org_id, rec.cat_id, rec.pname, rec.sku, rec.barcode, rec.sell, rec.cost)
    RETURNING id INTO v_product_id;

    INSERT INTO product_variants (product_id, organization_id, name, sku, barcode, sell_price, cost_price)
    VALUES (v_product_id, v_org_id, 'Default', rec.sku, rec.barcode, rec.sell, rec.cost)
    RETURNING id INTO v_variant_id;

    INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
    VALUES (v_store_id, v_variant_id, v_org_id, rec.qty)
    ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;
  END LOOP;

  RAISE NOTICE 'Seeded sample products for org % (store %)', v_org_id, v_store_id;
END $$;

-- Verify
SELECT p.sku, p.name, p.sell_price, c.name AS category, il.quantity AS stock
FROM auth.users u
JOIN organization_members om ON om.user_id = u.id AND om.is_active = true
JOIN products p ON p.organization_id = om.organization_id AND p.sku LIKE 'SMP-%'
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN product_variants pv ON pv.product_id = p.id
LEFT JOIN inventory_levels il ON il.variant_id = pv.id
WHERE u.email = 'mikiyas256@gmail.com'
ORDER BY p.sku;

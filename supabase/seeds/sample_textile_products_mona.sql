-- 55 sample textile retail products for Mona company
-- Run in Supabase Dashboard → SQL Editor (as postgres, bypasses RLS)
--
-- Matches organization by name (case-insensitive). Adjust the WHERE clause if needed:
--   WHERE name ILIKE '%Mona%'

DO $$
DECLARE
  v_org_id UUID;
  v_store_id UUID;
  v_cat_id UUID;
  v_product_id UUID;
  v_variant_id UUID;
  v_rec RECORD;
  v_cat_sort INT := 0;
  v_cats JSONB := '{}'::JSONB;
BEGIN
  SELECT id INTO v_org_id
  FROM organizations
  WHERE name ILIKE '%Mona%'
  ORDER BY created_at
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization matching "Mona" found. Create Mona company first or edit the name filter in this script.';
  END IF;

  SELECT id INTO v_store_id
  FROM stores
  WHERE organization_id = v_org_id AND is_active = true
  ORDER BY created_at
  LIMIT 1;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'No active store for organization %. Add a store first.', v_org_id;
  END IF;

  CREATE TEMP TABLE _mona_seed (
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    barcode TEXT NOT NULL,
    sell_price NUMERIC(12,2) NOT NULL,
    cost_price NUMERIC(12,2) NOT NULL,
    quantity NUMERIC(12,2) NOT NULL DEFAULT 25
  ) ON COMMIT DROP;

  INSERT INTO _mona_seed (category, name, sku, barcode, sell_price, cost_price, quantity) VALUES
    -- Men's Wear (10)
    ('Men''s Wear', 'Men''s Cotton T-Shirt White (M)', 'MON-M-001', '4001001001001', 450.00, 280.00, 40),
    ('Men''s Wear', 'Men''s Cotton T-Shirt Black (L)', 'MON-M-002', '4001001001002', 450.00, 280.00, 35),
    ('Men''s Wear', 'Men''s Polo Shirt Navy (XL)', 'MON-M-003', '4001001001003', 850.00, 520.00, 30),
    ('Men''s Wear', 'Men''s Formal Shirt White (15.5)', 'MON-M-004', '4001001001004', 1200.00, 750.00, 25),
    ('Men''s Wear', 'Men''s Chino Pants Khaki (32)', 'MON-M-005', '4001001001005', 1450.00, 900.00, 22),
    ('Men''s Wear', 'Men''s Denim Jeans Blue (34)', 'MON-M-006', '4001001001006', 1650.00, 1020.00, 28),
    ('Men''s Wear', 'Men''s Suit Jacket Charcoal (42)', 'MON-M-007', '4001001001007', 3200.00, 2100.00, 12),
    ('Men''s Wear', 'Men''s Wool Blazer Navy (40)', 'MON-M-008', '4001001001008', 2800.00, 1850.00, 10),
    ('Men''s Wear', 'Men''s Track Suit Grey (L)', 'MON-M-009', '4001001001009', 1950.00, 1250.00, 18),
    ('Men''s Wear', 'Men''s Cotton Socks 3-Pack', 'MON-M-010', '4001001001010', 280.00, 160.00, 60),
    -- Women's Wear (12)
    ('Women''s Wear', 'Women''s Blouse Floral (S)', 'MON-W-011', '4001001001011', 980.00, 620.00, 30),
    ('Women''s Wear', 'Women''s Blouse White (M)', 'MON-W-012', '4001001001012', 920.00, 580.00, 32),
    ('Women''s Wear', 'Women''s Maxi Dress Blue (M)', 'MON-W-013', '4001001001013', 1850.00, 1150.00, 20),
    ('Women''s Wear', 'Women''s Casual Dress Red (L)', 'MON-W-014', '4001001001014', 1650.00, 1050.00, 18),
    ('Women''s Wear', 'Women''s Skinny Jeans Black (28)', 'MON-W-015', '4001001001015', 1580.00, 980.00, 24),
    ('Women''s Wear', 'Women''s Palazzo Pants Beige (M)', 'MON-W-016', '4001001001016', 1320.00, 820.00, 22),
    ('Women''s Wear', 'Women''s Cardigan Grey (S)', 'MON-W-017', '4001001001017', 1450.00, 900.00, 16),
    ('Women''s Wear', 'Women''s Leather Jacket Brown (M)', 'MON-W-018', '4001001001018', 4200.00, 2750.00, 8),
    ('Women''s Wear', 'Women''s Office Skirt Black (M)', 'MON-W-019', '4001001001019', 1100.00, 680.00, 26),
    ('Women''s Wear', 'Women''s Abaya Black (Standard)', 'MON-W-020', '4001001001020', 2400.00, 1550.00, 15),
    ('Women''s Wear', 'Women''s Hijab Scarf Chiffon Ivory', 'MON-W-021', '4001001001021', 650.00, 380.00, 45),
    ('Women''s Wear', 'Women''s Leggings Black (M)', 'MON-W-022', '4001001001022', 580.00, 350.00, 40),
    -- Kids Wear (8)
    ('Kids Wear', 'Kids School Shirt White (10Y)', 'MON-K-023', '4001001001023', 520.00, 320.00, 35),
    ('Kids Wear', 'Kids School Skirt Navy (12Y)', 'MON-K-024', '4001001001024', 480.00, 300.00, 30),
    ('Kids Wear', 'Kids T-Shirt Cartoon (6Y)', 'MON-K-025', '4001001001025', 380.00, 230.00, 40),
    ('Kids Wear', 'Kids Jeans Blue (8Y)', 'MON-K-026', '4001001001026', 720.00, 450.00, 28),
    ('Kids Wear', 'Kids Party Dress Pink (5Y)', 'MON-K-027', '4001001001027', 890.00, 560.00, 22),
    ('Kids Wear', 'Kids Hoodie Grey (14Y)', 'MON-K-028', '4001001001028', 950.00, 600.00, 20),
    ('Kids Wear', 'Kids Shorts Khaki (7Y)', 'MON-K-029', '4001001001029', 420.00, 260.00, 32),
    ('Kids Wear', 'Kids Socks 5-Pack', 'MON-K-030', '4001001001030', 320.00, 190.00, 50),
    -- Fabrics & Yardage (10)
    ('Fabrics & Yardage', 'Cotton Poplin Fabric 1m White', 'MON-F-031', '4001001001031', 280.00, 170.00, 100),
    ('Fabrics & Yardage', 'Cotton Poplin Fabric 1m Navy', 'MON-F-032', '4001001001032', 280.00, 170.00, 90),
    ('Fabrics & Yardage', 'Linen Blend Fabric 1m Natural', 'MON-F-033', '4001001001033', 420.00, 260.00, 75),
    ('Fabrics & Yardage', 'Polyester Satin 1m Burgundy', 'MON-F-034', '4001001001034', 350.00, 210.00, 80),
    ('Fabrics & Yardage', 'Denim Fabric 1m Indigo', 'MON-F-035', '4001001001035', 380.00, 240.00, 70),
    ('Fabrics & Yardage', 'Wax Print Fabric 6 Yards', 'MON-F-036', '4001001001036', 1800.00, 1150.00, 25),
    ('Fabrics & Yardage', 'Net Lace Fabric 1m White', 'MON-F-037', '4001001001037', 320.00, 195.00, 60),
    ('Fabrics & Yardage', 'Fleece Fabric 1m Grey', 'MON-F-038', '4001001001038', 340.00, 205.00, 55),
    ('Fabrics & Yardage', 'Toweling Fabric 1m White', 'MON-F-039', '4001001001039', 290.00, 175.00, 65),
    ('Fabrics & Yardage', 'Wool Suiting Blend 1m Charcoal', 'MON-F-040', '4001001001040', 680.00, 420.00, 40),
    -- Home Textiles (8)
    ('Home Textiles', 'Bed Sheet Set Queen White', 'MON-H-041', '4001001001041', 2200.00, 1400.00, 18),
    ('Home Textiles', 'Bed Sheet Set Queen Blue', 'MON-H-042', '4001001001042', 2200.00, 1400.00, 16),
    ('Home Textiles', 'Duvet Cover Double Grey', 'MON-H-043', '4001001001043', 1850.00, 1180.00, 14),
    ('Home Textiles', 'Bath Towel Large White', 'MON-H-044', '4001001001044', 650.00, 390.00, 45),
    ('Home Textiles', 'Bath Towel Large Navy', 'MON-H-045', '4001001001045', 650.00, 390.00, 42),
    ('Home Textiles', 'Kitchen Tea Towel Set (4)', 'MON-H-046', '4001001001046', 480.00, 290.00, 35),
    ('Home Textiles', 'Curtain Pair 2m Beige', 'MON-H-047', '4001001001047', 3200.00, 2050.00, 10),
    ('Home Textiles', 'Cushion Cover 45x45 Red', 'MON-H-048', '4001001001048', 380.00, 230.00, 30),
    -- Accessories (7)
    ('Accessories', 'Leather Belt Brown (34)', 'MON-A-049', '4001001001049', 720.00, 440.00, 25),
    ('Accessories', 'Leather Belt Black (36)', 'MON-A-050', '4001001001050', 720.00, 440.00, 25),
    ('Accessories', 'Silk Tie Navy', 'MON-A-051', '4001001001051', 580.00, 350.00, 30),
    ('Accessories', 'Bow Tie Black', 'MON-A-052', '4001001001052', 420.00, 250.00, 28),
    ('Accessories', 'Wool Scarf Multicolor', 'MON-A-053', '4001001001053', 850.00, 520.00, 22),
    ('Accessories', 'Baseball Cap Cotton Black', 'MON-A-054', '4001001001054', 480.00, 290.00, 35),
    ('Accessories', 'Canvas Shopping Tote Bag', 'MON-A-055', '4001001001055', 350.00, 210.00, 40);

  FOR v_rec IN SELECT * FROM _mona_seed ORDER BY sku LOOP
    IF v_cats ? v_rec.category THEN
      v_cat_id := (v_cats ->> v_rec.category)::UUID;
    ELSE
      v_cat_sort := v_cat_sort + 1;
      INSERT INTO categories (organization_id, name, sort_order)
      VALUES (v_org_id, v_rec.category, v_cat_sort)
      RETURNING id INTO v_cat_id;
      v_cats := v_cats || jsonb_build_object(v_rec.category, v_cat_id::TEXT);
    END IF;

    IF EXISTS (
      SELECT 1 FROM products
      WHERE organization_id = v_org_id AND sku = v_rec.sku
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO products (
      organization_id, category_id, name, sku, barcode, sell_price, cost_price, is_active
    )
    VALUES (
      v_org_id, v_cat_id, v_rec.name, v_rec.sku, v_rec.barcode,
      v_rec.sell_price, v_rec.cost_price, true
    )
    RETURNING id INTO v_product_id;

    INSERT INTO product_variants (
      product_id, organization_id, name, sku, barcode, sell_price, cost_price, is_active
    )
    VALUES (
      v_product_id, v_org_id, 'Default', v_rec.sku, v_rec.barcode,
      v_rec.sell_price, v_rec.cost_price, true
    )
    RETURNING id INTO v_variant_id;

    INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
    VALUES (v_store_id, v_variant_id, v_org_id, v_rec.quantity)
    ON CONFLICT (store_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity;
  END LOOP;

  RAISE NOTICE 'Seeded textile products for organization % (store %)', v_org_id, v_store_id;
END $$;

-- Verify
SELECT c.name AS category, COUNT(*) AS products
FROM products p
JOIN categories c ON c.id = p.category_id
JOIN organizations o ON o.id = p.organization_id
WHERE o.name ILIKE '%Mona%' AND p.sku LIKE 'MON-%'
GROUP BY c.name, c.sort_order
ORDER BY c.sort_order;

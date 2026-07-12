-- EFM Wave 11 — Fixed assets multi-book schema

-- ---------------------------------------------------------------------------
-- Depreciation books (financial, tax, IFRS, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fa_depr_books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  book_type TEXT NOT NULL DEFAULT 'financial'
    CHECK (book_type IN ('financial', 'tax', 'ifrs', 'management')),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  posts_to_gl BOOLEAN NOT NULL DEFAULT true,
  depr_method TEXT NOT NULL DEFAULT 'straight_line'
    CHECK (depr_method IN ('straight_line', 'double_declining')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_fa_depr_books_org ON fa_depr_books(organization_id);

ALTER TABLE fa_depr_books ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fa_depr_books_select ON fa_depr_books;
CREATE POLICY fa_depr_books_select ON fa_depr_books FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS fa_depr_books_write ON fa_depr_books;
CREATE POLICY fa_depr_books_write ON fa_depr_books FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Per-asset book profiles (cost, life, method can differ by book)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fixed_asset_book_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES fa_depr_books(id) ON DELETE CASCADE,
  acquisition_cost NUMERIC(14,2) NOT NULL CHECK (acquisition_cost > 0),
  salvage_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  useful_life_months INT NOT NULL CHECK (useful_life_months > 0),
  depr_method TEXT NOT NULL DEFAULT 'straight_line'
    CHECK (depr_method IN ('straight_line', 'double_declining')),
  status fixed_asset_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, book_id)
);
CREATE INDEX IF NOT EXISTS idx_fa_book_profiles_asset ON fixed_asset_book_profiles(asset_id);
CREATE INDEX IF NOT EXISTS idx_fa_book_profiles_book ON fixed_asset_book_profiles(book_id);

ALTER TABLE fixed_asset_book_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fa_book_profiles_select ON fixed_asset_book_profiles;
CREATE POLICY fa_book_profiles_select ON fixed_asset_book_profiles FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
DROP POLICY IF EXISTS fa_book_profiles_write ON fixed_asset_book_profiles;
CREATE POLICY fa_book_profiles_write ON fixed_asset_book_profiles FOR ALL
  USING (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()) AND public.user_can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- Tag depreciation rows by book
-- ---------------------------------------------------------------------------
ALTER TABLE public.fixed_asset_depreciation
  ADD COLUMN IF NOT EXISTS book_id UUID REFERENCES fa_depr_books(id);

-- Seed default books per organization
INSERT INTO fa_depr_books (organization_id, code, name, book_type, is_primary, posts_to_gl, depr_method)
SELECT o.id, 'FIN', 'Financial (GAAP)', 'financial', true, true, 'straight_line'
FROM organizations o
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO fa_depr_books (organization_id, code, name, book_type, is_primary, posts_to_gl, depr_method)
SELECT o.id, 'TAX', 'Tax', 'tax', false, false, 'straight_line'
FROM organizations o
ON CONFLICT (organization_id, code) DO NOTHING;

-- Backfill book profiles for existing assets
INSERT INTO fixed_asset_book_profiles (
  organization_id, asset_id, book_id, acquisition_cost, salvage_value,
  useful_life_months, depr_method, status
)
SELECT
  fa.organization_id,
  fa.id,
  b.id,
  fa.acquisition_cost,
  fa.salvage_value,
  fa.useful_life_months,
  b.depr_method,
  fa.status
FROM fixed_assets fa
JOIN fa_depr_books b ON b.organization_id = fa.organization_id AND b.code = 'FIN'
ON CONFLICT (asset_id, book_id) DO NOTHING;

INSERT INTO fixed_asset_book_profiles (
  organization_id, asset_id, book_id, acquisition_cost, salvage_value,
  useful_life_months, depr_method, status
)
SELECT
  fa.organization_id,
  fa.id,
  b.id,
  fa.acquisition_cost,
  fa.salvage_value,
  GREATEST(ceil(fa.useful_life_months * 0.6)::INT, 12),
  b.depr_method,
  fa.status
FROM fixed_assets fa
JOIN fa_depr_books b ON b.organization_id = fa.organization_id AND b.code = 'TAX'
ON CONFLICT (asset_id, book_id) DO NOTHING;

-- Assign existing depreciation rows to financial book
UPDATE fixed_asset_depreciation fad
SET book_id = b.id
FROM fa_depr_books b
WHERE b.organization_id = fad.organization_id
  AND b.code = 'FIN'
  AND fad.book_id IS NULL;

ALTER TABLE fixed_asset_depreciation
  ALTER COLUMN book_id SET NOT NULL;

ALTER TABLE fixed_asset_depreciation
  DROP CONSTRAINT IF EXISTS fixed_asset_depreciation_asset_id_period_date_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_asset_depreciation_asset_book_period_key'
  ) THEN
    ALTER TABLE fixed_asset_depreciation
      ADD CONSTRAINT fixed_asset_depreciation_asset_book_period_key
      UNIQUE (asset_id, book_id, period_date);
  END IF;
END $$;

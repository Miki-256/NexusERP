-- Org UI language preference (en | am)

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_locale TEXT NOT NULL DEFAULT 'en';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_default_locale_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_default_locale_check
      CHECK (default_locale IN ('en', 'am'));
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.default_locale IS
  'Tenant UI language: en (English) or am (Amharic).';

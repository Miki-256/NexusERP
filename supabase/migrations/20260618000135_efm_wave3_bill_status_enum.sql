-- EFM Wave 3 — bill_status enum extension (must commit before use in 00136+)

DO $$ BEGIN
  ALTER TYPE bill_status ADD VALUE 'partially_paid';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE bill_status ADD VALUE 'draft';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

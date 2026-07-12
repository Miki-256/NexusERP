-- EFM Wave 2 — invoice_status enum extension (must commit before use in 00133+)

DO $$ BEGIN
  ALTER TYPE invoice_status ADD VALUE 'partially_paid';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

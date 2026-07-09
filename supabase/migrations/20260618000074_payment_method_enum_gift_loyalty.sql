-- Gift card + loyalty payment methods (must commit before 00075 uses them in functions).

DO $$ BEGIN
  ALTER TYPE payment_method ADD VALUE 'gift_card';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE payment_method ADD VALUE 'loyalty';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

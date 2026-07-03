-- Defense in depth: only owners/managers may change pay-later credit terms on customers.

CREATE OR REPLACE FUNCTION public.guard_customer_credit_terms()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (
      NEW.on_account_enabled IS TRUE
      OR NEW.credit_limit IS NOT NULL
    ) AND NOT public.user_can_manage(NEW.organization_id) THEN
      RAISE EXCEPTION 'Access denied: manager approval required for pay-later terms';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (
      OLD.on_account_enabled IS DISTINCT FROM NEW.on_account_enabled
      OR OLD.credit_limit IS DISTINCT FROM NEW.credit_limit
    ) AND NOT public.user_can_manage(NEW.organization_id) THEN
      RAISE EXCEPTION 'Access denied: manager approval required for pay-later terms';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_customer_credit_terms ON public.customers;
CREATE TRIGGER trg_guard_customer_credit_terms
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_customer_credit_terms();

-- Phase B: org-scoped indexes for multi-tenant query performance (RLS hot paths)

CREATE INDEX IF NOT EXISTS idx_vendor_bill_lines_org_bill
  ON public.vendor_bill_lines(organization_id, bill_id);

CREATE INDEX IF NOT EXISTS idx_customer_credit_note_lines_org_note
  ON public.customer_credit_note_lines(organization_id, credit_note_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_org_worker
  ON public.notification_deliveries(organization_id, status, next_attempt_at)
  WHERE status IN ('pending', 'failed', 'processing');

CREATE INDEX IF NOT EXISTS idx_notification_events_org_created
  ON public.notification_events(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_je_audit_org_created
  ON public.journal_entry_audit_log(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gift_card_tx_org_created
  ON public.gift_card_transactions(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_approval_steps_org_entity
  ON public.financial_approval_steps(organization_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_vendor_bill_payments_org_bill
  ON public.vendor_bill_payments(organization_id, bill_id, payment_date DESC);

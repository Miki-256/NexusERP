-- Phase C (quality): sales register query indexes for list_sales_register filters.

CREATE INDEX IF NOT EXISTS idx_sales_org_register_created
  ON sales(organization_id, register_id, created_at DESC)
  WHERE register_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_org_staff_created
  ON sales(organization_id, pos_staff_id, created_at DESC)
  WHERE pos_staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_org_customer_phone
  ON sales(organization_id, customer_phone)
  WHERE customer_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_sale_method
  ON payments(sale_id, method);

CREATE INDEX IF NOT EXISTS idx_payments_sale_status
  ON payments(sale_id, status);

CREATE INDEX IF NOT EXISTS idx_sales_org_status_created
  ON sales(organization_id, status, created_at DESC);

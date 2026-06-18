export type MemberRole = "owner" | "manager" | "cashier";

export type SaleStatus = "completed" | "voided" | "returned";

export type PaymentMethod = "cash" | "mobile_money" | "bank_transfer";

export type PaymentStatus = "completed" | "pending";

export type MobileMoneyProvider =
  | "mpesa"
  | "telebirr"
  | "cbe_birr"
  | "m_pesa"
  | "other";

export interface Organization {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  tax_rate: number;
  tax_inclusive: boolean;
  receipt_prefix: string;
  receipt_footer: string | null;
  address: string | null;
  tax_id: string | null;
  logo_url: string | null;
  created_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  store_ids: string[] | null;
  is_active: boolean;
  created_at: string;
}

export interface Store {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Register {
  id: string;
  store_id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface RegisterSession {
  id: string;
  register_id: string;
  organization_id: string;
  opened_by: string;
  opened_at: string;
  opening_float: number;
  closed_at: string | null;
  closed_by: string | null;
  closing_cash_counted: number | null;
  notes: string | null;
}

export interface Category {
  id: string;
  organization_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Product {
  id: string;
  organization_id: string;
  category_id: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  sell_price: number;
  cost_price: number;
  tax_rate: number | null;
  is_active: boolean;
  created_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  organization_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  sell_price: number | null;
  cost_price: number | null;
  is_active: boolean;
}

export interface InventoryLevel {
  id: string;
  store_id: string;
  variant_id: string;
  organization_id: string;
  quantity: number;
}

export interface Sale {
  id: string;
  organization_id: string;
  store_id: string;
  register_id: string;
  session_id: string | null;
  receipt_no: string;
  status: SaleStatus;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  customer_name: string | null;
  customer_phone: string | null;
  idempotency_key: string | null;
  created_by: string;
  created_at: string;
}

export interface SaleLine {
  id: string;
  sale_id: string;
  variant_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  tax_amount: number;
  discount_amount: number;
  line_total: number;
}

export interface Payment {
  id: string;
  sale_id: string;
  organization_id: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  reference: string | null;
  provider: MobileMoneyProvider | null;
  phone: string | null;
  bank_name: string | null;
  cash_tendered: number | null;
  change_given: number | null;
}

export interface AuditLog {
  id: string;
  organization_id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
}

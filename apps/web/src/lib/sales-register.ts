export type SalesRegisterPayment = {
  method: string;
  amount: number;
  status: string;
};

export type SalesRegisterRow = {
  id: string;
  receipt_no: string;
  total: number;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  tip_amount: number;
  status: string;
  created_at: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  store_id: string | null;
  store_name: string | null;
  register_id: string | null;
  register_name: string | null;
  staff_name: string | null;
  promotion_id: string | null;
  has_pending_payment: boolean;
  payments: SalesRegisterPayment[];
};

export type SalesRegisterSummary = {
  count: number;
  gross: number;
  tax: number;
  discounts: number;
  tips: number;
  voided: number;
  returned: number;
};

export type SalesRegisterListResult = {
  rows: SalesRegisterRow[];
  total: number;
  summary: SalesRegisterSummary;
};

export type SalesAlert = {
  type: string;
  severity: string;
  message: string;
  count: number;
};

export type SalesAnalytics = {
  daily_trend: { date: string; revenue: number; count: number }[];
  hourly: { hour: number; revenue: number; count: number }[];
  by_store: { name: string; value: number }[];
  top_products: { name: string; quantity: number; revenue: number }[];
  top_staff: { name: string; revenue: number; count: number }[];
  kpis: {
    discount_rate_pct: number;
    void_rate_pct: number;
    avg_ticket: number;
  };
  alerts: SalesAlert[];
};

export type SaleDetailLine = {
  id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  returned_quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  line_total: number;
  variant_id: string;
};

export type SaleDetailPayment = {
  id: string;
  method: string;
  amount: number;
  status: string;
  reference: string | null;
  provider: string | null;
  phone: string | null;
  bank_name: string | null;
  cash_tendered: number | null;
  change_given: number | null;
  created_at: string;
};

export type SaleReturnRecord = {
  id: string;
  total: number;
  refund_method: string;
  reason: string;
  created_at: string;
  staff_name: string | null;
  lines: { quantity: number; line_total: number; sale_line_id: string }[];
};

export type SaleAuditEntry = {
  id: string;
  action: string;
  created_at: string;
  user_id: string | null;
  payload: Record<string, unknown>;
};

export type SaleDetailBundle = {
  sale: Record<string, unknown> & {
    receipt_no: string;
    total: number;
    subtotal: number;
    tax_amount: number;
    discount_amount: number;
    tip_amount?: number;
    status: string;
    created_at: string;
    customer_name: string | null;
    customer_phone: string | null;
    customer_id: string | null;
    void_reason: string | null;
    store_name: string | null;
    register_name: string | null;
    staff_name: string | null;
    promotion_name: string | null;
    promotion_code: string | null;
  };
  lines: SaleDetailLine[];
  payments: SaleDetailPayment[];
  returns: SaleReturnRecord[];
  audit: SaleAuditEntry[];
};

export type RefundRegisterItem = {
  id?: string;
  return_id?: string;
  sale_id?: string;
  receipt_no: string;
  total: number;
  status?: string;
  void_reason?: string | null;
  reason?: string;
  refund_method?: string;
  created_at: string;
  store_name: string | null;
  kind: "full_void" | "partial_return";
  sale_status?: string;
};

export const PAYMENT_METHODS = [
  { value: "all", label: "All methods" },
  { value: "cash", label: "Cash" },
  { value: "mobile_money", label: "Mobile money" },
  { value: "bank", label: "Bank" },
  { value: "store_credit", label: "Store credit" },
  { value: "on_account", label: "Pay later" },
] as const;

export const SALES_VIEW_PRESETS = [
  { key: "pending", label: "Pending payments", paymentStatus: "pending", status: "completed" },
  { key: "voided", label: "Voided", status: "voided" },
] as const;

export function paymentMixLabel(payments: SalesRegisterPayment[]): string {
  if (!payments.length) return "—";
  const parts = payments.map((p) => {
    const label = p.method.replace(/_/g, " ");
    return `${label} ${p.status === "pending" ? "(pending)" : ""}`.trim();
  });
  return parts.join(", ");
}

export function discountPct(row: Pick<SalesRegisterRow, "subtotal" | "discount_amount">): number {
  const gross = Number(row.subtotal) + Number(row.discount_amount);
  if (gross <= 0) return 0;
  return Math.round((Number(row.discount_amount) / gross) * 1000) / 10;
}

export function buildSalesSearchParams(
  base: URLSearchParams,
  updates: Record<string, string | undefined>
): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
  }
  if (updates.page === undefined && Object.keys(updates).some((k) => k !== "page")) {
    next.delete("page");
  }
  return next;
}

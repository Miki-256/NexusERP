import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { PurchasingClient } from "./purchasing-client";
import type { OpenBillOption, PaymentRunRow } from "@/components/finance/ap-payment-runs-tab";

export type VendorRow = { id: string; name: string; phone: string | null; email: string | null; is_active: boolean };
export type POLineRow = {
  id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  uom_code: string | null;
  qty_received: number | null;
  qty_base: number | null;
};

export type PORow = {
  id: string;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  order_date: string;
  total: number;
  vendors: { name: string } | { name: string }[] | null;
  stores: { name: string } | { name: string }[] | null;
  purchase_order_lines?: POLineRow[] | null;
};
export type BillRow = {
  id: string;
  bill_no?: string | null;
  bill_date: string;
  due_date?: string | null;
  amount: number;
  amount_paid?: number;
  balance_due?: number;
  status: "open" | "paid" | "partially_paid" | "draft";
  match_status?: string;
  po_id?: string | null;
  vendors: { name: string } | { name: string }[] | null;
};
export type VariantOption = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  cost_price: number | null;
  product_id: string;
  products: { name: string } | { name: string }[] | null;
};

export type ProductUomOption = {
  product_id: string;
  uom_code: string;
  uom_name: string;
  conversion_factor: number;
  is_base: boolean;
  is_purchase: boolean;
  is_sale: boolean;
};

export default async function PurchasingPage() {
  const ctx = await requireAppAccess("purchasing");

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [
    { data: vendors },
    { data: stores },
    { data: pos },
    { data: bills },
    { data: openBillsData },
    { data: paymentRuns },
  ] = await Promise.all([
      supabase.from("vendors").select("id, name, phone, email, is_active").eq("organization_id", orgId).order("name"),
      supabase.from("stores").select("id, name").eq("organization_id", orgId).order("name"),
      supabase
        .from("purchase_orders")
        .select(
          "id, status, order_date, total, vendors(name), stores(name), purchase_order_lines(id, product_name, quantity, unit_cost, line_total, uom_code, qty_received, qty_base)"
        )
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("vendor_bills")
        .select("id, bill_no, bill_date, due_date, amount, amount_paid, status, match_status, po_id, vendors(name)")
        .eq("organization_id", orgId)
        .order("bill_date", { ascending: false })
        .limit(100),
      supabase.rpc("list_vendor_open_bills", { p_org_id: orgId, p_limit: 100, p_offset: 0 }),
      supabase.rpc("list_payment_runs", { p_org_id: orgId }),
    ]);

  const openBillsEnvelope = openBillsData as { bills?: OpenBillOption[] } | null;
  const openBills = openBillsEnvelope?.bills ?? [];

  return (
    <PurchasingClient
      organizationId={orgId}
      currency={ctx.organization.currency}
      canManage={ctx.canManageApp("purchasing")}
      vendors={(vendors as VendorRow[]) ?? []}
      stores={(stores as { id: string; name: string }[]) ?? []}
      purchaseOrders={(pos as unknown as PORow[]) ?? []}
      bills={((bills as unknown as BillRow[]) ?? []).map((b) => ({
        ...b,
        balance_due: Math.max(Number(b.amount) - Number(b.amount_paid ?? 0), 0),
      }))}
      variants={[]}
      productUoms={[]}
      openBills={openBills}
      paymentRuns={(paymentRuns as PaymentRunRow[]) ?? []}
    />
  );
}

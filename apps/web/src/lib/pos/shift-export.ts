import { exportCsv } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";

type ShiftExportRow = {
  receiptNo: string;
  createdAt: string;
  status: string;
  customerName: string | null;
  productName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  saleTotal: number;
  paymentMethods: string | null;
};

export async function downloadShiftCsv(
  sessionId: string,
  sessionToken: string | null | undefined,
  filenamePrefix: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_pos_shift_export", {
    p_session_id: sessionId,
    p_session_token: sessionToken ?? null,
  });
  if (error) throw new Error(error.message);

  const payload = data as {
    registerName: string;
    storeName: string;
    openedAt: string;
    rows: ShiftExportRow[];
  };

  const rows = (payload.rows ?? []).map((row) => ({
    receiptNo: row.receiptNo,
    createdAt: new Date(row.createdAt).toLocaleString(),
    status: row.status,
    customerName: row.customerName ?? "",
    productName: row.productName,
    variantName: row.variantName ?? "",
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    lineTotal: row.lineTotal,
    saleTotal: row.saleTotal,
    paymentMethods: row.paymentMethods ?? "",
  }));

  const stamp = new Date(payload.openedAt).toISOString().slice(0, 10);
  exportCsv(`${filenamePrefix}-shift-${stamp}`, rows, [
    { key: "receiptNo", label: "Receipt" },
    { key: "createdAt", label: "Date" },
    { key: "status", label: "Status" },
    { key: "customerName", label: "Customer" },
    { key: "productName", label: "Product" },
    { key: "variantName", label: "Variant" },
    { key: "quantity", label: "Qty" },
    { key: "unitPrice", label: "Unit price" },
    { key: "lineTotal", label: "Line total" },
    { key: "saleTotal", label: "Sale total" },
    { key: "paymentMethods", label: "Payments" },
  ]);
}

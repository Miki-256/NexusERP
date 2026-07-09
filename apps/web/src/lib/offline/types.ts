import type { CartLine } from "@/stores/cart-store";

export type RpcPayment = {
  method: "cash" | "mobile_money" | "bank_transfer" | "store_credit" | "on_account" | "gift_card" | "loyalty";
  amount: number;
  cashTendered?: number;
  changeGiven?: number;
  provider?: string;
  reference?: string;
  phone?: string;
  bankName?: string;
};

export type RpcLine = {
  variantId: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
};

export type CompleteSalePayload = {
  organizationId: string;
  storeId: string;
  registerId: string;
  sessionId: string;
  idempotencyKey: string;
  lines: RpcLine[];
  discountAmount: number;
  tipAmount?: number;
  promotionCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerId: string | null;
  payments: RpcPayment[];
  posStaffId: string | null;
  posSessionToken: string | null;
  managerDiscountPin?: string | null;
};

export type QueuedSale = {
  id: string;
  createdAt: string;
  status: "pending" | "syncing" | "failed";
  retries: number;
  lastError?: string;
  localReceiptNo: string;
  localSaleId: string;
  payload: CompleteSalePayload;
};

export type PosCatalogCache = {
  registerId: string;
  catalog: unknown[];
  cachedAt: string;
};

export type PosContextCache = {
  registerId: string;
  context: unknown;
  cachedAt: string;
};

export type PosSessionCache = {
  registerId: string;
  session: {
    id: string;
    opening_float: number;
    opened_at: string;
  };
  cachedAt: string;
};

export function cartLinesToRpc(lines: CartLine[]): RpcLine[] {
  return lines.map((l) => ({
    variantId: l.variantId,
    productName: l.productName,
    variantName: l.variantName ?? "",
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountAmount: l.discountAmount,
  }));
}

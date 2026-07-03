export type CustomerDisplayPhase =
  | "cart"
  | "checkout"
  | "paying"
  | "paid"
  | "pending_payment";

export type CustomerDisplayPayload = {
  registerId: string;
  orgName: string;
  storeName: string;
  currency: string;
  phase: CustomerDisplayPhase;
  lines: { name: string; qty: number; total: number }[];
  subtotal: number;
  tax: number;
  /** Order + line discounts (excludes promo) */
  discount: number;
  promoDiscount: number;
  tipAmount?: number;
  total: number;
  changeDue?: number;
  receiptNo?: string;
  paymentStatus?: "confirmed" | "pending";
  saleId?: string;
  sessionToken?: string | null;
  updatedAt: number;
};

export function customerDisplayChannel(registerId: string): string {
  return `nexus-pos-display-${registerId}`;
}

export function publishCustomerDisplay(payload: CustomerDisplayPayload): void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
  try {
    const ch = new BroadcastChannel(customerDisplayChannel(payload.registerId));
    ch.postMessage(payload);
    ch.close();
  } catch {
    /* ignore */
  }
}

export function openCustomerDisplayWindow(registerId: string): Window | null {
  const url = `/pos/customer-display?register=${encodeURIComponent(registerId)}`;
  return window.open(
    url,
    `nexus-customer-display-${registerId}`,
    "noopener,noreferrer,width=480,height=720,menubar=no,toolbar=no"
  );
}

export function totalChangeFromPayments(
  payments: { change_given?: number | null; changeGiven?: number | null }[]
): number {
  return payments.reduce(
    (sum, p) => sum + (p.change_given ?? p.changeGiven ?? 0),
    0
  );
}

import type { CartLine } from "@/stores/cart-store";
import {
  cartLinesToRpc,
  type CompleteSalePayload,
} from "@/lib/offline/types";
import { isBrowserOnline } from "@/lib/offline/network";
import { queueOfflineSale, submitCompleteSale } from "@/lib/offline/sale-api";
import { parsePlanLimitError, planLimitToastDescription } from "@/lib/plan-errors";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export type FastCheckoutInput = {
  organizationId: string;
  storeId: string;
  registerId: string;
  sessionId: string;
  lines: CartLine[];
  cartDiscount: number;
  promoCode?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerId?: string | null;
  total: number;
  posStaffId?: string | null;
  posSessionToken?: string | null;
  managerDiscountPin?: string | null;
};

export type FastCheckoutResult = {
  receipt_no: string;
  total: number;
  sale_id: string;
  tipAmount: number;
  changeDue: number;
  pendingSync?: boolean;
  offlinePayments?: {
    method: string;
    amount: number;
    reference: string | null;
    cash_tendered: number | null;
    change_given: number | null;
  }[];
};

/**
 * Complete a sale as exact cash (no change, no tip) — used by POS "fastest" checkout mode.
 */
export async function completeExactCashSale(
  input: FastCheckoutInput
): Promise<{ ok: true; data: FastCheckoutResult } | { ok: false; message: string }> {
  const amount = roundMoney(input.total);
  if (!(amount > 0) || input.lines.length === 0) {
    return { ok: false, message: "Cart is empty" };
  }

  const payments = [
    {
      method: "cash" as const,
      amount,
      cashTendered: amount,
      changeGiven: 0,
    },
  ];

  const payload: CompleteSalePayload = {
    organizationId: input.organizationId,
    storeId: input.storeId,
    registerId: input.registerId,
    sessionId: input.sessionId,
    idempotencyKey: crypto.randomUUID(),
    lines: cartLinesToRpc(input.lines),
    discountAmount: input.cartDiscount,
    tipAmount: 0,
    promotionCode: input.promoCode ?? null,
    customerName: input.customerName || null,
    customerPhone: input.customerPhone || null,
    customerId: input.customerId ?? null,
    payments,
    posStaffId: input.posStaffId ?? null,
    posSessionToken: input.posSessionToken ?? null,
    managerDiscountPin: input.managerDiscountPin ?? null,
  };

  const offlinePayments = [
    {
      method: "cash",
      amount,
      reference: null,
      cash_tendered: amount,
      change_given: 0,
    },
  ];

  async function finishOffline(): Promise<FastCheckoutResult> {
    const result = await queueOfflineSale(payload, amount);
    return {
      sale_id: result.sale_id,
      receipt_no: result.receipt_no,
      total: result.total,
      tipAmount: 0,
      changeDue: 0,
      pendingSync: true,
      offlinePayments,
    };
  }

  try {
    if (!isBrowserOnline()) {
      return { ok: true, data: await finishOffline() };
    }

    const outcome = await submitCompleteSale(payload);
    if (outcome.ok) {
      return {
        ok: true,
        data: {
          sale_id: outcome.data.sale_id,
          receipt_no: outcome.data.receipt_no,
          total: outcome.data.total,
          tipAmount: 0,
          changeDue: 0,
        },
      };
    }

    if (outcome.network || !isBrowserOnline()) {
      return { ok: true, data: await finishOffline() };
    }

    return {
      ok: false,
      message: planLimitToastDescription(parsePlanLimitError({ message: outcome.message })),
    };
  } catch {
    try {
      return { ok: true, data: await finishOffline() };
    } catch {
      return { ok: false, message: "Could not complete sale" };
    }
  }
}

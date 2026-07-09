import { createClient } from "@/lib/supabase/client";
import { enqueueSale } from "./queue";
import { notifyOfflineChange } from "./events";
import { isBrowserOnline, isNetworkError, withTimeout } from "./network";
import { triggerNotificationProcess } from "@/lib/notifications/trigger-process";
import type { CompleteSalePayload } from "./types";

export type CompleteSaleResult = {
  sale_id: string;
  receipt_no: string;
  total: number;
  duplicate?: boolean;
};

export type OfflineSaleResult = CompleteSaleResult & { pendingSync: true };

export type SubmitSaleOutcome =
  | { ok: true; data: CompleteSaleResult }
  | { ok: false; network: boolean; message: string; stockConflict?: boolean };

const RPC_TIMEOUT_MS = 6_000;

function payloadToRpcArgs(payload: CompleteSalePayload) {
  return {
    p_organization_id: payload.organizationId,
    p_store_id: payload.storeId,
    p_register_id: payload.registerId,
    p_session_id: payload.sessionId,
    p_idempotency_key: payload.idempotencyKey,
    p_lines: payload.lines,
    p_discount_amount: payload.discountAmount,
    p_customer_name: payload.customerName,
    p_customer_phone: payload.customerPhone,
    p_payments: payload.payments,
    p_pos_staff_id: payload.posStaffId,
    p_pos_session_token: payload.posSessionToken,
    p_customer_id: payload.customerId,
    p_promotion_code: payload.promotionCode,
    p_tip_amount: payload.tipAmount ?? 0,
    p_manager_discount_pin: payload.managerDiscountPin ?? null,
  };
}

async function enrichSaleResult(data: {
  sale_id: string;
  receipt_no?: string;
  total?: number;
  duplicate?: boolean;
}): Promise<CompleteSaleResult> {
  if (data.receipt_no && data.total != null) {
    return {
      sale_id: data.sale_id,
      receipt_no: data.receipt_no,
      total: data.total,
      duplicate: data.duplicate,
    };
  }

  const supabase = createClient();
  const { data: sale } = await supabase
    .from("sales")
    .select("receipt_no, total")
    .eq("id", data.sale_id)
    .maybeSingle();

  return {
    sale_id: data.sale_id,
    receipt_no: sale?.receipt_no ?? data.sale_id.slice(0, 8).toUpperCase(),
    total: Number(sale?.total ?? 0),
    duplicate: data.duplicate,
  };
}

export function isStockConflictMessage(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("insufficient") || m.includes("stock") || m.includes("inventory");
}

export function makeLocalReceiptNo(): string {
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  return `OFF-${suffix}`;
}

/** Save sale locally and return receipt details — syncs when back online. */
export async function queueOfflineSale(
  payload: CompleteSalePayload,
  total: number
): Promise<OfflineSaleResult> {
  const localReceiptNo = makeLocalReceiptNo();
  const localSaleId = crypto.randomUUID();
  await enqueueSale(payload, localReceiptNo, localSaleId);
  notifyOfflineChange();
  return {
    sale_id: localSaleId,
    receipt_no: localReceiptNo,
    total,
    pendingSync: true,
  };
}

export async function submitCompleteSale(
  payload: CompleteSalePayload
): Promise<SubmitSaleOutcome> {
  if (!isBrowserOnline()) {
    return { ok: false, network: true, message: "Offline" };
  }

  const supabase = createClient();
  try {
    const { data, error } = await withTimeout(
      supabase.rpc("complete_sale", payloadToRpcArgs(payload)),
      RPC_TIMEOUT_MS
    );

    if (error) {
      const network =
        isNetworkError(error.message) ||
        !isBrowserOnline() ||
        error.message.trim().length === 0;
      return {
        ok: false,
        network,
        message: error.message || "Network error",
        stockConflict: !network && isStockConflictMessage(error.message),
      };
    }

    const enriched = await enrichSaleResult(
      data as { sale_id: string; receipt_no?: string; total?: number; duplicate?: boolean }
    );
    if (!enriched.duplicate) {
      triggerNotificationProcess();
    }
    return { ok: true, data: enriched };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      ok: false,
      network: isNetworkError(message) || !isBrowserOnline(),
      message,
      stockConflict: isStockConflictMessage(message),
    };
  }
}

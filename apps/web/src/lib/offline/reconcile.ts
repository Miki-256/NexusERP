import { createClient } from "@/lib/supabase/client";
import { getQueuedSales, removeQueuedSale } from "./queue";
import { notifyOfflineChange } from "./events";
import type { CompleteSalePayload, QueuedSale } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim();
  if (!key) return null;
  return UUID_RE.test(key) ? key.toLowerCase() : key;
}

function payloadTotal(payload: CompleteSalePayload): number {
  return payload.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}

export type SaleLookupResult = {
  exists: boolean;
  receiptNo?: string;
  saleId?: string;
  /** True when we could not reliably ask the server (keep local row). */
  lookupError?: boolean;
  /** Matched by register/total/time fingerprint when idempotency key was absent on server. */
  fingerprint?: boolean;
};

type RpcResolution = {
  resolve?: string;
  reason?: string;
  sale_id?: string;
  receipt_no?: string | null;
};

/**
 * Server-side resolution (preferred). Handles multi-device / lost-response /
 * stock-conflict cases in one RPC so future queue issues share one path.
 */
function uuidOrNull(raw: string | null | undefined): string | null {
  const key = normalizeIdempotencyKey(raw);
  if (!key) return null;
  return UUID_RE.test(key) ? key : null;
}

export async function resolveQueuedSaleViaRpc(
  item: QueuedSale,
  opts?: { allowFingerprint?: boolean }
): Promise<SaleLookupResult> {
  const orgId = item.payload.organizationId;
  if (!orgId) return { exists: false };

  // RPC param is UUID — never send non-UUID keys (PostgREST type errors → stuck banners)
  const key = uuidOrNull(item.payload.idempotencyKey || item.id);
  const allowFingerprint = opts?.allowFingerprint ?? false;
  const total = payloadTotal(item.payload);

  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("resolve_offline_queued_sale", {
      p_organization_id: orgId,
      p_idempotency_key: key,
      p_store_id: allowFingerprint ? item.payload.storeId : null,
      p_register_id: allowFingerprint ? item.payload.registerId : null,
      p_paid_total: allowFingerprint && total > 0 ? total : null,
      p_queued_at: allowFingerprint ? item.createdAt : null,
    });

    if (error) return { exists: false, lookupError: true };

    const row = (data ?? {}) as RpcResolution;
    if (row.resolve === "clear" && row.sale_id) {
      return {
        exists: true,
        saleId: row.sale_id,
        receiptNo: row.receipt_no ?? undefined,
        fingerprint: row.reason === "fingerprint" || row.reason === "fingerprint_store",
      };
    }
    return { exists: false };
  } catch {
    return { exists: false, lookupError: true };
  }
}

/** True when the server already has a sale for this offline idempotency key. */
export async function saleExistsOnServer(
  organizationId: string,
  idempotencyKey: string
): Promise<SaleLookupResult> {
  const key = uuidOrNull(idempotencyKey);
  if (!organizationId || !key) return { exists: false };

  try {
    const supabase = createClient();
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "resolve_offline_queued_sale",
      {
        p_organization_id: organizationId,
        p_idempotency_key: key,
        p_store_id: null,
        p_register_id: null,
        p_paid_total: null,
        p_queued_at: null,
      }
    );

    if (!rpcError) {
      const row = (rpcData ?? {}) as RpcResolution;
      if (row.resolve === "clear" && row.sale_id) {
        return {
          exists: true,
          saleId: row.sale_id,
          receiptNo: row.receipt_no ?? undefined,
        };
      }
      return { exists: false };
    }

    const { data, error } = await supabase
      .from("sales")
      .select("id, receipt_no")
      .eq("organization_id", organizationId)
      .eq("idempotency_key", key)
      .maybeSingle();

    if (error) return { exists: false, lookupError: true };
    if (!data) return { exists: false };
    return {
      exists: true,
      saleId: data.id,
      receiptNo: data.receipt_no ?? undefined,
    };
  } catch {
    return { exists: false, lookupError: true };
  }
}

/**
 * When idempotency lookup misses but another device likely posted the same sale,
 * look for a recent sale on the same register with the same paid total.
 */
export async function findLikelyMatchingSale(item: QueuedSale): Promise<SaleLookupResult> {
  const viaRpc = await resolveQueuedSaleViaRpc(item, { allowFingerprint: true });
  if (viaRpc.exists || !viaRpc.lookupError) return viaRpc;

  const { payload, createdAt } = item;
  const orgId = payload.organizationId;
  const storeId = payload.storeId;
  const registerId = payload.registerId;
  if (!orgId || !storeId) return { exists: false };

  const total = payloadTotal(payload);
  if (!(total > 0)) return { exists: false };

  const createdMs = Date.parse(createdAt) || Date.now();
  const from = new Date(createdMs - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(createdMs + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const supabase = createClient();
    // Prefer same register; fall back to any sale on the store with matching total
    const { data, error } = await supabase
      .from("sales")
      .select("id, receipt_no, total, created_at, register_id")
      .eq("organization_id", orgId)
      .eq("store_id", storeId)
      .eq("status", "completed")
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return { exists: false, lookupError: true };
    if (!data?.length) return { exists: false };

    const amountMatches = data.filter((row) => Math.abs(Number(row.total) - total) < 0.05);
    const registerMatches = registerId
      ? amountMatches.filter((row) => row.register_id === registerId)
      : [];
    const matches = registerMatches.length > 0 ? registerMatches : amountMatches;
    if (matches.length === 0) return { exists: false };

    const best = matches
      .slice()
      .sort(
        (a, b) =>
          Math.abs(Date.parse(a.created_at) - createdMs) -
          Math.abs(Date.parse(b.created_at) - createdMs)
      )[0];

    return {
      exists: true,
      fingerprint: true,
      saleId: best.id,
      receiptNo: best.receipt_no ?? undefined,
    };
  } catch {
    return { exists: false, lookupError: true };
  }
}

/** Resolve one queue row against the server (RPC first, then fallbacks). */
export async function resolveQueuedSaleAgainstServer(
  item: QueuedSale,
  opts?: { allowFingerprint?: boolean }
): Promise<SaleLookupResult> {
  const allowFingerprint = opts?.allowFingerprint ?? false;
  const viaRpc = await resolveQueuedSaleViaRpc(item, { allowFingerprint });
  if (viaRpc.exists) return viaRpc;
  if (!viaRpc.lookupError) return viaRpc;

  // RPC missing / errored — fall back to direct table lookups
  const key = uuidOrNull(item.payload.idempotencyKey || item.id);
  if (key) {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("sales")
        .select("id, receipt_no")
        .eq("organization_id", item.payload.organizationId)
        .eq("idempotency_key", key)
        .maybeSingle();
      if (!error && data) {
        return {
          exists: true,
          saleId: data.id,
          receiptNo: data.receipt_no ?? undefined,
        };
      }
      if (error) return { exists: false, lookupError: true };
    } catch {
      return { exists: false, lookupError: true };
    }
  }

  if (allowFingerprint) {
    return findLikelyMatchingSale(item);
  }
  return { exists: false };
}

/**
 * Drop local queue rows that already exist on the server (common with two devices /
 * lost-response → offline queue after the sale actually posted).
 *
 * Also auto-clears stuck stock-conflict failures after enough retries so cashiers
 * never need to manually “Remove from this device” for multi-device cases.
 */
export async function reconcileLocalQueueWithServer(opts?: {
  /** Also match by register + total + time when idempotency misses (stock-conflict cases). */
  allowFingerprint?: boolean;
  /** Auto-drop failed stock-conflict rows after this many retries (default 2). */
  staleStockConflictRetries?: number;
  /**
   * Drop every local `failed` row after attempting server match.
   * Required for multi-device: Device B must not keep a forever banner when
   * Device A already finished the sale (or stock is already gone).
   */
  purgeFailed?: boolean;
}): Promise<{
  removed: number;
  receipts: string[];
  staleCleared: number;
}> {
  const all = await getQueuedSales();
  let removed = 0;
  let staleCleared = 0;
  const receipts: string[] = [];
  const allowFingerprint = opts?.allowFingerprint ?? true;
  const staleAfter = opts?.staleStockConflictRetries ?? 2;
  const purgeFailed = opts?.purgeFailed ?? true;

  for (const item of all) {
    try {
      const found = await resolveQueuedSaleAgainstServer(item, {
        // Always fingerprint failed rows; pending only after a prior attempt
        allowFingerprint:
          allowFingerprint && (item.status === "failed" || item.retries > 0),
      });

      if (found.exists) {
        await removeQueuedSale(item.id);
        removed++;
        receipts.push(found.receiptNo || item.localReceiptNo);
        continue;
      }

      // IMPORTANT: do NOT skip on lookupError — that left Device B banners stuck forever.
      // Multi-device rule: a local `failed` row must not survive reconcile while online.
      // We already tried idempotency + fingerprint; if still failed, drop it.
      if (purgeFailed && item.status === "failed") {
        await removeQueuedSale(item.id);
        removed++;
        staleCleared++;
        receipts.push(item.localReceiptNo);
        continue;
      }

      // Narrow legacy path when purgeFailed is disabled
      if (
        item.status === "failed" &&
        (isAutoClearableQueueError(item.lastError) || item.retries >= staleAfter)
      ) {
        await removeQueuedSale(item.id);
        removed++;
        staleCleared++;
        receipts.push(item.localReceiptNo);
      }
    } catch {
      // Even if lookup throws, never leave a sticky failed banner on this device
      if (purgeFailed && item.status === "failed") {
        try {
          await removeQueuedSale(item.id);
          removed++;
          staleCleared++;
          receipts.push(item.localReceiptNo);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (removed > 0) notifyOfflineChange();
  return { removed, receipts, staleCleared };
}

export function isStockConflictQueueError(message?: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("stock conflict") ||
    m.includes("insufficient") ||
    (m.includes("stock") && (m.includes("conflict") || m.includes("another device")))
  );
}

/** Errors that mean this device cannot usefully keep retrying — auto-clear. */
export function isAutoClearableQueueError(message?: string): boolean {
  if (!message) return false;
  if (isStockConflictQueueError(message)) return true;
  if (isAlreadySyncedMessage(message)) return true;
  const m = message.toLowerCase();
  return (
    m.includes("another device") ||
    m.includes("already on the server") ||
    m.includes("already recorded") ||
    m.includes("cleared automatically")
  );
}

export function isAlreadySyncedMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("duplicate") ||
    m.includes("already exists") ||
    m.includes("idempotency") ||
    m.includes("unique violation") ||
    m.includes("already recorded") ||
    m.includes("already on the server") ||
    m.includes("already synced")
  );
}

export function humanizeSyncFailure(message: string, stockConflict: boolean): string {
  if (stockConflict) {
    return "Stock conflict — this sale may already have been completed on another device or the stock changed. The app will clear it automatically if it finds a matching sale.";
  }
  if (/session|not authenticated|access denied|staff|register session/i.test(message)) {
    return "Sign-in or register session expired — open POS and sign in again. The app will clear this if the sale is already under Sales.";
  }
  if (isAlreadySyncedMessage(message)) {
    return "This sale appears to be already recorded on the server.";
  }
  return message;
}

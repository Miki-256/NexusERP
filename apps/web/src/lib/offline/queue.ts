import { idbDelete, idbGet, idbGetAll, idbPut, STORES } from "./idb";
import { notifyOfflineChange } from "./events";
import type { CompleteSalePayload, QueuedSale } from "./types";

export async function enqueueSale(
  payload: CompleteSalePayload,
  localReceiptNo: string,
  localSaleId: string
): Promise<QueuedSale> {
  const item: QueuedSale = {
    id: payload.idempotencyKey,
    createdAt: new Date().toISOString(),
    status: "pending",
    retries: 0,
    localReceiptNo,
    localSaleId,
    payload,
  };
  await idbPut(STORES.syncQueue, item);
  notifyOfflineChange();
  return item;
}

export async function getQueuedSales(): Promise<QueuedSale[]> {
  const all = await idbGetAll<QueuedSale>(STORES.syncQueue);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getPendingSales(): Promise<QueuedSale[]> {
  const all = await getQueuedSales();
  return all.filter((s) => s.status === "pending" || s.status === "syncing");
}

export async function getQueueStats(): Promise<{
  pending: number;
  failed: number;
  total: number;
}> {
  const all = await getQueuedSales();
  return {
    pending: all.filter((s) => s.status === "pending" || s.status === "syncing").length,
    failed: all.filter((s) => s.status === "failed").length,
    total: all.length,
  };
}

export async function updateQueuedSale(
  id: string,
  patch: Partial<Pick<QueuedSale, "status" | "retries" | "lastError">>
): Promise<void> {
  const existing = await idbGet<QueuedSale>(STORES.syncQueue, id);
  if (!existing) return;
  await idbPut(STORES.syncQueue, { ...existing, ...patch });
  notifyOfflineChange();
}

export async function removeQueuedSale(id: string): Promise<void> {
  await idbDelete(STORES.syncQueue, id);
  notifyOfflineChange();
}

export async function retryFailedSales(): Promise<void> {
  const all = await getQueuedSales();
  for (const item of all.filter((s) => s.status === "failed")) {
    await idbPut(STORES.syncQueue, { ...item, status: "pending", lastError: undefined });
  }
  notifyOfflineChange();
}

export async function retryQueuedSale(id: string): Promise<void> {
  const existing = await idbGet<QueuedSale>(STORES.syncQueue, id);
  if (!existing) return;
  await idbPut(STORES.syncQueue, { ...existing, status: "pending", lastError: undefined });
  notifyOfflineChange();
}

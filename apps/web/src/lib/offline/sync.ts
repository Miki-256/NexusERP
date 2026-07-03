import { notifyOfflineChange } from "./events";
import { isBrowserOnline } from "./network";
import {
  getPendingSales,
  removeQueuedSale,
  updateQueuedSale,
} from "./queue";
import { isStockConflictMessage, submitCompleteSale } from "./sale-api";
import { decrementCachedPosStock } from "./pos-cache";

let syncing = false;

export function isSyncRunning(): boolean {
  return syncing;
}

export async function processSyncQueue(): Promise<{
  synced: number;
  failed: number;
  stockConflicts: number;
}> {
  if (syncing || !isBrowserOnline()) {
    return { synced: 0, failed: 0, stockConflicts: 0 };
  }

  syncing = true;
  notifyOfflineChange();

  let synced = 0;
  let failed = 0;
  let stockConflicts = 0;

  try {
    const pending = await getPendingSales();

    for (const item of pending) {
      if (!isBrowserOnline()) break;

      await updateQueuedSale(item.id, { status: "syncing" });

      const outcome = await submitCompleteSale(item.payload);

      if (outcome.ok) {
        await removeQueuedSale(item.id);
        synced++;
        continue;
      }

      if (outcome.network) {
        await updateQueuedSale(item.id, {
          status: "pending",
          lastError: outcome.message,
        });
        break;
      }

      if (outcome.stockConflict) {
        await decrementCachedPosStock(
          item.payload.registerId,
          item.payload.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity }))
        );
        stockConflicts++;
      }

      const errorMessage = outcome.stockConflict
        ? `Stock conflict — adjust inventory and retry. ${outcome.message}`
        : outcome.message;

      await updateQueuedSale(item.id, {
        status: "failed",
        retries: item.retries + 1,
        lastError: errorMessage,
      });
      failed++;
    }
  } finally {
    syncing = false;
    notifyOfflineChange();
  }

  return { synced, failed, stockConflicts };
}

export { isStockConflictMessage };

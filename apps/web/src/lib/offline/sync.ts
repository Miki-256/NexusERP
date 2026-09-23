import { notifyOfflineChange } from "./events";
import { isBrowserOnline } from "./network";
import {
  getPendingSales,
  removeQueuedSale,
  updateQueuedSale,
} from "./queue";
import { isStockConflictMessage, submitCompleteSale } from "./sale-api";
import { decrementCachedPosStock } from "./pos-cache";
import {
  humanizeSyncFailure,
  isAlreadySyncedMessage,
  reconcileLocalQueueWithServer,
  resolveQueuedSaleAgainstServer,
  saleExistsOnServer,
} from "./reconcile";

let syncing = false;

export function isSyncRunning(): boolean {
  return syncing;
}

export async function processSyncQueue(): Promise<{
  synced: number;
  failed: number;
  stockConflicts: number;
  alreadyOnServer: number;
  staleCleared: number;
}> {
  if (syncing || !isBrowserOnline()) {
    return { synced: 0, failed: 0, stockConflicts: 0, alreadyOnServer: 0, staleCleared: 0 };
  }

  syncing = true;
  notifyOfflineChange();

  let synced = 0;
  let failed = 0;
  let stockConflicts = 0;
  let alreadyOnServer = 0;
  let staleCleared = 0;

  try {
    // Multi-device / lost-response / stuck stock conflicts: clear local leftovers
    const reconciled = await reconcileLocalQueueWithServer({
      allowFingerprint: true,
      staleStockConflictRetries: 1,
      purgeFailed: true,
    });
    alreadyOnServer += reconciled.removed - reconciled.staleCleared;
    staleCleared += reconciled.staleCleared;

    const pending = await getPendingSales();

    for (const item of pending) {
      if (!isBrowserOnline()) break;

      await updateQueuedSale(item.id, { status: "syncing" });

      const pre = await resolveQueuedSaleAgainstServer(item, {
        allowFingerprint: true,
      });
      if (pre.exists) {
        await removeQueuedSale(item.id);
        synced++;
        alreadyOnServer++;
        continue;
      }

      const outcome = await submitCompleteSale(item.payload);

      if (outcome.ok) {
        await removeQueuedSale(item.id);
        synced++;
        if (outcome.data.duplicate) alreadyOnServer++;
        continue;
      }

      if (outcome.network) {
        await updateQueuedSale(item.id, {
          status: "pending",
          lastError: outcome.message,
        });
        break;
      }

      // After any hard failure, re-check server (session expiry, race, multi-device)
      const postFail = await resolveQueuedSaleAgainstServer(item, {
        allowFingerprint: true,
      });
      if (postFail.exists) {
        await removeQueuedSale(item.id);
        synced++;
        alreadyOnServer++;
        continue;
      }

      if (isAlreadySyncedMessage(outcome.message) && !postFail.lookupError) {
        await removeQueuedSale(item.id);
        synced++;
        alreadyOnServer++;
        continue;
      }

      const nextRetries = item.retries + 1;

      if (outcome.stockConflict) {
        await decrementCachedPosStock(
          item.payload.registerId,
          item.payload.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity }))
        );
        stockConflicts++;

        // After first stock conflict retry, inventory is gone — clear even if server lookup errored
        if (nextRetries >= 1) {
          await removeQueuedSale(item.id);
          staleCleared++;
          continue;
        }
      }

      const errorMessage = humanizeSyncFailure(outcome.message, !!outcome.stockConflict);

      // Already-synced style errors: never leave a sticky failed banner
      if (isAlreadySyncedMessage(errorMessage) || isAlreadySyncedMessage(outcome.message)) {
        await removeQueuedSale(item.id);
        alreadyOnServer++;
        continue;
      }

      // After 3 hard failures with a reachable server, drop the row so Device B
      // never needs a manual remove for multi-device leftovers.
      if (nextRetries >= 3 && !postFail.lookupError) {
        await removeQueuedSale(item.id);
        staleCleared++;
        continue;
      }

      await updateQueuedSale(item.id, {
        status: "failed",
        retries: nextRetries,
        lastError: errorMessage,
      });
      failed++;
    }
  } finally {
    syncing = false;
    notifyOfflineChange();
  }

  return { synced, failed, stockConflicts, alreadyOnServer, staleCleared };
}

export { isStockConflictMessage, saleExistsOnServer };

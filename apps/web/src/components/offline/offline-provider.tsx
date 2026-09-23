"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { subscribeOfflineChange } from "@/lib/offline/events";
import { isBrowserOnline } from "@/lib/offline/network";
import { getQueueStats, retryFailedSales } from "@/lib/offline/queue";
import { reconcileLocalQueueWithServer } from "@/lib/offline/reconcile";
import { isSyncRunning, processSyncQueue } from "@/lib/offline/sync";

type OfflineContextValue = {
  online: boolean;
  pendingCount: number;
  failedCount: number;
  syncing: boolean;
  lastSyncNote: string | null;
  clearSyncNote: () => void;
  syncNow: () => Promise<void>;
  retryFailed: () => Promise<void>;
  reconcileQueue: () => Promise<{ removed: number; receipts: string[]; staleCleared: number }>;
};

const OfflineContext = createContext<OfflineContextValue | null>(null);

function queueClearedNote(removed: number, staleCleared: number): string {
  if (staleCleared > 0 && staleCleared >= removed) {
    return staleCleared === 1
      ? "1 stuck sale was cleared automatically. Confirm it under Sales — if missing, ring it up again."
      : `${staleCleared} stuck sales were cleared automatically. Confirm them under Sales — if missing, ring them up again.`;
  }
  if (staleCleared > 0) {
    return `${removed} sale(s) cleared from this device (${staleCleared} looked stuck after another device used the stock). Check Sales to confirm.`;
  }
  return removed === 1
    ? "1 sale was already on the server and cleared from this device."
    : `${removed} sales were already on the server and cleared from this device.`;
}

async function refreshStats(
  setPending: (n: number) => void,
  setFailed: (n: number) => void
) {
  try {
    const stats = await getQueueStats();
    setPending(stats.pending);
    setFailed(stats.failed);
  } catch {
    /* IndexedDB unavailable */
  }
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncNote, setLastSyncNote] = useState<string | null>(null);
  const autoRepairRef = useRef(false);

  const refresh = useCallback(async () => {
    await refreshStats(setPendingCount, setFailedCount);
    setSyncing(isSyncRunning());
  }, []);

  const clearSyncNote = useCallback(() => setLastSyncNote(null), []);

  const syncNow = useCallback(async () => {
    if (!isBrowserOnline()) return;
    setSyncing(true);
    const result = await processSyncQueue();
    const cleared = result.alreadyOnServer + result.staleCleared;
    if (cleared > 0) {
      setLastSyncNote(queueClearedNote(cleared, result.staleCleared));
    }
    await refresh();
  }, [refresh]);

  const reconcileQueue = useCallback(async () => {
    if (!isBrowserOnline()) return { removed: 0, receipts: [] as string[], staleCleared: 0 };
    const result = await reconcileLocalQueueWithServer({
      allowFingerprint: true,
      staleStockConflictRetries: 1,
      purgeFailed: true,
    });
    if (result.removed > 0) {
      setLastSyncNote(queueClearedNote(result.removed, result.staleCleared));
    }
    await refresh();
    return result;
  }, [refresh]);

  const retryFailed = useCallback(async () => {
    const reconciled = await reconcileQueue();
    if (reconciled.removed > 0) {
      const stats = await getQueueStats().catch(() => ({ pending: 0, failed: 0, total: 0 }));
      if (stats.failed === 0 && stats.pending === 0) {
        await refresh();
        return;
      }
    }
    await retryFailedSales();
    await syncNow();
  }, [reconcileQueue, refresh, syncNow]);

  /** Full auto-repair: purge stuck failed rows, then sync any remaining pending */
  const autoRepairQueue = useCallback(async () => {
    if (!isBrowserOnline() || isSyncRunning()) return;
    await reconcileQueue();
    const after = await getQueueStats().catch(() => null);
    if (!after) return;
    if (after.failed > 0) {
      await retryFailedSales().catch(() => undefined);
    }
    const again = await getQueueStats().catch(() => null);
    if (again && (again.pending > 0 || again.failed > 0)) {
      await syncNow().catch(() => undefined);
    }
  }, [reconcileQueue, syncNow]);

  useEffect(() => {
    setOnline(isBrowserOnline());
    void refresh();

    if (isBrowserOnline()) {
      void autoRepairQueue();
    }

    function onOnline() {
      setOnline(true);
      void autoRepairQueue();
    }
    function onOffline() {
      setOnline(false);
    }

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const unsub = subscribeOfflineChange(() => {
      void refresh().catch(() => undefined);
    });

    // While failures/pending remain, keep repairing every 5s until the banner is gone
    const interval = window.setInterval(() => {
      if (!isBrowserOnline() || isSyncRunning()) return;
      void getQueueStats()
        .then(async (stats) => {
          if (stats.failed > 0 || stats.pending > 0) {
            await autoRepairQueue();
          }
        })
        .catch(() => undefined);
    }, 5_000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      unsub();
      clearInterval(interval);
    };
  }, [autoRepairQueue, refresh]);

  // When a failed banner appears, auto-repair once without waiting for a tap
  useEffect(() => {
    if (!online || failedCount <= 0 || syncing) {
      if (failedCount <= 0) autoRepairRef.current = false;
      return;
    }
    if (autoRepairRef.current) return;
    autoRepairRef.current = true;
    void autoRepairQueue();
  }, [online, failedCount, syncing, autoRepairQueue]);

  const value = useMemo(
    () => ({
      online,
      pendingCount,
      failedCount,
      syncing,
      lastSyncNote,
      clearSyncNote,
      syncNow,
      retryFailed,
      reconcileQueue,
    }),
    [
      online,
      pendingCount,
      failedCount,
      syncing,
      lastSyncNote,
      clearSyncNote,
      syncNow,
      retryFailed,
      reconcileQueue,
    ]
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    throw new Error("useOffline must be used within OfflineProvider");
  }
  return ctx;
}

export function useOfflineOptional() {
  return useContext(OfflineContext);
}

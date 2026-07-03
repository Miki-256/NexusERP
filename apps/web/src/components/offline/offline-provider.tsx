"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { subscribeOfflineChange } from "@/lib/offline/events";
import { isBrowserOnline } from "@/lib/offline/network";
import { getQueueStats, retryFailedSales } from "@/lib/offline/queue";
import { isSyncRunning, processSyncQueue } from "@/lib/offline/sync";

type OfflineContextValue = {
  online: boolean;
  pendingCount: number;
  failedCount: number;
  syncing: boolean;
  syncNow: () => Promise<void>;
  retryFailed: () => Promise<void>;
};

const OfflineContext = createContext<OfflineContextValue | null>(null);

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

  const refresh = useCallback(async () => {
    await refreshStats(setPendingCount, setFailedCount);
    setSyncing(isSyncRunning());
  }, []);

  const syncNow = useCallback(async () => {
    if (!isBrowserOnline()) return;
    setSyncing(true);
    await processSyncQueue();
    await refresh();
  }, [refresh]);

  const retryFailed = useCallback(async () => {
    await retryFailedSales();
    await syncNow();
  }, [syncNow]);

  useEffect(() => {
    setOnline(isBrowserOnline());
    refresh();

    function onOnline() {
      setOnline(true);
      void syncNow().catch(() => undefined);
    }
    function onOffline() {
      setOnline(false);
    }

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const unsub = subscribeOfflineChange(() => {
      void refresh().catch(() => undefined);
    });

    const interval = window.setInterval(() => {
      if (isBrowserOnline() && !isSyncRunning()) {
        void getQueueStats()
          .then((stats) => {
            if (stats.pending > 0) void syncNow().catch(() => undefined);
          })
          .catch(() => undefined);
      }
    }, 30_000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      unsub();
      clearInterval(interval);
    };
  }, [refresh, syncNow]);

  const value = useMemo(
    () => ({
      online,
      pendingCount,
      failedCount,
      syncing,
      syncNow,
      retryFailed,
    }),
    [online, pendingCount, failedCount, syncing, syncNow, retryFailed]
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

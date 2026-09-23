"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, CloudUpload, Loader2, RefreshCw, WifiOff, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOfflineOptional } from "./offline-provider";
import { getQueuedSales } from "@/lib/offline/queue";
import type { QueuedSale } from "@/lib/offline/types";
import { cn } from "@/lib/utils";

export function SyncIndicator() {
  const t = useTranslations("common");
  const offline = useOfflineOptional();
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<QueuedSale[]>([]);
  const [busy, setBusy] = useState(false);
  const autoTriedRef = useRef(false);

  const refreshItems = useCallback(async () => {
    try {
      setItems(await getQueuedSales());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (!expanded && !(offline && offline.failedCount > 0)) return;
    void refreshItems();
  }, [expanded, offline?.failedCount, offline?.pendingCount, offline?.syncing, refreshItems]);

  // Auto-purge failed queue on sight — multi-device must not keep a sticky banner
  useEffect(() => {
    if (!offline?.online || offline.failedCount <= 0) {
      autoTriedRef.current = false;
      return;
    }
    if (offline.syncing || busy || autoTriedRef.current) return;
    autoTriedRef.current = true;
    void (async () => {
      setBusy(true);
      try {
        await offline.reconcileQueue();
        await offline.retryFailed();
        await refreshItems();
      } finally {
        setBusy(false);
      }
    })();
  }, [offline, offline?.failedCount, offline?.online, offline?.syncing, busy, refreshItems]);

  if (!offline) return null;

  const {
    online,
    pendingCount,
    failedCount,
    syncing,
    syncNow,
    retryFailed,
    lastSyncNote,
    clearSyncNote,
  } = offline;
  const hasQueue = pendingCount > 0 || failedCount > 0;

  if (online && !hasQueue && !syncing && !lastSyncNote && !expanded) return null;

  const showFailed = failedCount > 0 && !syncing;
  const showPending = pendingCount > 0 && !syncing && !showFailed;
  const showOffline = !online;
  const showSyncing = syncing;
  const failedItems = items.filter((i) => i.status === "failed");

  async function onRetry() {
    setBusy(true);
    try {
      await retryFailed();
      await refreshItems();
      const stillFailed = (await getQueuedSales()).some((i) => i.status === "failed");
      setExpanded(stillFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed right-4 top-4 z-[200] flex max-w-sm flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {lastSyncNote && !hasQueue && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 shadow-md dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          <span className="flex-1">{lastSyncNote}</span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
            aria-label={t("close")}
            onClick={() => clearSyncNote()}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {showOffline && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-md dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>{t("offlineSalesSync")}</span>
        </div>
      )}

      {showSyncing && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 shadow-md dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>{t("syncingSales", { count: pendingCount })}</span>
        </div>
      )}

      {showPending && (
        <button
          type="button"
          onClick={() => void syncNow().catch(() => undefined)}
          className={cn(
            "flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 shadow-md",
            "transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100 dark:hover:bg-blue-900"
          )}
        >
          <CloudUpload className="h-4 w-4 shrink-0" />
          <span>{t("salesWaitingSync", { count: pendingCount })}</span>
          <RefreshCw className="ml-auto h-3.5 w-3.5 opacity-60" />
        </button>
      )}

      {showFailed && (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 text-sm text-red-900 shadow-md dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRetry()}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left",
              "transition-colors hover:bg-red-100 dark:hover:bg-red-900"
            )}
          >
            <CloudOff className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t("salesFailedSync", { count: failedCount })}</span>
            <RefreshCw className={cn("h-3.5 w-3.5 opacity-60", busy && "animate-spin")} />
          </button>

          <div className="space-y-2 border-t border-red-200/80 px-3 py-2 dark:border-red-800/80">
            <p className="text-xs text-red-800/90 dark:text-red-200/90">{t("salesFailedSyncHint")}</p>
            {lastSyncNote && <p className="text-xs text-emerald-800 dark:text-emerald-200">{lastSyncNote}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md bg-white/80 px-2 py-1 text-xs font-medium text-red-900 hover:bg-white dark:bg-red-900/40 dark:text-red-100"
            >
              {expanded ? t("hideDetails") : t("showDetails")}
            </button>
            {expanded &&
              failedItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-red-200/70 bg-white/70 p-2 dark:border-red-800/70 dark:bg-red-950/50"
                >
                  <p className="font-medium tabular-nums">{item.localReceiptNo}</p>
                  {item.lastError && (
                    <p className="mt-1 text-xs leading-snug text-red-800 dark:text-red-200">
                      {item.lastError}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={busy || !online}
                    onClick={() => void onRetry()}
                    className="mt-2 inline-flex items-center gap-1 rounded-md bg-red-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t("retry")}
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

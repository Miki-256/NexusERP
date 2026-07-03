"use client";

import { CloudOff, CloudUpload, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { useOfflineOptional } from "./offline-provider";
import { cn } from "@/lib/utils";

export function SyncIndicator() {
  const offline = useOfflineOptional();
  if (!offline) return null;

  const { online, pendingCount, failedCount, syncing, syncNow, retryFailed } = offline;
  const hasQueue = pendingCount > 0 || failedCount > 0;

  if (online && !hasQueue && !syncing) return null;

  const showFailed = failedCount > 0 && !syncing;
  const showPending = pendingCount > 0 && !syncing && !showFailed;
  const showOffline = !online;
  const showSyncing = syncing;

  return (
    <div
      className="fixed right-4 top-4 z-[200] flex max-w-sm flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {showOffline && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-md dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>Offline — sales will sync when connected</span>
        </div>
      )}

      {showSyncing && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 shadow-md dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>Syncing {pendingCount} sale{pendingCount === 1 ? "" : "s"}…</span>
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
          <span>
            {pendingCount} sale{pendingCount === 1 ? "" : "s"} waiting to sync
          </span>
          <RefreshCw className="ml-auto h-3.5 w-3.5 opacity-60" />
        </button>
      )}

      {showFailed && (
        <button
          type="button"
          onClick={() => void retryFailed().catch(() => undefined)}
          className={cn(
            "flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 shadow-md",
            "transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-100 dark:hover:bg-red-900"
          )}
        >
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>
            {failedCount} sale{failedCount === 1 ? "" : "s"} failed to sync — tap to retry
          </span>
        </button>
      )}
    </div>
  );
}

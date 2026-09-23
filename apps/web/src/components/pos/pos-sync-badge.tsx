"use client";

import { CloudOff, CloudUpload, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOfflineOptional } from "@/components/offline/offline-provider";
import { cn } from "@/lib/utils";

/** Compact sync status for the POS header. */
export function PosSyncBadge({ onOpenQueue }: { onOpenQueue?: () => void }) {
  const t = useTranslations("pos");
  const offline = useOfflineOptional();
  if (!offline) return null;

  const { online, pendingCount, failedCount, syncing, syncNow, retryFailed } = offline;
  const hasQueue = pendingCount > 0 || failedCount > 0;

  if (online && !hasQueue && !syncing) return null;

  if (!online) {
    return (
      <button
        type="button"
        onClick={onOpenQueue}
        className="flex items-center gap-1.5 rounded-lg bg-amber-400/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100"
        title={t("offlineSalesQueueLocally")}
      >
        <WifiOff className="h-3.5 w-3.5" />
        {t("offline")}
      </button>
    );
  }

  if (syncing) {
    return (
      <span className="flex items-center gap-1.5 rounded-lg bg-sky-400/20 px-2.5 py-1 text-[11px] font-semibold text-sky-100">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("syncingCount", { count: pendingCount })}
      </span>
    );
  }

  if (failedCount > 0) {
    return (
      <button
        type="button"
        onClick={() => {
          if (onOpenQueue) onOpenQueue();
          else void retryFailed().catch(() => undefined);
        }}
        className={cn(
          "flex items-center gap-1.5 rounded-lg bg-red-400/20 px-2.5 py-1 text-[11px] font-semibold text-red-100",
          "hover:bg-red-400/30"
        )}
      >
        <CloudOff className="h-3.5 w-3.5" />
        {t("failedCountBadge", { count: failedCount })}
        <RefreshCw className="h-3 w-3 opacity-70" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void syncNow().catch(() => undefined)}
      className={cn(
        "flex items-center gap-1.5 rounded-lg bg-sky-400/20 px-2.5 py-1 text-[11px] font-semibold text-sky-100",
        "hover:bg-sky-400/30"
      )}
    >
      <CloudUpload className="h-3.5 w-3.5" />
      {t("pendingCountBadge", { count: pendingCount })}
      <RefreshCw className="h-3 w-3 opacity-70" />
    </button>
  );
}

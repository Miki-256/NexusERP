"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOfflineOptional } from "@/components/offline/offline-provider";
import {
  getQueuedSales,
  removeQueuedSale,
  retryQueuedSale,
} from "@/lib/offline/queue";
import type { QueuedSale } from "@/lib/offline/types";
import { formatCurrency } from "@/lib/utils";
import { CloudOff, RefreshCw, Trash2, X } from "lucide-react";

export function PosOfflineQueueModal({
  currency,
  onClose,
}: {
  currency: string;
  onClose: () => void;
}) {
  const offline = useOfflineOptional();
  const [items, setItems] = useState<QueuedSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const all = await getQueuedSales();
    setItems(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function retryOne(id: string) {
    setBusyId(id);
    await retryQueuedSale(id);
    if (offline?.online) await offline.syncNow();
    await refresh();
    setBusyId(null);
  }

  async function retryAllFailed() {
    setBusyId("__all__");
    await offline?.retryFailed();
    await refresh();
    setBusyId(null);
  }

  async function discard(id: string) {
    if (!window.confirm("Remove this offline sale from the queue? It will not sync.")) return;
    setBusyId(id);
    await removeQueuedSale(id);
    await refresh();
    setBusyId(null);
  }

  const failed = items.filter((i) => i.status === "failed");
  const pending = items.filter((i) => i.status === "pending" || i.status === "syncing");

  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="pos-modal-panel flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="pos-header flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="pos-heading text-lg font-bold text-white">Offline sync queue</h2>
            <p className="text-xs text-white/70">
              {pending.length} pending · {failed.length} failed
            </p>
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg p-2 text-white/70 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-sm text-slate-500">Loading queue…</p>}
          {!loading && items.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
              No offline sales waiting to sync.
            </p>
          )}

          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{item.localReceiptNo}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(item.createdAt).toLocaleString()} · {item.status}
                    </p>
                  </div>
                  <span
                    className={
                      item.status === "failed"
                        ? "rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"
                        : "rounded-md bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700"
                    }
                  >
                    {item.status}
                  </span>
                </div>
                <p className="mb-2 text-sm font-medium tabular-nums text-slate-700">
                  {formatCurrency(
                    item.payload.lines.reduce(
                      (sum, line) => sum + line.unitPrice * line.quantity - line.discountAmount,
                      0
                    ),
                    currency
                  )}{" "}
                  est.
                </p>
                {item.lastError && (
                  <p className="mb-3 flex items-start gap-1.5 text-xs text-red-600">
                    <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {item.lastError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="cursor-pointer gap-1"
                    disabled={busyId === item.id || !offline?.online}
                    onClick={() => void retryOne(item.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                  {item.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer gap-1 text-red-600 hover:bg-red-50"
                      disabled={busyId === item.id}
                      onClick={() => void discard(item.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Discard
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 p-4 sm:flex-row">
          <Button variant="outline" className="flex-1 cursor-pointer" onClick={onClose}>
            Close
          </Button>
          {failed.length > 0 && (
            <Button
              className="flex-1 cursor-pointer gap-2"
              disabled={busyId === "__all__" || !offline?.online}
              onClick={() => void retryAllFailed()}
            >
              <RefreshCw className="h-4 w-4" />
              Retry all failed
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

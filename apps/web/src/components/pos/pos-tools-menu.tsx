"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ESCPOS_ENABLED_KEY,
  ESCPOS_URL_KEY,
  getEscPosPrintUrl,
  isEscPosEnabled,
} from "@/lib/pos/escpos-print";
import { downloadShiftCsv } from "@/lib/pos/shift-export";
import {
  getPosAutoPrint,
  getPosAutoReturn,
  setPosAutoPrint,
  setPosAutoReturn,
} from "@/lib/pos/pos-preferences";
import { useOfflineOptional } from "@/components/offline/offline-provider";
import {
  Monitor,
  Printer,
  Smartphone,
  Keyboard,
  X,
  CloudUpload,
  Download,
  RotateCcw,
  DoorClosed,
  Wrench,
} from "lucide-react";

export function PosToolsMenu({
  registerId,
  sessionId,
  sessionToken,
  onOpenCustomerDisplay,
  onOpenScanner,
  onOpenRefund,
  onOpenCloseShift,
  onOpenShortcuts,
  onOpenOfflineQueue,
  onClose,
}: {
  registerId: string;
  sessionId?: string;
  sessionToken?: string;
  onOpenCustomerDisplay: () => void;
  onOpenScanner: () => void;
  onOpenRefund?: () => void;
  onOpenCloseShift?: () => void;
  onOpenShortcuts: () => void;
  onOpenOfflineQueue: () => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const offline = useOfflineOptional();
  const [escposUrl, setEscposUrl] = useState(getEscPosPrintUrl());
  const [escposOn, setEscposOn] = useState(isEscPosEnabled());
  const [autoPrint, setAutoPrint] = useState(() => getPosAutoPrint(registerId));
  const [autoReturn, setAutoReturn] = useState(() => getPosAutoReturn(registerId));
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function saveEscPos() {
    localStorage.setItem(ESCPOS_URL_KEY, escposUrl.trim());
    localStorage.setItem(ESCPOS_ENABLED_KEY, escposOn ? "1" : "0");
  }

  function installPwaHint() {
    alert(
      "Install POS:\n\n• Chrome/Android: Menu → Install app / Add to Home screen\n• iOS Safari: Share → Add to Home Screen\n\nThen open from your home screen for full-screen kiosk mode."
    );
  }

  async function exportShift() {
    if (!sessionId) return;
    setExportBusy(true);
    setExportError(null);
    try {
      await downloadShiftCsv(sessionId, sessionToken, registerNameSlug(registerId));
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="pos-tools-overlay fixed inset-0 z-[9999] overflow-y-auto overscroll-contain bg-slate-900/50 backdrop-blur-[2px] [color-scheme:light]"
      onClick={onClose}
      role="presentation"
    >
      <div className="flex min-h-full items-end justify-center sm:items-center sm:p-4">
        <div
          className="pos-modal-panel w-full max-w-md rounded-t-2xl bg-white text-slate-900 shadow-2xl sm:rounded-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-tools-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-slate-200 bg-white px-4 py-3.5 sm:rounded-t-2xl sm:px-5 sm:py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                <Wrench className="h-4 w-4" />
              </div>
              <h2 id="pos-tools-title" className="pos-heading text-base font-bold text-slate-900 sm:text-lg">
                POS tools
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg p-2 text-slate-400 hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5">
            <div className="mb-4 rounded-xl border-2 border-sky-200 bg-sky-50 p-3">
              <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-sky-800">
                Shift actions
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-14 cursor-pointer flex-col gap-1.5 border-sky-300 bg-white py-2 text-xs font-bold text-sky-900 hover:bg-sky-100 sm:h-11 sm:flex-row sm:justify-start sm:gap-2 sm:text-sm"
                  onClick={() => onOpenRefund?.()}
                >
                  <RotateCcw className="h-5 w-5 shrink-0" />
                  Refunds
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-14 cursor-pointer flex-col gap-1.5 border-sky-300 bg-white py-2 text-xs font-bold text-sky-900 hover:bg-sky-100 sm:h-11 sm:flex-row sm:justify-start sm:gap-2 sm:text-sm"
                  onClick={() => onOpenCloseShift?.()}
                >
                  <DoorClosed className="h-5 w-5 shrink-0" />
                  Close shift
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Tools</p>
              <Button
                variant="outline"
                className="h-11 w-full cursor-pointer justify-start gap-2 border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50"
                onClick={onOpenCustomerDisplay}
              >
                <Monitor className="h-4 w-4 shrink-0" />
                Open customer display
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full cursor-pointer justify-start gap-2 border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50"
                onClick={onOpenScanner}
              >
                <Smartphone className="h-4 w-4 shrink-0" />
                Camera barcode scan
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full cursor-pointer justify-start gap-2 border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50"
                onClick={onOpenShortcuts}
              >
                <Keyboard className="h-4 w-4 shrink-0" />
                Keyboard shortcuts
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full cursor-pointer justify-start gap-2 border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50"
                onClick={onOpenOfflineQueue}
              >
                <CloudUpload className="h-4 w-4 shrink-0" />
                Offline sync queue
                {(offline?.failedCount ?? 0) > 0 && (
                  <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                    {offline?.failedCount} failed
                  </span>
                )}
              </Button>
              {sessionId && (
                <Button
                  variant="outline"
                  className="h-11 w-full cursor-pointer justify-start gap-2 border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50"
                  disabled={exportBusy}
                  onClick={() => void exportShift()}
                >
                  <Download className="h-4 w-4 shrink-0" />
                  {exportBusy ? "Exporting…" : "Export shift CSV"}
                </Button>
              )}
              {exportError && <p className="text-xs text-red-600">{exportError}</p>}
              <Button
                variant="outline"
                className="h-11 w-full cursor-pointer justify-start gap-2 border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50"
                onClick={installPwaHint}
              >
                <Smartphone className="h-4 w-4 shrink-0" />
                Install as app (PWA)
              </Button>
            </div>

            <div className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">Checkout</p>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={autoPrint}
                  onChange={(e) => {
                    setAutoPrint(e.target.checked);
                    setPosAutoPrint(registerId, e.target.checked);
                  }}
                  className="h-4 w-4 accent-sky-600"
                />
                Auto-print receipt after sale
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={autoReturn}
                  onChange={(e) => {
                    setAutoReturn(e.target.checked);
                    setPosAutoReturn(registerId, e.target.checked);
                  }}
                  className="h-4 w-4 accent-sky-600"
                />
                Auto-return to catalog after sale
              </label>
            </div>

            <div className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Printer className="h-4 w-4" />
                ESC/POS thermal printer
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={escposOn}
                  onChange={(e) => setEscposOn(e.target.checked)}
                  className="h-4 w-4 accent-sky-600"
                />
                Send receipts to local print bridge
              </label>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-700">Bridge URL (default localhost:17832)</Label>
                <Input
                  value={escposUrl}
                  onChange={(e) => setEscposUrl(e.target.value)}
                  className="h-10 border-slate-300 bg-white font-mono text-xs text-slate-900"
                />
              </div>
              <p className="text-[11px] leading-relaxed text-slate-600">
                Run a local ESC/POS bridge that accepts POST /print with raw bytes. Browser print is used when disabled.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                onClick={saveEscPos}
              >
                Save print settings
              </Button>
            </div>

            <p className="mt-4 text-center font-mono text-[10px] text-slate-400">
              Register {registerId.slice(0, 8)}…
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function registerNameSlug(registerId: string) {
  return `register-${registerId.slice(0, 8)}`;
}

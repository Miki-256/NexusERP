"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isBrowserOnline } from "@/lib/offline/network";
import { ZReportPrint, type ZReportData } from "./z-report-print";
import { downloadShiftCsv } from "@/lib/pos/shift-export";
import { X, Printer, Download } from "lucide-react";

type ShiftSummary = {
  sessionId: string;
  openedAt: string;
  openingFloat: number;
  activeStaffName: string | null;
  saleCount: number;
  voidCount: number;
  grossTotal: number;
  expectedCash: number;
  paymentBreakdown: { method: string; total: number }[];
};

export function CloseShiftModal({
  sessionId,
  registerName,
  storeName,
  orgName,
  currency,
  sessionToken,
  onClosed,
  onClose,
}: {
  sessionId: string;
  registerName: string;
  storeName: string;
  orgName: string;
  currency: string;
  sessionToken?: string;
  onClosed: () => void;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [closingCash, setClosingCash] = useState("");
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printReport, setPrintReport] = useState<ZReportData | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("get_pos_shift_summary", {
        p_session_id: sessionId,
        p_session_token: sessionToken ?? null,
      });
      setLoading(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const s = data as ShiftSummary;
      setSummary(s);
      setClosingCash(String(s.expectedCash ?? 0));
    }
    void load();
  }, [sessionId, sessionToken]);

  const cashVariance =
    summary && closingCash
      ? parseFloat(closingCash) - summary.expectedCash
      : 0;

  function buildZReport(closing: number | null): ZReportData {
    return {
      registerName,
      storeName,
      orgName,
      currency,
      openedAt: summary!.openedAt,
      activeStaffName: summary!.activeStaffName,
      saleCount: summary!.saleCount,
      voidCount: summary!.voidCount,
      grossTotal: summary!.grossTotal,
      openingFloat: summary!.openingFloat,
      expectedCash: summary!.expectedCash,
      closingCash: closing,
      cashVariance:
        closing != null && Math.abs(closing - summary!.expectedCash) > 0.01
          ? closing - summary!.expectedCash
          : null,
      paymentBreakdown: summary!.paymentBreakdown,
      printedAt: new Date().toISOString(),
    };
  }

  function handlePrintZReport() {
    if (!summary) return;
    const cash = parseFloat(closingCash);
    setPrintReport(buildZReport(Number.isFinite(cash) ? cash : null));
  }

  async function handleExportCsv() {
    setExportBusy(true);
    setError(null);
    try {
      await downloadShiftCsv(sessionId, sessionToken, registerName.replace(/\s+/g, "-").toLowerCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  }

  async function closeShift() {
    if (!isBrowserOnline()) {
      setError("Connect to the internet to close the shift.");
      return;
    }
    setClosing(true);
    setError(null);
    const supabase = createClient();
    const cash = parseFloat(closingCash) || 0;

    if (sessionToken) {
      const { error: rpcError } = await supabase.rpc("close_register_session_staff", {
        p_session_id: sessionId,
        p_session_token: sessionToken,
        p_closing_cash: cash,
      });
      setClosing(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
    } else {
      const { error: rpcError } = await supabase.rpc("close_register_session_manager", {
        p_session_id: sessionId,
        p_closing_cash: cash,
      });
      setClosing(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
    }
    onClosed();
  }

  if (printReport) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-white p-6">
        <ZReportPrint report={printReport} onDone={() => setPrintReport(null)} />
      </div>
    );
  }

  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="pos-modal-panel flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="pos-header flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="pos-heading text-lg font-bold text-white">Close shift · Z-report</h2>
            <p className="text-xs text-white/70">{registerName} · {storeName}</p>
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg p-2 text-white/70 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && <p className="text-sm text-slate-500">Loading shift summary…</p>}
          {error && !summary && <p className="text-sm text-red-600">{error}</p>}

          {summary && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Sales</p>
                  <p className="text-lg font-bold tabular-nums">{summary.saleCount}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Gross total</p>
                  <p className="text-lg font-bold tabular-nums">{formatCurrency(summary.grossTotal, currency)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Opening float</p>
                  <p className="font-semibold tabular-nums">{formatCurrency(summary.openingFloat, currency)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Expected cash</p>
                  <p className="font-semibold tabular-nums">{formatCurrency(summary.expectedCash, currency)}</p>
                </div>
              </div>

              {summary.paymentBreakdown.length > 0 && (
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Payment mix</p>
                  <ul className="space-y-1 text-sm">
                    {summary.paymentBreakdown.map((p) => (
                      <li key={p.method} className="flex justify-between capitalize">
                        <span>{p.method.replace(/_/g, " ")}</span>
                        <span className="font-semibold tabular-nums">{formatCurrency(p.total, currency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {summary.voidCount > 0 && (
                <p className="text-sm text-amber-700">{summary.voidCount} voided sale(s) this shift</p>
              )}

              <div className="space-y-2">
                <Label htmlFor="closing-cash">Counted cash in drawer</Label>
                <Input
                  id="closing-cash"
                  type="number"
                  step="0.01"
                  value={closingCash}
                  onChange={(e) => setClosingCash(e.target.value)}
                  className="h-12 text-lg font-semibold"
                />
                {Math.abs(cashVariance) > 0.01 && (
                  <p className={cashVariance >= 0 ? "text-sm text-emerald-700" : "text-sm text-red-600"}>
                    Variance: {cashVariance >= 0 ? "+" : ""}
                    {formatCurrency(cashVariance, currency)}
                  </p>
                )}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 p-4 sm:flex-row">
          <Button variant="outline" className="flex-1 cursor-pointer" onClick={onClose} disabled={closing}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="flex-1 cursor-pointer gap-2"
            onClick={() => void handleExportCsv()}
            disabled={loading || !summary || exportBusy}
          >
            <Download className="h-4 w-4" />
            {exportBusy ? "…" : "CSV"}
          </Button>
          <Button
            variant="outline"
            className="flex-1 cursor-pointer gap-2"
            onClick={handlePrintZReport}
            disabled={loading || !summary}
          >
            <Printer className="h-4 w-4" />
            Print Z-report
          </Button>
          <Button
            className="flex-[2] cursor-pointer bg-pos-primary hover:bg-pos-primary-dark"
            onClick={closeShift}
            disabled={closing || loading || !summary}
          >
            {closing ? "Closing…" : "Close shift"}
          </Button>
        </div>
      </div>
    </div>
  );
}

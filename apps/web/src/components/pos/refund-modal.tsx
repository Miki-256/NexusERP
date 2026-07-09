"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isBrowserOnline } from "@/lib/offline/network";
import { ArrowLeft, Gift, RotateCcw, X } from "lucide-react";
import { usePosModal } from "./use-pos-modal";

type SessionSale = {
  id: string;
  receiptNo: string;
  total: number;
  status: string;
  customerName: string | null;
  customerId?: string | null;
  createdAt: string;
};

type SaleLine = {
  id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  returned_quantity: number;
  line_total: number;
};

type RefundMethod = "cash" | "store_credit";

export function RefundModal({
  sessionId,
  currency,
  sessionToken,
  staffRole,
  canVoidAsManager,
  onClose,
  onVoided,
}: {
  sessionId: string;
  currency: string;
  sessionToken?: string;
  staffRole?: string;
  canVoidAsManager: boolean;
  onClose: () => void;
  onVoided: () => void;
}) {
  const [sales, setSales] = useState<SessionSale[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<SessionSale | null>(null);
  const [saleLines, setSaleLines] = useState<SaleLine[]>([]);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("cash");
  const [reason, setReason] = useState("");

  const canVoid = canVoidAsManager || staffRole === "manager";
  const hasCustomer = Boolean(selectedSale?.customerId ?? selectedSale?.customerName);

  const loadSales = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_pos_session_sales", {
      p_session_id: sessionId,
      p_session_token: sessionToken ?? null,
      p_limit: 50,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSales((data as SessionSale[] | null) ?? []);
  }, [sessionId, sessionToken]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  async function openReturnFlow(sale: SessionSale) {
    setError(null);
    setSelectedSale(sale);
    setReason("");
    setRefundMethod("cash");
    setReturnQty({});
    setBusy(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_pos_sale_receipt", {
      p_sale_id: sale.id,
      p_session_token: sessionToken ?? null,
    });
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      setSelectedSale(null);
      return;
    }

    const payload = data as { sale?: { customer_id?: string | null }; lines?: SaleLine[] };
    if (payload.sale?.customer_id) {
      setSelectedSale({ ...sale, customerId: payload.sale.customer_id });
    }

    const lines = (payload.lines ?? []).map((line) => ({
      ...line,
      returned_quantity: Number(line.returned_quantity) || 0,
      quantity: Number(line.quantity),
      line_total: Number(line.line_total),
    }));
    setSaleLines(lines);
    const initial: Record<string, number> = {};
    for (const line of lines) {
      const available = line.quantity - line.returned_quantity;
      if (available > 0) initial[line.id] = 0;
    }
    setReturnQty(initial);
  }

  const filtered = sales.filter((s) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      s.receiptNo.toLowerCase().includes(q) ||
      (s.customerName?.toLowerCase().includes(q) ?? false)
    );
  });

  const selectedReturnLines = useMemo(
    () =>
      saleLines
        .map((line) => ({
          saleLineId: line.id,
          quantity: returnQty[line.id] ?? 0,
          line,
        }))
        .filter((entry) => entry.quantity > 0),
    [saleLines, returnQty]
  );

  const estimatedRefund = useMemo(() => {
    return selectedReturnLines.reduce((sum, entry) => {
      const { line, quantity } = entry;
      if (line.quantity <= 0) return sum;
      return sum + line.line_total * (quantity / line.quantity);
    }, 0);
  }, [selectedReturnLines]);

  const isFullReturn = useMemo(() => {
    if (saleLines.length === 0 || selectedReturnLines.length === 0) return false;
    return saleLines.every((line) => {
      const available = line.quantity - line.returned_quantity;
      return available <= 0 || (returnQty[line.id] ?? 0) >= available;
    });
  }, [saleLines, returnQty, selectedReturnLines.length]);

  async function submitReturn() {
    if (!selectedSale || !canVoid || !sessionToken) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("Enter a reason for the return.");
      return;
    }
    if (!isBrowserOnline()) {
      setError("Connect to the internet to process returns.");
      return;
    }
    if (selectedReturnLines.length === 0) {
      setError("Select at least one item to return.");
      return;
    }
    if (refundMethod === "store_credit" && !hasCustomer) {
      setError("Store credit refund requires a customer on the sale.");
      return;
    }

    setBusy(true);
    setError(null);
    const supabase = createClient();

    if (isFullReturn) {
      const { error: voidError } = await supabase.rpc("void_sale_pos", {
        p_sale_id: selectedSale.id,
        p_reason: trimmedReason,
        p_session_token: sessionToken,
        p_refund_method: refundMethod,
      });
      setBusy(false);
      if (voidError) {
        setError(voidError.message);
        return;
      }
    } else {
      const { error: returnError } = await supabase.rpc("partial_return_sale", {
        p_sale_id: selectedSale.id,
        p_lines: selectedReturnLines.map((entry) => ({
          saleLineId: entry.saleLineId,
          quantity: entry.quantity,
        })),
        p_reason: trimmedReason,
        p_session_token: sessionToken,
        p_refund_method: refundMethod,
      });
      setBusy(false);
      if (returnError) {
        setError(returnError.message);
        return;
      }
    }

    setSelectedSale(null);
    setSaleLines([]);
    await loadSales();
    onVoided();
  }

  function fillAllRemaining() {
    const next: Record<string, number> = {};
    for (const line of saleLines) {
      next[line.id] = Math.max(0, line.quantity - line.returned_quantity);
    }
    setReturnQty(next);
  }

  const panelRef = usePosModal(onClose);

  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-refund-title"
        className="pos-modal-panel flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="pos-header flex items-center justify-between px-5 py-4">
          <div>
            <h2 id="pos-refund-title" className="pos-heading text-lg font-bold text-white">
              {selectedSale ? "Process return" : "Void / refund"}
            </h2>
            <p className="text-xs text-white/70">
              {selectedSale ? selectedSale.receiptNo : "Current shift sales"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 text-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Close refund dialog"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {!selectedSale ? (
          <>
            <div className="border-b border-slate-100 p-4">
              <Input
                placeholder="Filter by receipt or customer…"
                aria-label="Filter sales by receipt or customer"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {!canVoid && (
                <p className="mt-2 text-xs text-amber-700">Manager access required to void or return sales.</p>
              )}
            </div>

            <ul className="flex-1 overflow-y-auto p-2" aria-live="polite">
              {loading && (
                <li className="p-4 text-center text-sm text-slate-500" role="status" aria-busy="true">
                  Loading…
                </li>
              )}
              {!loading && filtered.length === 0 && (
                <li className="p-8 text-center text-sm text-slate-500">No sales this shift</li>
              )}
              {filtered.map((s) => (
                <li
                  key={s.id}
                  className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{s.receiptNo}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(s.createdAt).toLocaleString()}
                      {s.customerName ? ` · ${s.customerName}` : ""}
                    </p>
                    <span
                      className={
                        s.status === "completed"
                          ? "text-xs font-medium text-emerald-700"
                          : "text-xs font-medium text-amber-700"
                      }
                    >
                      {s.status}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-bold tabular-nums">{formatCurrency(s.total, currency)}</span>
                    {(s.status === "completed" || s.status === "returned") && canVoid && sessionToken && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="cursor-pointer gap-1"
                        disabled={busy}
                        onClick={() => void openReturnFlow(s)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Return
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedSale(null);
                  setSaleLines([]);
                  setError(null);
                }}
                className="flex cursor-pointer items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sales
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-4 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">Select items to return</p>
                <Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={fillAllRemaining}>
                  Return all remaining
                </Button>
              </div>

              <ul className="space-y-2">
                {saleLines.map((line) => {
                  const available = line.quantity - line.returned_quantity;
                  if (available <= 0) return null;
                  return (
                    <li key={line.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{line.product_name}</p>
                          {line.variant_name && line.variant_name !== "Default" && (
                            <p className="truncate text-xs text-slate-500">{line.variant_name}</p>
                          )}
                          <p className="text-xs text-slate-500">
                            Sold {line.quantity}
                            {line.returned_quantity > 0 ? ` · ${line.returned_quantity} already returned` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {formatCurrency(line.line_total, currency)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-slate-500">Return qty</Label>
                        <Input
                          type="number"
                          min={0}
                          max={available}
                          step={1}
                          className="h-9 w-20"
                          value={returnQty[line.id] ?? 0}
                          onChange={(e) => {
                            const next = Math.min(available, Math.max(0, parseInt(e.target.value, 10) || 0));
                            setReturnQty((prev) => ({ ...prev, [line.id]: next }));
                          }}
                        />
                        <span className="text-xs text-slate-500">/ {available}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                <Label className="text-sm font-semibold">Refund method</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRefundMethod("cash")}
                    aria-pressed={refundMethod === "cash"}
                    className={`cursor-pointer rounded-xl border px-3 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary ${
                      refundMethod === "cash"
                        ? "border-pos-primary bg-pos-primary-soft-8 text-pos-primary"
                        : "border-slate-200 text-slate-700"
                    }`}
                  >
                    Cash / original
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefundMethod("store_credit")}
                    disabled={!hasCustomer}
                    aria-pressed={refundMethod === "store_credit"}
                    className={`cursor-pointer rounded-xl border px-3 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                      refundMethod === "store_credit"
                        ? "border-pos-primary bg-pos-primary-soft-8 text-pos-primary"
                        : "border-slate-200 text-slate-700"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Gift className="h-4 w-4" />
                      Store credit
                    </span>
                  </button>
                </div>
                {!hasCustomer && (
                  <p className="text-xs text-slate-500">Store credit requires a customer on the sale.</p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="return-reason">Reason</Label>
                  <Input
                    id="return-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Damaged item, wrong size, etc."
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-600">Estimated refund</span>
                  <span className="font-bold tabular-nums text-pos-primary">
                    {formatCurrency(estimatedRefund, currency)}
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 p-4">
              <Button
                className="mb-2 w-full cursor-pointer"
                disabled={busy || selectedReturnLines.length === 0}
                aria-busy={busy}
                onClick={() => void submitReturn()}
              >
                {busy ? "Processing…" : isFullReturn ? "Complete full return" : "Process partial return"}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="px-4 pb-2 text-sm text-red-600">{error}</p>}

        {!selectedSale && (
          <div className="border-t border-slate-100 p-4">
            <Button variant="outline" className="w-full cursor-pointer" onClick={onClose}>
              Close (Esc)
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

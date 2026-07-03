"use client";

import { formatCurrency } from "@/lib/utils";
import type { CartLine } from "@/stores/cart-store";
import { calcCartTotals } from "@/stores/cart-store";
import { X } from "lucide-react";

export type HeldCart = {
  id: string;
  lines: CartLine[];
  discount: number;
  promoDiscount?: number;
  heldAt: number;
};

export function HeldCartPickerModal({
  heldCarts,
  currency,
  taxRate,
  taxInclusive,
  onRecall,
  onClose,
}: {
  heldCarts: HeldCart[];
  currency: string;
  taxRate: number;
  taxInclusive: boolean;
  onRecall: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="pos-heading text-lg font-bold text-slate-900">Held sales</h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto p-3">
          {[...heldCarts].reverse().map((held, index) => {
            const itemCount = held.lines.reduce((s, l) => s + l.quantity, 0);
            const { total } = calcCartTotals(
              held.lines,
              held.discount,
              taxRate,
              taxInclusive,
              held.promoDiscount ?? 0
            );
            const label = held.lines[0]?.productName ?? "Empty";
            return (
              <li key={held.id}>
                <button
                  type="button"
                  onClick={() => {
                    onRecall(held.id);
                    onClose();
                  }}
                  className="mb-2 flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-pos-primary/40 hover:bg-pos-primary-soft-8"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      Hold #{heldCarts.length - index} · {itemCount} item{itemCount === 1 ? "" : "s"}
                    </p>
                    <p className="truncate text-xs text-slate-500">{label}</p>
                    <p className="text-[11px] text-slate-400">
                      {new Date(held.heldAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-pos-navy">
                    {formatCurrency(total, currency)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

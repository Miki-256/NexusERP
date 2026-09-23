"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/utils";
import type { CartLine } from "@/stores/cart-store";
import { calcCartTotals } from "@/stores/cart-store";
import { X } from "lucide-react";
import { usePosModal } from "./use-pos-modal";

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
  const t = useTranslations("pos");
  const panelRef = usePosModal(onClose);

  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-held-carts-title"
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id="pos-held-carts-title" className="pos-heading text-lg font-bold text-slate-900">
            {t("heldSales")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary"
            aria-label={t("closeHeldSales")}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-3">
          {[...heldCarts].reverse().map((held, index) => {
            const itemCount = held.lines.reduce((s, l) => s + l.quantity, 0);
            const { total } = calcCartTotals(
              held.lines,
              held.discount,
              taxRate,
              taxInclusive,
              held.promoDiscount ?? 0
            );
            const label = held.lines[0]?.productName ?? t("emptyCart");
            const holdNumber = heldCarts.length - index;
            const itemsLabel = itemCount === 1 ? t("itemSingular") : t("itemPlural");
            return (
              <li key={held.id}>
                <button
                  type="button"
                  onClick={() => {
                    onRecall(held.id);
                    onClose();
                  }}
                  aria-label={t("recallHoldAria", {
                    number: holdNumber,
                    count: itemCount,
                    amount: formatCurrency(total, currency),
                  })}
                  className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-pos-primary/40 hover:bg-pos-primary-soft-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {t("holdNumberItems", {
                        number: holdNumber,
                        count: itemCount,
                        items: itemsLabel,
                      })}
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

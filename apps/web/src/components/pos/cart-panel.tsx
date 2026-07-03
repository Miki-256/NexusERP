"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import type { CartLine } from "@/stores/cart-store";
import { merchandiseSubtotal, clampLineDiscount, lineGross } from "@/lib/pos/discount-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Minus,
  Plus,
  Trash2,
  Pause,
  Play,
  ShoppingCart,
  User,
  Clock,
  Hash,
  Search,
  X,
  Gift,
  ChevronDown,
  ChevronUp,
  Tag,
} from "lucide-react";
import type { PosCatalogItem } from "./product-card";
import { stockWarningForLine } from "@/lib/pos/stock-utils";

export function CartPanel({
  lines,
  currency,
  subtotal,
  tax,
  cartDiscount,
  promoDiscount = 0,
  promoCode,
  promotionName,
  promoBusy = false,
  promoError,
  onApplyPromo,
  onClearPromo,
  total,
  heldCount,
  customerName,
  customerPhone,
  customerCreditBalance,
  customerReceivableBalance,
  customerOnAccountEnabled,
  customerCreditAvailable,
  catalogByVariant,
  onCustomerLookup,
  onClearCustomer,
  onCustomerName,
  onCustomerPhone,
  onUpdateQty,
  onRemove,
  onDiscount,
  onCartDiscount,
  onHold,
  onRecallHeld,
  onCheckout,
  orderNumber,
  onCloseMobile,
  className,
  maxCashierDiscountPct = 15,
  discountPct = 0,
  needsManagerOverride = false,
}: {
  lines: CartLine[];
  currency: string;
  subtotal: number;
  tax: number;
  cartDiscount: number;
  promoDiscount?: number;
  promoCode?: string | null;
  promotionName?: string | null;
  promoBusy?: boolean;
  promoError?: string | null;
  onApplyPromo?: (code: string) => void;
  onClearPromo?: () => void;
  total: number;
  heldCount: number;
  customerName: string;
  customerPhone: string;
  customerCreditBalance?: number;
  customerReceivableBalance?: number;
  customerOnAccountEnabled?: boolean;
  customerCreditAvailable?: number | null;
  catalogByVariant: Map<string, PosCatalogItem>;
  onCustomerLookup: () => void;
  onClearCustomer: () => void;
  onCustomerName: (v: string) => void;
  onCustomerPhone: (v: string) => void;
  onUpdateQty: (variantId: string, qty: number) => void;
  onRemove: (variantId: string) => void;
  onDiscount: (variantId: string, amount: number) => void;
  onCartDiscount: (amount: number) => void;
  onHold: () => void;
  onRecallHeld: () => void;
  onCheckout: () => void;
  orderNumber: string;
  onCloseMobile?: () => void;
  className?: string;
  maxCashierDiscountPct?: number;
  discountPct?: number;
  needsManagerOverride?: boolean;
}) {
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [promoInput, setPromoInput] = useState(promoCode ?? "");
  const [orderDiscountMode, setOrderDiscountMode] = useState<"amount" | "percent">("amount");
  const [orderDiscountInput, setOrderDiscountInput] = useState("");
  const [showAdjustments, setShowAdjustments] = useState(false);

  const hasAdjustments =
    cartDiscount > 0 || promoDiscount > 0 || Boolean(promoCode) || Boolean(promoError);

  useEffect(() => {
    if (hasAdjustments) setShowAdjustments(true);
  }, [hasAdjustments]);

  const merchSubtotal = useMemo(() => merchandiseSubtotal(lines), [lines]);

  useEffect(() => {
    if (orderDiscountMode !== "percent") return;
    const pct = parseFloat(orderDiscountInput);
    if (!Number.isFinite(pct) || pct <= 0 || merchSubtotal <= 0) return;
    const next = Math.round(merchSubtotal * (Math.min(pct, 100) / 100) * 100) / 100;
    if (Math.abs(next - cartDiscount) > 0.001) {
      onCartDiscount(next);
    }
    // Recalculate stored amount when line totals change; keep % input unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchSubtotal]);

  useEffect(() => {
    if (cartDiscount <= 0) {
      setOrderDiscountInput("");
      return;
    }
    const localParsed = parseFloat(orderDiscountInput);
    if (Number.isFinite(localParsed) && localParsed > 0) {
      const localAsAmount =
        orderDiscountMode === "percent" && merchSubtotal > 0
          ? merchSubtotal * (Math.min(localParsed, 100) / 100)
          : localParsed;
      if (Math.abs(localAsAmount - cartDiscount) <= 0.02) return;
    }
    setOrderDiscountInput(
      orderDiscountMode === "percent" && merchSubtotal > 0
        ? String(Math.round((cartDiscount / merchSubtotal) * 10000) / 100)
        : String(cartDiscount)
    );
    // Sync input when discount is set externally (e.g. held cart recall).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartDiscount, orderDiscountMode]);

  function applyOrderDiscount(raw: string, mode: "amount" | "percent") {
    setOrderDiscountInput(raw);
    const parsed = parseFloat(raw);
    if (!raw.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      onCartDiscount(0);
      return;
    }
    if (mode === "percent") {
      const pct = Math.min(parsed, 100);
      onCartDiscount(Math.round(merchSubtotal * (pct / 100) * 100) / 100);
      return;
    }
    onCartDiscount(Math.min(parsed, merchSubtotal));
  }

  function switchOrderDiscountMode(mode: "amount" | "percent") {
    if (mode === orderDiscountMode) return;
    setOrderDiscountMode(mode);
    if (cartDiscount <= 0) {
      setOrderDiscountInput("");
      return;
    }
    if (mode === "percent" && merchSubtotal > 0) {
      setOrderDiscountInput(String(Math.round((cartDiscount / merchSubtotal) * 10000) / 100));
    } else {
      setOrderDiscountInput(String(cartDiscount));
    }
  }

  return (
    <aside
      className={cn(
        "flex min-h-0 w-full flex-1 flex-col bg-white shadow-[-8px_0_32px_rgb(15_23_42/0.06)] lg:h-full lg:w-[var(--pos-cart-width)] lg:max-w-[var(--pos-cart-width)] lg:flex-none lg:shrink-0",
        className
      )}
    >
      {/* Cart header — compact so line items get more room */}
      <div className="pos-cart-header shrink-0 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
              <ShoppingCart className="h-4 w-4 text-white" />
              {lines.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-pos-primary px-0.5 text-[9px] font-bold text-white">
                  {lines.reduce((s, l) => s + l.quantity, 0)}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="pos-heading truncate text-sm font-semibold text-white">Current sale</p>
              <p className="flex items-center gap-1.5 text-[11px] text-white/70">
                <Hash className="h-3 w-3 shrink-0" />
                {orderNumber}
                <span className="text-white/30">·</span>
                <Clock className="h-3 w-3 shrink-0" />
                {now}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-white/20 text-white/80 hover:bg-white/10 lg:hidden"
                aria-label="Close cart"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 cursor-pointer text-white hover:bg-white/15 hover:text-white"
              onClick={onHold}
              title="Hold sale"
            >
              <Pause className="h-4 w-4" />
            </Button>
            {heldCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 cursor-pointer gap-1 border-white/25 bg-white/10 px-2 text-xs text-white hover:bg-white/20 hover:text-white"
                onClick={onRecallHeld}
              >
                <Play className="h-3.5 w-3.5" />
                {heldCount}
              </Button>
            )}
          </div>
        </div>

        {/* Customer — single compact row */}
        <div className="mt-2.5 space-y-1.5">
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 min-w-0 flex-1 cursor-pointer gap-1.5 truncate border-white/25 bg-white/10 px-2 text-xs text-white hover:bg-white/20"
              onClick={onCustomerLookup}
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{customerName || "Find customer (F5)"}</span>
            </Button>
            {customerName && (
              <button
                type="button"
                onClick={onClearCustomer}
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/20 text-white/70 hover:bg-white/10"
                title="Clear customer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {!customerName && (
            <div className="flex gap-1.5">
              <Input
                placeholder="Walk-in name"
                value={customerName}
                onChange={(e) => onCustomerName(e.target.value)}
                className="h-8 flex-1 rounded-lg border-white/20 bg-white/10 text-xs text-white placeholder:text-white/50"
              />
              <Input
                placeholder="Phone"
                value={customerPhone}
                onChange={(e) => onCustomerPhone(e.target.value)}
                className="h-8 w-[5.5rem] rounded-lg border-white/20 bg-white/10 text-xs text-white placeholder:text-white/50"
              />
            </div>
          )}
          {customerCreditBalance != null && customerCreditBalance > 0 && (
            <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-200">
              <Gift className="h-3 w-3" />
              Credit: {formatCurrency(customerCreditBalance, currency)}
            </p>
          )}
          {customerOnAccountEnabled ? (
            <p className="flex items-center gap-1 text-[11px] font-medium text-amber-200">
              <Clock className="h-3 w-3" />
              {customerReceivableBalance != null && customerReceivableBalance > 0
                ? `Owes ${formatCurrency(customerReceivableBalance, currency)}`
                : customerCreditAvailable != null
                  ? `Pay later: ${formatCurrency(customerCreditAvailable, currency)}`
                  : "Pay later enabled"}
            </p>
          ) : customerName ? (
            <p className="text-[11px] text-amber-200/90">Pay later not enabled</p>
          ) : null}
        </div>
      </div>

      {/* Line items — flex-1 scroll area */}
      <ul className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 p-3">
        {lines.length === 0 ? (
          <li className="flex h-full min-h-[120px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white text-center">
            <ShoppingCart className="mb-2 h-10 w-10 text-slate-200" />
            <p className="pos-heading text-sm font-semibold text-slate-500">Cart is empty</p>
            <p className="mt-0.5 text-xs text-slate-400">Tap products to add items</p>
          </li>
        ) : (
          lines.map((line) => {
            const lineTotal = line.unitPrice * line.quantity - line.discountAmount;
            const catalogItem = catalogByVariant.get(line.variantId);
            const stockWarn = stockWarningForLine(catalogItem, line.quantity);
            return (
              <li
                key={line.variantId}
                className="pos-cart-item mb-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">{line.productName}</p>
                    {stockWarn && (
                      <p className="mt-0.5 text-[11px] font-semibold text-amber-700">{stockWarn}</p>
                    )}
                    {line.variantName && line.variantName !== "Default" && (
                      <p className="truncate text-[11px] font-medium text-slate-500">{line.variantName}</p>
                    )}
                    <p className="text-[11px] text-slate-500">
                      {formatCurrency(line.unitPrice, currency)} × {line.quantity}
                    </p>
                  </div>
                  <p className="pos-heading shrink-0 text-sm font-bold tabular-nums text-pos-navy">
                    {formatCurrency(lineTotal, currency)}
                  </p>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    <button
                      type="button"
                      className="flex h-9 w-9 cursor-pointer items-center justify-center text-slate-600 transition-colors hover:bg-white"
                      onClick={() => onUpdateQty(line.variantId, line.quantity - 1)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[2rem] text-center font-mono text-sm font-bold">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      className="flex h-9 w-9 cursor-pointer items-center justify-center text-slate-600 transition-colors hover:bg-white"
                      onClick={() => onUpdateQty(line.variantId, line.quantity + 1)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min="0"
                      max={lineGross(line)}
                      step="0.01"
                      placeholder="Disc."
                      title={`Line discount (max ${formatCurrency(lineGross(line), currency)})`}
                      className="h-9 w-14 rounded-lg text-xs"
                      value={line.discountAmount || ""}
                      onChange={(e) =>
                        onDiscount(
                          line.variantId,
                          clampLineDiscount(line, parseFloat(e.target.value) || 0)
                        )
                      }
                    />
                    <button
                      type="button"
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50"
                      onClick={() => onRemove(line.variantId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>

      {/* Summary + checkout — compact footer */}
      <div className="shrink-0 border-t border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between text-sm">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-medium text-slate-600">
            <span>
              Subtotal{" "}
              <span className="tabular-nums text-slate-900">{formatCurrency(subtotal, currency)}</span>
            </span>
            <span>
              Tax{" "}
              <span className="tabular-nums text-slate-900">{formatCurrency(tax, currency)}</span>
            </span>
            {(cartDiscount > 0 || promoDiscount > 0) && (
              <span className="text-emerald-700">
                Disc{" "}
                <span className="tabular-nums">
                  −{formatCurrency(cartDiscount + promoDiscount, currency)}
                </span>
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAdjustments((v) => !v)}
          className="mt-2 flex w-full cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-100"
        >
          <span className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            Discounts & promo
            {hasAdjustments && (
              <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                Active
              </span>
            )}
          </span>
          {showAdjustments ? (
            <ChevronUp className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" />
          )}
        </button>

        {showAdjustments && (
          <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Order discount</span>
              <div className="flex items-center gap-1.5">
                <div className="flex overflow-hidden rounded-md border border-slate-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => switchOrderDiscountMode("percent")}
                    className={cn(
                      "cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors",
                      orderDiscountMode === "percent"
                        ? "bg-pos-primary text-white"
                        : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => switchOrderDiscountMode("amount")}
                    className={cn(
                      "cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors",
                      orderDiscountMode === "amount"
                        ? "bg-pos-primary text-white"
                        : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    {currency}
                  </button>
                </div>
                <Input
                  type="number"
                  min="0"
                  max={orderDiscountMode === "percent" ? 100 : undefined}
                  step={orderDiscountMode === "percent" ? 0.5 : 0.01}
                  placeholder={orderDiscountMode === "percent" ? "0" : "0.00"}
                  className="h-8 w-20 rounded-lg text-right text-xs"
                  value={orderDiscountInput}
                  onChange={(e) => applyOrderDiscount(e.target.value, orderDiscountMode)}
                />
              </div>
            </div>
            {cartDiscount > 0 && orderDiscountMode === "percent" && (
              <p className="text-right text-[11px] text-slate-500">
                −{formatCurrency(cartDiscount, currency)} off order
              </p>
            )}
            {onApplyPromo && (
              <div className="space-y-1.5 border-t border-slate-200 pt-2">
                {promoCode ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-pos-primary">{promoCode}</p>
                      {promotionName && (
                        <p className="truncate text-[11px] text-slate-500">{promotionName}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-emerald-700">
                        −{formatCurrency(promoDiscount, currency)}
                      </span>
                      {onClearPromo && (
                        <button
                          type="button"
                          onClick={onClearPromo}
                          className="cursor-pointer rounded p-0.5 text-slate-400 hover:text-slate-600"
                          aria-label="Remove promotion"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <Input
                      placeholder="Promo code"
                      value={promoInput}
                      onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                      className="h-8 flex-1 rounded-lg text-xs uppercase"
                      disabled={promoBusy || lines.length === 0}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 cursor-pointer px-2.5 text-xs"
                      disabled={promoBusy || !promoInput.trim() || lines.length === 0}
                      onClick={() => onApplyPromo(promoInput.trim())}
                    >
                      {promoBusy ? "…" : "Apply"}
                    </Button>
                  </div>
                )}
                {promoError && <p className="text-[11px] text-red-600">{promoError}</p>}
              </div>
            )}
            {lines.length > 0 && (
              <p
                className={cn(
                  "text-[11px]",
                  needsManagerOverride ? "font-semibold text-amber-700" : "text-slate-500"
                )}
              >
                Discount {discountPct.toFixed(1)}% · limit {maxCashierDiscountPct}%
                {needsManagerOverride && " · PIN required"}
              </p>
            )}
          </div>
        )}

        <div className="mt-2.5 flex items-baseline justify-between rounded-xl bg-pos-primary-soft-8 px-3 py-2">
          <span className="text-xs font-semibold text-slate-600">Total due</span>
          <span className="pos-heading text-2xl font-bold tabular-nums tracking-tight text-pos-primary">
            {formatCurrency(total, currency)}
          </span>
        </div>

        <button
          type="button"
          disabled={lines.length === 0}
          onClick={onCheckout}
          className={cn(
            "pos-checkout-btn mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-bold text-white",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          )}
        >
          Checkout · {formatCurrency(total, currency)}
        </button>
      </div>
    </aside>
  );
}

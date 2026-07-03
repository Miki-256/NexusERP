"use client";

import { useEffect, useMemo, useState } from "react";
import type { CartLine } from "@/stores/cart-store";
import { formatCurrency, cn } from "@/lib/utils";
import {
  getDefaultPaymentMethod,
  setDefaultPaymentMethod,
  type PosPaymentMethodPreference,
} from "@/lib/pos/pos-preferences";
import {
  publishCustomerDisplay,
} from "@/lib/pos/customer-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOfflineOptional } from "@/components/offline/offline-provider";
import { cartLinesToRpc, type CompleteSalePayload, type RpcPayment } from "@/lib/offline/types";
import { isBrowserOnline } from "@/lib/offline/network";
import { queueOfflineSale, submitCompleteSale } from "@/lib/offline/sale-api";
import { parsePlanLimitError, planLimitToastDescription } from "@/lib/plan-errors";
import {
  Banknote,
  Smartphone,
  Building2,
  Gift,
  X,
  Plus,
  CheckCircle2,
  WifiOff,
  Clock,
  ChevronDown,
  ChevronUp,
  Receipt,
  Heart,
} from "lucide-react";

const PROVIDERS = [
  { value: "telebirr", label: "Telebirr" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "cbe_birr", label: "CBE Birr" },
  { value: "m_pesa", label: "M-Pesa (alt)" },
  { value: "other", label: "Other" },
] as const;

type PaymentRow = {
  method: "cash" | "mobile_money" | "bank_transfer" | "store_credit" | "on_account";
  amount: number;
  cashTendered?: number;
  changeGiven?: number;
  provider?: string;
  reference?: string;
  phone?: string;
  bankName?: string;
};

const STANDARD_METHODS = [
  { id: "cash" as const, label: "Cash", icon: Banknote, desc: "Physical currency" },
  { id: "mobile_money" as const, label: "Mobile Money", icon: Smartphone, desc: "Telebirr, M-Pesa…" },
  { id: "bank_transfer" as const, label: "Bank Transfer", icon: Building2, desc: "Wire / transfer" },
];

const CUSTOMER_METHODS = [
  { id: "store_credit" as const, label: "Store Credit", icon: Gift, desc: "Prepaid balance" },
  { id: "on_account" as const, label: "Pay Later", icon: Clock, desc: "Buy now, pay later" },
] as const;

type PaymentMethodId = (typeof STANDARD_METHODS)[number]["id"] | (typeof CUSTOMER_METHODS)[number]["id"];

export function PaymentModal({
  total,
  subtotal,
  tax,
  promoDiscount = 0,
  currency,
  lines,
  cartDiscount,
  promoCode,
  registerId,
  storeId,
  sessionId,
  organizationId,
  orgName,
  storeName,
  customerName,
  customerPhone,
  customerId,
  customerCreditBalance = 0,
  customerOnAccountEnabled = false,
  customerCreditAvailable = null as number | null,
  customerReceivableBalance = 0,
  tipsEnabled = false,
  tipPresets = [10, 15, 20],
  onClose,
  onComplete,
  posSessionToken,
  posStaffId,
  managerDiscountPin,
}: {
  total: number;
  subtotal: number;
  tax: number;
  promoDiscount?: number;
  currency: string;
  lines: CartLine[];
  cartDiscount: number;
  promoCode?: string | null;
  registerId: string;
  storeId: string;
  sessionId: string;
  organizationId: string;
  orgName: string;
  storeName: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerId?: string | null;
  customerCreditBalance?: number;
  customerOnAccountEnabled?: boolean;
  customerCreditAvailable?: number | null;
  customerReceivableBalance?: number;
  tipsEnabled?: boolean;
  tipPresets?: number[];
  onClose: () => void;
  onComplete: (result: {
    receipt_no: string;
    total: number;
    sale_id: string;
    tipAmount?: number;
    pendingSync?: boolean;
    changeDue?: number;
    offlinePayments?: {
      method: string;
      amount: number;
      reference: string | null;
      cash_tendered: number | null;
      change_given: number | null;
    }[];
  }) => void;
  posSessionToken?: string;
  posStaffId?: string;
  managerDiscountPin?: string | null;
}) {
  const [method, setMethod] = useState<PaymentMethodId>(() => {
    const saved = getDefaultPaymentMethod(registerId);
    if (saved === "store_credit" || saved === "on_account") return "cash";
    return saved ?? "cash";
  });
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [cashTendered, setCashTendered] = useState("");
  const [reference, setReference] = useState("");
  const [provider, setProvider] = useState("telebirr");
  const [phone, setPhone] = useState(customerPhone ?? "");
  const [bankName, setBankName] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOrderSummary, setShowOrderSummary] = useState(true);
  const [showSplitPay, setShowSplitPay] = useState(false);
  const [tipAmount, setTipAmount] = useState(0);
  const [customTipInput, setCustomTipInput] = useState("");
  const [activeTipPct, setActiveTipPct] = useState<number | null>(null);
  const [changeGivenInput, setChangeGivenInput] = useState("");
  const offline = useOfflineOptional();
  const checkoutOffline = offline ? !offline.online : !isBrowserOnline();

  const cashReceivedNum = parseFloat(cashTendered);
  const cashChangeNum = parseFloat(changeGivenInput);
  const autoTipFromCash = useMemo(() => {
    if (
      !tipsEnabled ||
      !Number.isFinite(cashReceivedNum) ||
      changeGivenInput.trim() === "" ||
      !Number.isFinite(cashChangeNum)
    ) {
      return 0;
    }
    return Math.max(0, Math.round((cashReceivedNum - cashChangeNum - total) * 100) / 100);
  }, [tipsEnabled, cashReceivedNum, cashChangeNum, changeGivenInput, total]);

  const payTotal = total + tipAmount;

  const lineDiscountTotal = useMemo(
    () => lines.reduce((s, l) => s + l.discountAmount, 0),
    [lines]
  );
  const orderDiscountTotal = cartDiscount + lineDiscountTotal;

  const displayLines = useMemo(
    () =>
      lines.map((l) => ({
        name: l.productName,
        qty: l.quantity,
        total: l.unitPrice * l.quantity - l.discountAmount,
      })),
    [lines]
  );

  function pushDisplay(phase: "checkout" | "paying") {
    publishCustomerDisplay({
      registerId,
      orgName,
      storeName,
      currency,
      phase,
      lines: displayLines,
      subtotal,
      tax,
      discount: orderDiscountTotal,
      promoDiscount,
      tipAmount,
      total: payTotal,
      updatedAt: Date.now(),
    });
  }

  useEffect(() => {
    pushDisplay("checkout");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tipsEnabled || method !== "cash" || payments.length > 0) return;
    setTipAmount(autoTipFromCash);
    setCustomTipInput(autoTipFromCash > 0 ? String(autoTipFromCash) : "");
    setActiveTipPct(null);
  }, [autoTipFromCash, tipsEnabled, method, payments.length]);

  useEffect(() => {
    pushDisplay("checkout");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipAmount, payTotal]);

  useEffect(() => {
    if (loading) pushDisplay("paying");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function applyTipPercent(pct: number) {
    const next = Math.round(total * (pct / 100) * 100) / 100;
    setTipAmount(next);
    setActiveTipPct(pct);
    setCustomTipInput(String(next));
    setError(null);
  }

  function applyCustomTip(raw: string) {
    setCustomTipInput(raw);
    setActiveTipPct(null);
    const parsed = parseFloat(raw);
    if (!raw.trim() || !Number.isFinite(parsed) || parsed < 0) {
      setTipAmount(0);
      return;
    }
    setTipAmount(Math.round(parsed * 100) / 100);
    setError(null);
  }

  function clearTip() {
    setTipAmount(0);
    setCustomTipInput("");
    setActiveTipPct(null);
    setChangeGivenInput("");
  }

  function fillExactCash() {
    if (tipsEnabled && method === "cash" && payments.length === 0) {
      setCashTendered(String(total));
      setChangeGivenInput("0");
      setError(null);
      return;
    }
    const due = remaining || payTotal;
    setAmount(String(due));
    setCashTendered(String(due));
    setError(null);
  }

  function buildCashPaymentFromInputs(): PaymentRow | null {
    const received = parseFloat(cashTendered);
    const change = parseFloat(changeGivenInput) || 0;
    if (!Number.isFinite(received)) return null;

    if (tipsEnabled && payments.length === 0) {
      if (changeGivenInput.trim() === "" || !Number.isFinite(change)) return null;
      if (received < change + total - 0.01) return null;
      const tip = Math.max(0, Math.round((received - change - total) * 100) / 100);
      const saleTotal = total + tip;
      return {
        method: "cash",
        amount: saleTotal,
        cashTendered: received,
        changeGiven: change,
      };
    }

    const due = parseFloat(amount) || remaining || payTotal;
    const tendered = received || due;
    return {
      method: "cash",
      amount: due,
      cashTendered: tendered,
      changeGiven: Math.max(0, tendered - due),
    };
  }
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, payTotal - paid);
  const totalChange = payments.reduce((s, p) => s + (p.changeGiven ?? 0), 0);
  const previewChange =
    tipsEnabled && method === "cash" && payments.length === 0
      ? cashChangeNum || 0
      : method === "cash" && cashTendered
        ? Math.max(0, parseFloat(cashTendered) - (parseFloat(amount) || remaining || payTotal))
        : 0;
  const cashCoversOrder =
    !tipsEnabled ||
    method !== "cash" ||
    payments.length > 0 ||
    (!Number.isFinite(cashReceivedNum) && !Number.isFinite(cashChangeNum)) ||
    cashReceivedNum - cashChangeNum >= total - 0.01;

  function rememberPaymentMethod(rows: PaymentRow[]) {
    const standard = rows.find(
      (p) =>
        p.method === "cash" ||
        p.method === "mobile_money" ||
        p.method === "bank_transfer"
    );
    if (standard) {
      setDefaultPaymentMethod(registerId, standard.method as PosPaymentMethodPreference);
    }
  }

  function addPayment() {
    const amt = parseFloat(amount) || remaining;
    if (amt <= 0) return;

    if (method === "store_credit") {
      if (!customerId) {
        setError("Select a customer before using store credit");
        return;
      }
      if (checkoutOffline) {
        setError("Store credit requires an internet connection");
        return;
      }
      const creditAvail = customerCreditBalance - payments.filter((p) => p.method === "store_credit").reduce((s, p) => s + p.amount, 0);
      if (amt > creditAvail + 0.01) {
        setError(`Only ${creditAvail.toFixed(2)} store credit available`);
        return;
      }
      setPayments([...payments, { method: "store_credit", amount: amt }]);
    } else if (method === "on_account") {
      if (!customerId) {
        setError("Select a customer before using pay later");
        return;
      }
      if (!customerOnAccountEnabled) {
        setError("Pay later is not enabled for this customer");
        return;
      }
      if (checkoutOffline) {
        setError("Pay later requires an internet connection");
        return;
      }
      const onAccountUsed = payments.filter((p) => p.method === "on_account").reduce((s, p) => s + p.amount, 0);
      const creditAvail =
        customerCreditAvailable != null
          ? Math.max(0, customerCreditAvailable - onAccountUsed)
          : Infinity;
      if (customerCreditAvailable != null && amt > creditAvail + 0.01) {
        setError(`Only ${creditAvail.toFixed(2)} credit available`);
        return;
      }
      setPayments([...payments, { method: "on_account", amount: amt }]);
    } else if (method === "cash") {
      const row = buildCashPaymentFromInputs();
      if (!row) {
        setError(
          tipsEnabled && payments.length === 0
            ? "Cash received must cover the order total plus change given"
            : "Enter a valid cash amount"
        );
        return;
      }
      setPayments([...payments, row]);
    } else if (method === "mobile_money") {
      if (!reference.trim()) {
        setError("Transaction reference is required");
        return;
      }
      setPayments([
        ...payments,
        {
          method: "mobile_money",
          amount: amt,
          provider,
          reference: reference.trim(),
          phone: phone || undefined,
        },
      ]);
    } else {
      if (!reference.trim()) {
        setError("Transfer reference is required");
        return;
      }
      setPayments([
        ...payments,
        {
          method: "bank_transfer",
          amount: amt,
          reference: reference.trim(),
          bankName: bankName || undefined,
        },
      ]);
    }
    setAmount("");
    setCashTendered("");
    setChangeGivenInput("");
    setReference("");
    setError(null);
  }

  async function completeSale() {
    let finalPayments = payments;
    let saleTip = tipAmount;

    if (payments.length === 0 && method === "cash") {
      const cashRow = buildCashPaymentFromInputs();
      if (!cashRow) {
        setError(
          tipsEnabled
            ? "Enter cash received and change given. Received must cover order total plus change."
            : "Enter cash tendered"
        );
        return;
      }
      finalPayments = [cashRow];
      saleTip = Math.max(0, Math.round((cashRow.amount - total) * 100) / 100);
    } else if (Math.abs(paid - payTotal) > 0.01 && payments.length === 0) {
      setError("Add payments that match the total");
      return;
    } else if (payments.length === 0) {
      finalPayments = [
        {
          method: "cash" as const,
          amount: payTotal,
          cashTendered: parseFloat(cashTendered) || payTotal,
          changeGiven: Math.max(0, (parseFloat(cashTendered) || payTotal) - payTotal),
        },
      ];
    }

    const saleTotal = total + saleTip;
    const paymentsSum = finalPayments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(paymentsSum - saleTotal) > 0.01) {
      setError(`Payment total ${paymentsSum} must equal ${saleTotal}`);
      return;
    }

    setLoading(true);
    setError(null);
    const idempotencyKey = crypto.randomUUID();

    const rpcPayments: RpcPayment[] = finalPayments.map((p) => {
      if (p.method === "cash") {
        return {
          method: "cash",
          amount: p.amount,
          cashTendered: p.cashTendered,
          changeGiven: p.changeGiven,
        };
      }
      if (p.method === "store_credit") {
        return { method: "store_credit", amount: p.amount };
      }
      if (p.method === "on_account") {
        return { method: "on_account", amount: p.amount };
      }
      if (p.method === "mobile_money") {
        return {
          method: "mobile_money",
          amount: p.amount,
          provider: p.provider,
          reference: p.reference,
          phone: p.phone,
        };
      }
      return {
        method: "bank_transfer",
        amount: p.amount,
        reference: p.reference,
        bankName: p.bankName,
      };
    });

    const rpcLines = cartLinesToRpc(lines);

    const payload: CompleteSalePayload = {
      organizationId,
      storeId,
      registerId,
      sessionId,
      idempotencyKey,
      lines: rpcLines,
      discountAmount: cartDiscount,
      tipAmount: saleTip,
      promotionCode: promoCode ?? null,
      customerName: customerName || null,
      customerPhone: customerPhone || null,
      customerId: customerId ?? null,
      payments: rpcPayments,
      posStaffId: posStaffId ?? null,
      posSessionToken: posSessionToken ?? null,
      managerDiscountPin: managerDiscountPin ?? null,
    };

    const offlinePayments = finalPayments.map((p) => ({
      method: p.method,
      amount: p.amount,
      reference: p.reference ?? null,
      cash_tendered: p.cashTendered ?? null,
      change_given: p.changeGiven ?? null,
    }));

    const changeDue = finalPayments.reduce((s, p) => s + (p.changeGiven ?? 0), 0);

    async function finishOffline() {
      const result = await queueOfflineSale(payload, saleTotal);
      rememberPaymentMethod(finalPayments);
      onComplete({
        sale_id: result.sale_id,
        receipt_no: result.receipt_no,
        total: result.total,
        tipAmount: saleTip,
        pendingSync: true,
        changeDue,
        offlinePayments,
      });
    }

    try {
      if (checkoutOffline) {
        await finishOffline();
        return;
      }

      const outcome = await submitCompleteSale(payload);

      if (outcome.ok) {
        rememberPaymentMethod(finalPayments);
        onComplete({
          sale_id: outcome.data.sale_id,
          receipt_no: outcome.data.receipt_no,
          total: outcome.data.total,
          tipAmount: saleTip,
          changeDue,
        });
        return;
      }

      if (outcome.network || !isBrowserOnline()) {
        await finishOffline();
        return;
      }

      setError(planLimitToastDescription(parsePlanLimitError({ message: outcome.message })));
    } catch {
      try {
        await finishOffline();
      } catch {
        setError("Could not save sale. Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="pos-modal-panel flex max-h-[95vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        {/* Header */}
        <div className="pos-header flex items-center justify-between px-6 py-5">
          <div>
            <h2 className="pos-heading text-xl font-bold text-white">Checkout</h2>
            {customerName && (
              <p className="text-xs text-white/70">Customer: {customerName}</p>
            )}
            {checkoutOffline && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-200">
                <WifiOff className="h-3 w-3" />
                Offline mode — sale saves locally and syncs later
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-xl p-2.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {/* Order summary */}
          <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setShowOrderSummary((v) => !v)}
              className="flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50"
            >
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                <Receipt className="h-3.5 w-3.5" />
                Order ({lines.length} item{lines.length === 1 ? "" : "s"})
              </span>
              {showOrderSummary ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </button>
            {showOrderSummary && (
              <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                <ul className="max-h-36 space-y-1.5 overflow-y-auto">
                  {lines.map((line) => (
                    <li
                      key={line.variantId}
                      className="flex justify-between gap-2 text-xs text-slate-700"
                    >
                      <span className="min-w-0 truncate">
                        {line.quantity}× {line.productName}
                      </span>
                      <span className="shrink-0 tabular-nums font-medium">
                        {formatCurrency(
                          line.unitPrice * line.quantity - line.discountAmount,
                          currency
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatCurrency(subtotal, currency)}</span>
                  </div>
                  {tax > 0 && (
                    <div className="flex justify-between">
                      <span>Tax</span>
                      <span className="tabular-nums">{formatCurrency(tax, currency)}</span>
                    </div>
                  )}
                  {orderDiscountTotal > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount</span>
                      <span className="tabular-nums">−{formatCurrency(orderDiscountTotal, currency)}</span>
                    </div>
                  )}
                  {promoDiscount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Promo{promoCode ? ` (${promoCode})` : ""}</span>
                      <span className="tabular-nums">−{formatCurrency(promoDiscount, currency)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {tipsEnabled && method !== "cash" && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Heart className="h-3.5 w-3.5" />
                  Add tip
                </span>
                {tipAmount > 0 && (
                  <button
                    type="button"
                    onClick={clearTip}
                    className="cursor-pointer text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {tipPresets.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => applyTipPercent(pct)}
                    className={cn(
                      "cursor-pointer rounded-lg border px-3 py-2 text-xs font-bold transition-colors",
                      activeTipPct === pct
                        ? "border-pos-primary bg-pos-primary text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-pos-primary/40"
                    )}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Custom amount"
                  value={customTipInput}
                  onChange={(e) => applyCustomTip(e.target.value)}
                  className="h-9 flex-1 text-sm"
                />
                {tipAmount > 0 && (
                  <span className="shrink-0 text-sm font-semibold text-emerald-700">
                    +{formatCurrency(tipAmount, currency)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Total */}
          <div className="mb-4 rounded-xl bg-pos-primary-soft-8 px-4 py-4 text-center ring-1 ring-pos-primary/10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {tipsEnabled && method === "cash" ? "Order total" : "Amount due"}
            </p>
            <p className="pos-heading mt-1 text-3xl font-bold tabular-nums text-pos-primary">
              {formatCurrency(tipsEnabled && method === "cash" ? total : payTotal, currency)}
            </p>
            {tipsEnabled && method === "cash" && autoTipFromCash > 0 && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                Tip (auto): {formatCurrency(autoTipFromCash, currency)} · Total due{" "}
                {formatCurrency(total + autoTipFromCash, currency)}
              </p>
            )}
            {tipAmount > 0 && !(tipsEnabled && method === "cash") && (
              <p className="mt-1 text-xs text-slate-600">
                Order {formatCurrency(total, currency)} + tip {formatCurrency(tipAmount, currency)}
              </p>
            )}
            {remaining > 0.01 && payments.length > 0 && (
              <p className="mt-1 text-xs font-medium text-amber-600">
                Remaining: {formatCurrency(remaining, currency)}
              </p>
            )}
            {(totalChange > 0 || previewChange > 0) && (
              <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                Change: {formatCurrency(totalChange || previewChange, currency)}
              </p>
            )}
            {tipsEnabled && method === "cash" && !cashCoversOrder && (
              <p className="mt-2 text-xs font-medium text-red-600">
                Received must cover order ({formatCurrency(total, currency)}) plus change
              </p>
            )}
          </div>

          {/* Payment method cards */}
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Payment method
          </p>
          <div className="mb-2 grid grid-cols-3 gap-2">
            {STANDARD_METHODS.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    "pos-payment-card flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-slate-200 bg-white p-2 text-center cursor-pointer",
                    method === m.id && "active"
                  )}
                >
                  <Icon className={cn("pos-payment-icon h-6 w-6 text-slate-400", method === m.id && "text-pos-primary")} />
                  <span className="text-[11px] font-bold text-slate-800">{m.label}</span>
                </button>
              );
            })}
          </div>

          {customerId ? (
            <>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                Customer account
              </p>
              <div className="mb-2 grid grid-cols-2 gap-2">
                {CUSTOMER_METHODS.map((m) => {
                  const Icon = m.icon;
                  const storeCreditDisabled =
                    m.id === "store_credit" && (customerCreditBalance <= 0 || checkoutOffline);
                  const payLaterDisabled = m.id === "on_account" && checkoutOffline;
                  const payLaterNeedsSetup = m.id === "on_account" && !customerOnAccountEnabled;
                  const disabled = storeCreditDisabled || payLaterDisabled;

                  let subtitle: string = m.desc;
                  if (m.id === "store_credit") {
                    subtitle =
                      customerCreditBalance > 0
                        ? formatCurrency(customerCreditBalance, currency)
                        : "No balance";
                  } else if (payLaterNeedsSetup) {
                    subtitle = "Not enabled";
                  } else if (customerOnAccountEnabled) {
                    subtitle =
                      customerCreditAvailable != null
                        ? `${formatCurrency(customerCreditAvailable, currency)} avail`
                        : customerReceivableBalance > 0
                          ? `Owes ${formatCurrency(customerReceivableBalance, currency)}`
                          : "Charge to account";
                  }

                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setMethod(m.id);
                        setError(null);
                      }}
                      className={cn(
                        "pos-payment-card flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 text-center",
                        method === m.id && "active",
                        payLaterNeedsSetup
                          ? "cursor-pointer border-amber-200 bg-amber-50/80"
                          : "border-slate-200 bg-white cursor-pointer",
                        disabled && !payLaterNeedsSetup && "cursor-not-allowed opacity-40"
                      )}
                    >
                      <Icon
                        className={cn(
                          "pos-payment-icon h-6 w-6",
                          payLaterNeedsSetup ? "text-amber-600" : "text-slate-400",
                          method === m.id && "text-pos-primary"
                        )}
                      />
                      <span className="text-[11px] font-bold text-slate-800">{m.label}</span>
                      <span className={cn("text-[10px]", payLaterNeedsSetup ? "text-amber-700" : "text-slate-400")}>
                        {subtitle}
                      </span>
                    </button>
                  );
                })}
              </div>
              {customerId && !customerOnAccountEnabled && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                  Pay later not enabled for {customerName ?? "this customer"}.
                </p>
              )}
            </>
          ) : (
            <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
              Attach a customer for store credit or pay later.
            </p>
          )}

          {/* Payment details — primary path */}
          <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount</Label>
              <Input
                type="number"
                placeholder={String(remaining || payTotal)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-11"
              />
            </div>
            {method === "store_credit" && (
              <p className="text-xs text-slate-600">
                Applies credit from {customerName ?? "selected customer"}. Balance:{" "}
                {formatCurrency(customerCreditBalance, currency)}
              </p>
            )}
            {method === "on_account" && (
              <p className="text-xs text-slate-600">
                Charges {customerName ?? "selected customer"}&apos;s account.
                {customerReceivableBalance > 0 && (
                  <> Currently owes {formatCurrency(customerReceivableBalance, currency)}.</>
                )}
                {customerCreditAvailable != null && (
                  <> Credit available: {formatCurrency(customerCreditAvailable, currency)}.</>
                )}
              </p>
            )}
            {method === "cash" && tipsEnabled && payments.length === 0 && (
              <div className="space-y-3 rounded-lg border border-amber-200/80 bg-amber-50/60 p-3">
                <p className="text-xs leading-relaxed text-slate-600">
                  Enter what the customer gave and the change returned. Any amount left over after
                  the order total and change is recorded as tip.
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Cash received</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs font-semibold"
                      onClick={fillExactCash}
                    >
                      Exact order
                    </Button>
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 150"
                    value={cashTendered}
                    onChange={(e) => setCashTendered(e.target.value)}
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Change given</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 5"
                    value={changeGivenInput}
                    onChange={(e) => setChangeGivenInput(e.target.value)}
                    className="h-10"
                  />
                </div>
                {Number.isFinite(cashReceivedNum) && Number.isFinite(cashChangeNum) && (
                  <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                    <div className="flex justify-between">
                      <span>Kept from customer</span>
                      <span className="font-semibold tabular-nums">
                        {formatCurrency(cashReceivedNum - cashChangeNum, currency)}
                      </span>
                    </div>
                    {autoTipFromCash > 0 && (
                      <div className="mt-1 flex justify-between font-semibold text-emerald-700">
                        <span>Tip (auto)</span>
                        <span className="tabular-nums">{formatCurrency(autoTipFromCash, currency)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {method === "cash" && (!tipsEnabled || payments.length > 0) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Cash tendered</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs font-semibold"
                    onClick={fillExactCash}
                  >
                    Exact amount
                  </Button>
                </div>
                <Input
                  type="number"
                  value={cashTendered}
                  onChange={(e) => setCashTendered(e.target.value)}
                  className="h-10"
                />
              </div>
            )}
            {method === "mobile_money" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Provider</Label>
                  <select
                    className="flex h-11 w-full rounded-lg border border-input bg-white px-3 text-sm"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Transaction ID *</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Phone (optional)</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" />
                </div>
              </>
            )}
            {method === "bank_transfer" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reference *</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Bank name</Label>
                  <Input value={bankName} onChange={(e) => setBankName(e.target.value)} className="h-11" />
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowSplitPay((v) => !v)}
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              {showSplitPay ? <ChevronUp className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showSplitPay ? "Hide split payment" : "Split payment"}
            </button>
            {showSplitPay && (
              <Button variant="outline" onClick={addPayment} className="h-10 w-full gap-2">
                <Plus className="h-4 w-4" />
                Add payment line
              </Button>
            )}
            {!showSplitPay && method !== "cash" && (
              <Button
                type="button"
                className="pos-checkout-btn h-11 w-full font-bold text-white"
                disabled={loading}
                onClick={addPayment}
              >
                Add {formatCurrency(parseFloat(amount) || remaining || payTotal, currency)} payment
              </Button>
            )}
          </div>

          {payments.length > 0 && (
            <ul className="mt-4 space-y-2 rounded-xl border border-slate-100 p-3">
              {payments.map((p, i) => (
                <li key={i} className="flex justify-between text-sm capitalize text-slate-700">
                  <span>{p.method.replace("_", " ")}</span>
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(p.amount, currency)}
                  </span>
                </li>
              ))}
              <li className="flex justify-between border-t border-slate-100 pt-2 font-bold text-slate-900">
                <span>Total paid</span>
                <span className="tabular-nums">{formatCurrency(paid, currency)}</span>
              </li>
            </ul>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex gap-2 border-t border-slate-100 p-4">
          <Button variant="outline" className="h-12 flex-1 cursor-pointer rounded-xl" onClick={onClose}>
            Cancel
          </Button>
          <button
            type="button"
            disabled={loading}
            onClick={completeSale}
            className={cn(
              "pos-checkout-btn flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl text-sm font-bold text-white",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {loading ? (
              checkoutOffline ? "Saving offline…" : "Processing…"
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5" />
                {checkoutOffline ? "Complete sale (offline)" : "Complete sale"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
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
import { lookupGiftCard } from "@/lib/pos/gift-card";
import {
  loyaltyPointsFromAmount,
  loyaltyValueFromPoints,
} from "@/lib/pos/loyalty";
import { isBrowserOnline } from "@/lib/offline/network";
import { queueOfflineSale, submitCompleteSale } from "@/lib/offline/sale-api";
import { parsePlanLimitError, planLimitToastDescription } from "@/lib/plan-errors";
import {
  Banknote,
  Smartphone,
  Building2,
  Gift,
  Ticket,
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
import { usePosModal } from "./use-pos-modal";

const PROVIDERS = [
  { value: "telebirr", labelKey: "providerTelebirr" as const },
  { value: "mpesa", labelKey: "providerMpesa" as const },
  { value: "cbe_birr", labelKey: "providerCbeBirr" as const },
  { value: "m_pesa", labelKey: "providerMpesaAlt" as const },
  { value: "other", labelKey: "providerOther" as const },
] as const;

type PaymentRow = {
  method: "cash" | "mobile_money" | "bank_transfer" | "store_credit" | "on_account" | "gift_card" | "loyalty";
  amount: number;
  cashTendered?: number;
  changeGiven?: number;
  provider?: string;
  reference?: string;
  phone?: string;
  bankName?: string;
};

const STANDARD_METHODS = [
  { id: "cash" as const, labelKey: "cash" as const, descKey: "cashDesc" as const, icon: Banknote },
  { id: "mobile_money" as const, labelKey: "mobileMoney" as const, descKey: "mobileMoneyDesc" as const, icon: Smartphone },
  { id: "bank_transfer" as const, labelKey: "bankTransfer" as const, descKey: "bankTransferDesc" as const, icon: Building2 },
];

const CUSTOMER_METHODS = [
  { id: "store_credit" as const, labelKey: "storeCredit" as const, descKey: "storeCreditDesc" as const, icon: Gift },
  { id: "on_account" as const, labelKey: "payLater" as const, descKey: "payLaterDesc" as const, icon: Clock },
] as const;

const ALT_METHODS = [
  { id: "gift_card" as const, labelKey: "giftCard" as const, descKey: "giftCardDesc" as const, icon: Ticket },
  { id: "loyalty" as const, labelKey: "loyalty" as const, descKey: "loyaltyDesc" as const, icon: Heart },
] as const;

type PaymentMethodId =
  | (typeof STANDARD_METHODS)[number]["id"]
  | (typeof CUSTOMER_METHODS)[number]["id"]
  | (typeof ALT_METHODS)[number]["id"];

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function methodSupportsOverpayTip(method: PaymentMethodId): boolean {
  return method === "cash" || method === "mobile_money" || method === "bank_transfer";
}

/** Cash / mobile / bank: amount received + change given (tip only when tips enabled). */
function usesReceivedChangeUi(
  method: PaymentMethodId,
  paymentCount: number
): boolean {
  // Always use received + change for cash (never the legacy "Cash tendered" UI).
  if (method === "cash") return true;
  return paymentCount === 0 && methodSupportsOverpayTip(method);
}

function receivedLabelKey(method: PaymentMethodId): "cashReceived" | "amountReceived" {
  return method === "cash" ? "cashReceived" : "amountReceived";
}

/** Tip from explicit presets plus any payment above the merchandise total. */
function resolveSaleTip(
  orderTotal: number,
  explicitTip: number,
  paymentsSum: number,
  tipsEnabled: boolean
): number {
  if (!tipsEnabled) return 0;
  const fromPayments = Math.max(0, roundMoney(paymentsSum - orderTotal));
  return Math.max(explicitTip, fromPayments);
}

function minimumPaymentRequired(
  orderTotal: number,
  explicitTip: number,
  tipsEnabled: boolean
): number {
  const due = orderTotal + (tipsEnabled ? explicitTip : 0);
  return roundMoney(due);
}

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
  loyaltyEnabled = false,
  customerLoyaltyPoints = 0,
  loyaltySpendPerPoint = 0.1,
  loyaltyMinRedeemPoints = 100,
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
  loyaltyEnabled?: boolean;
  customerLoyaltyPoints?: number;
  loyaltySpendPerPoint?: number;
  loyaltyMinRedeemPoints?: number;
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
  const t = useTranslations("pos");
  const tCommon = useTranslations("common");
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
  const [showOrderSummary, setShowOrderSummary] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const [showSplitPay, setShowSplitPay] = useState(false);
  const [tipAmount, setTipAmount] = useState(0);
  const [customTipInput, setCustomTipInput] = useState("");
  const [activeTipPct, setActiveTipPct] = useState<number | null>(null);
  const [changeGivenInput, setChangeGivenInput] = useState("");
  const [loyaltyPointsInput, setLoyaltyPointsInput] = useState("");
  const [giftCardHint, setGiftCardHint] = useState<{ ok: boolean; text: string } | null>(null);
  const [arifpayEnabled, setArifpayEnabled] = useState(false);
  const [arifpayBusy, setArifpayBusy] = useState(false);
  const [arifpayHint, setArifpayHint] = useState<string | null>(null);
  const offline = useOfflineOptional();
  const checkoutOffline = offline ? !offline.online : !isBrowserOnline();

  const cashReceivedNum = parseFloat(cashTendered);
  const cashChangeNum = parseFloat(changeGivenInput);
  const receivedChangeUi = usesReceivedChangeUi(method, payments.length);
  const autoTipFromReceived = useMemo(() => {
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
  const amountReceivedNum = parseFloat(amount);

  const tipFromOverpayPreview = useMemo(() => {
    if (!tipsEnabled || !methodSupportsOverpayTip(method) || receivedChangeUi) return 0;
    if (!Number.isFinite(amountReceivedNum) || amountReceivedNum <= total) return 0;
    return roundMoney(amountReceivedNum - total);
  }, [tipsEnabled, method, receivedChangeUi, amountReceivedNum, total]);

  const displayTip = tipsEnabled
    ? Math.max(tipAmount, receivedChangeUi ? autoTipFromReceived : tipFromOverpayPreview)
    : 0;
  const displayPayTotal = total + displayTip;

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
      tipAmount: displayTip,
      total: displayPayTotal,
      updatedAt: Date.now(),
    });
  }

  useEffect(() => {
    pushDisplay("checkout");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flag = process.env.NEXT_PUBLIC_ARIFPAY_ENABLED;
    if (flag !== "1" && flag !== "true") return;
    let cancelled = false;
    void fetch("/api/payments/arifpay/telebirr")
      .then((r) => r.json())
      .then((data: { configured?: boolean }) => {
        if (!cancelled) setArifpayEnabled(Boolean(data.configured));
      })
      .catch(() => {
        if (!cancelled) setArifpayEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tipsEnabled || !receivedChangeUi) return;
    setTipAmount(autoTipFromReceived);
    setCustomTipInput(autoTipFromReceived > 0 ? String(autoTipFromReceived) : "");
    setActiveTipPct(null);
  }, [autoTipFromReceived, tipsEnabled, receivedChangeUi]);

  useEffect(() => {
    pushDisplay("checkout");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipAmount, payTotal, displayTip, displayPayTotal]);

  useEffect(() => {
    if (loading) pushDisplay("paying");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function fillExactDue() {
    const due = remaining || payTotal;
    setAmount(String(due));
    setError(null);
  }

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

  async function requestArifpayTelebirr() {
    setArifpayHint(null);
    setError(null);
    if (checkoutOffline) {
      setError(t("errTelebirrNeedsInternet"));
      return;
    }
    const payAmount = receivedChangeUi
      ? displayPayTotal
      : parseFloat(amount) || remaining || payTotal;
    if (!(payAmount > 0)) {
      setError(t("errEnterValidPaymentAmount"));
      return;
    }
    if (!phone.trim()) {
      setError(t("errTelebirrPhoneRequired"));
      return;
    }

    setArifpayBusy(true);
    try {
      const res = await fetch("/api/payments/arifpay/telebirr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          amount: payAmount,
          phone: phone.trim(),
          itemName: `POS ${registerId.slice(0, 8)}`,
          currency,
          directPay: true,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        reference?: string;
        sessionId?: string;
        message?: string;
        directPayError?: string | null;
      };
      if (!res.ok) {
        setError(data.error ?? t("errTelebirrStartFailed"));
        return;
      }
      if (data.reference) setReference(data.reference);
      setProvider("telebirr");
      setArifpayHint(
        [
          data.message,
          data.directPayError ? t("pushNote", { note: data.directPayError }) : null,
          data.sessionId ? t("sessionLabel", { id: data.sessionId }) : null,
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch {
      setError(t("errArifpayUnreachable"));
    } finally {
      setArifpayBusy(false);
    }
  }

  function fillExactReceived() {
    if (receivedChangeUi) {
      const due = payments.length === 0 ? total : remaining;
      setCashTendered(String(due));
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
    if (!Number.isFinite(received)) return null;

    const merchandiseDue = payments.length === 0 ? total : remaining;
    let change: number;
    if (changeGivenInput.trim() === "") {
      // Tips orgs require an explicit change amount; otherwise default change to overpay.
      if (tipsEnabled && payments.length === 0) return null;
      change = Math.max(0, roundMoney(received - merchandiseDue));
    } else {
      change = parseFloat(changeGivenInput);
      if (!Number.isFinite(change)) return null;
    }
    if (received < change + merchandiseDue - 0.01) return null;
    const tip =
      tipsEnabled && payments.length === 0
        ? Math.max(0, roundMoney(received - change - total))
        : 0;
    return {
      method: "cash",
      amount: merchandiseDue + tip,
      cashTendered: received,
      changeGiven: change,
    };
  }

  function buildMobilePaymentFromInputs(): PaymentRow | null {
    if (!reference.trim()) return null;

    if (payments.length === 0) {
      const received = parseFloat(cashTendered);
      if (!Number.isFinite(received)) return null;
      let change: number;
      if (changeGivenInput.trim() === "") {
        if (tipsEnabled) return null;
        change = Math.max(0, roundMoney(received - total));
      } else {
        change = parseFloat(changeGivenInput);
        if (!Number.isFinite(change)) return null;
      }
      if (received < change + total - 0.01) return null;
      const tip = tipsEnabled ? Math.max(0, roundMoney(received - change - total)) : 0;
      return {
        method: "mobile_money",
        amount: total + tip,
        cashTendered: received,
        changeGiven: change,
        provider,
        reference: reference.trim(),
        phone: phone || undefined,
      };
    }

    const received = parseFloat(amount);
    if (!Number.isFinite(received) || received <= 0) return null;

    const minPay = minimumPaymentRequired(total, tipAmount, tipsEnabled);
    if (received < minPay - 0.01) return null;

    return {
      method: "mobile_money",
      amount: received,
      provider,
      reference: reference.trim(),
      phone: phone || undefined,
    };
  }

  function buildBankPaymentFromInputs(): PaymentRow | null {
    if (!reference.trim()) return null;

    if (payments.length === 0) {
      const received = parseFloat(cashTendered);
      if (!Number.isFinite(received)) return null;
      let change: number;
      if (changeGivenInput.trim() === "") {
        if (tipsEnabled) return null;
        change = Math.max(0, roundMoney(received - total));
      } else {
        change = parseFloat(changeGivenInput);
        if (!Number.isFinite(change)) return null;
      }
      if (received < change + total - 0.01) return null;
      const tip = tipsEnabled ? Math.max(0, roundMoney(received - change - total)) : 0;
      return {
        method: "bank_transfer",
        amount: total + tip,
        cashTendered: received,
        changeGiven: change,
        reference: reference.trim(),
        bankName: bankName || undefined,
      };
    }

    const received = parseFloat(amount);
    if (!Number.isFinite(received) || received <= 0) return null;

    const minPay = minimumPaymentRequired(total, tipAmount, tipsEnabled);
    if (received < minPay - 0.01) return null;

    return {
      method: "bank_transfer",
      amount: received,
      reference: reference.trim(),
      bankName: bankName || undefined,
    };
  }

  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, payTotal - paid);
  const totalChange = payments.reduce((s, p) => s + (p.changeGiven ?? 0), 0);
  const previewChange =
    receivedChangeUi
      ? cashChangeNum || 0
      : method === "cash" && cashTendered
        ? Math.max(0, parseFloat(cashTendered) - (parseFloat(amount) || remaining || payTotal))
        : 0;
  const tenderCoversOrder =
    !receivedChangeUi ||
    (!Number.isFinite(cashReceivedNum) && !Number.isFinite(cashChangeNum)) ||
    cashReceivedNum - cashChangeNum >= (payments.length === 0 ? total : remaining) - 0.01;

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

  async function addPayment() {
    const amt = parseFloat(amount) || remaining;
    if (amt <= 0) return;

    if (method === "store_credit") {
      if (!customerId) {
        setError(t("errSelectCustomerStoreCredit"));
        return;
      }
      if (checkoutOffline) {
        setError(t("errStoreCreditNeedsInternet"));
        return;
      }
      const creditAvail = customerCreditBalance - payments.filter((p) => p.method === "store_credit").reduce((s, p) => s + p.amount, 0);
      if (amt > creditAvail + 0.01) {
        setError(t("errOnlyStoreCredit", { amount: creditAvail.toFixed(2) }));
        return;
      }
      setPayments([...payments, { method: "store_credit", amount: amt }]);
    } else if (method === "on_account") {
      if (!customerId) {
        setError(t("errSelectCustomerPayLater"));
        return;
      }
      if (!customerOnAccountEnabled) {
        setError(t("errPayLaterNotEnabled"));
        return;
      }
      if (checkoutOffline) {
        setError(t("errPayLaterNeedsInternet"));
        return;
      }
      const onAccountUsed = payments.filter((p) => p.method === "on_account").reduce((s, p) => s + p.amount, 0);
      const creditAvail =
        customerCreditAvailable != null
          ? Math.max(0, customerCreditAvailable - onAccountUsed)
          : Infinity;
      if (customerCreditAvailable != null && amt > creditAvail + 0.01) {
        setError(t("errOnlyCreditAvailable", { amount: creditAvail.toFixed(2) }));
        return;
      }
      setPayments([...payments, { method: "on_account", amount: amt }]);
    } else if (method === "gift_card") {
      if (checkoutOffline) {
        setError(t("errGiftCardsNeedInternet"));
        return;
      }
      const code = reference.trim();
      if (!code) {
        setError(t("errEnterGiftCardCode"));
        return;
      }
      const lookup = await lookupGiftCard(organizationId, code);
      if (!lookup.valid) {
        setError(lookup.message ?? t("errInvalidGiftCard"));
        return;
      }
      const usedGift = payments
        .filter((p) => p.method === "gift_card" && p.reference === lookup.code)
        .reduce((s, p) => s + p.amount, 0);
      const avail = Math.max(0, (lookup.balance ?? 0) - usedGift);
      if (amt > avail + 0.01) {
        setError(t("errOnlyCardBalance", { amount: avail.toFixed(2) }));
        return;
      }
      setPayments([
        ...payments,
        { method: "gift_card", amount: Math.min(amt, avail), reference: lookup.code ?? code.toUpperCase() },
      ]);
    } else if (method === "loyalty") {
      if (!customerId) {
        setError(t("errSelectCustomerLoyalty"));
        return;
      }
      if (!loyaltyEnabled) {
        setError(t("errLoyaltyNotEnabled"));
        return;
      }
      if (checkoutOffline) {
        setError(t("errLoyaltyNeedsInternet"));
        return;
      }
      const pts =
        parseInt(loyaltyPointsInput, 10) ||
        loyaltyPointsFromAmount(amt, loyaltySpendPerPoint);
      const loyaltyUsed = payments
        .filter((p) => p.method === "loyalty")
        .reduce((s, p) => s + (parseInt(p.reference ?? "0", 10) || 0), 0);
      const availPts = customerLoyaltyPoints - loyaltyUsed;
      if (pts < loyaltyMinRedeemPoints) {
        setError(t("errMinRedemptionPoints", { points: loyaltyMinRedeemPoints }));
        return;
      }
      if (pts > availPts) {
        setError(t("errOnlyPointsAvailable", { points: availPts }));
        return;
      }
      const loyaltyAmt = loyaltyValueFromPoints(pts, loyaltySpendPerPoint);
      setPayments([...payments, { method: "loyalty", amount: loyaltyAmt, reference: String(pts) }]);
    } else if (method === "cash") {
      const row = buildCashPaymentFromInputs();
      if (!row) {
        setError(
          payments.length === 0
            ? t("errEnterReceivedAndChange")
            : t("errEnterValidCash")
        );
        return;
      }
      setPayments([...payments, row]);
    } else if (method === "mobile_money") {
      if (payments.length === 0) {
        const row = buildMobilePaymentFromInputs();
        if (!row) {
          setError(
            !reference.trim()
              ? t("errTxnReferenceRequired")
              : t("errReceivedMustCoverChange")
          );
          return;
        }
        setPayments([...payments, row]);
      } else {
        if (!reference.trim()) {
          setError(t("errTxnReferenceRequired"));
          return;
        }
        const minPay = minimumPaymentRequired(total, tipAmount, tipsEnabled);
        if (amt > remaining + 0.01) {
          setError(t("errMaxForLine", { amount: formatCurrency(remaining, currency) }));
          return;
        } else if (amt < minPay - 0.01) {
          setError(
            tipsEnabled && tipAmount > 0
              ? t("errAmountCoverTip", { amount: formatCurrency(minPay, currency) })
              : t("errMinPayment", { amount: formatCurrency(minPay, currency) })
          );
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
      }
    } else if (method === "bank_transfer") {
      if (payments.length === 0) {
        const row = buildBankPaymentFromInputs();
        if (!row) {
          setError(
            !reference.trim()
              ? t("errTransferReferenceRequired")
              : t("errReceivedMustCoverChange")
          );
          return;
        }
        setPayments([...payments, row]);
      } else {
        if (!reference.trim()) {
          setError(t("errTransferReferenceRequired"));
          return;
        }
        const minPay = minimumPaymentRequired(total, tipAmount, tipsEnabled);
        if (amt > remaining + 0.01) {
          setError(t("errMaxForLine", { amount: formatCurrency(remaining, currency) }));
          return;
        } else if (amt < minPay - 0.01) {
          setError(
            tipsEnabled && tipAmount > 0
              ? t("errAmountCoverTip", { amount: formatCurrency(minPay, currency) })
              : t("errMinPayment", { amount: formatCurrency(minPay, currency) })
          );
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
    } else {
      // Unreachable for standard methods; kept for exhaustiveness with gift/loyalty handled above.
      setError(t("errAddPaymentsMatchTotal"));
      return;
    }
    setAmount("");
    setCashTendered("");
    setChangeGivenInput("");
    setReference("");
    setLoyaltyPointsInput("");
    setGiftCardHint(null);
    setError(null);
  }

  async function completeSale() {
    let finalPayments = payments;
    let saleTip = tipAmount;

    if (payments.length === 0 && method === "cash") {
      const cashRow = buildCashPaymentFromInputs();
      if (!cashRow) {
        setError(t("errEnterReceivedAndChange"));
        return;
      }
      finalPayments = [cashRow];
    } else if (payments.length === 0 && method === "mobile_money") {
      const row = buildMobilePaymentFromInputs();
      if (!row) {
        setError(
          !reference.trim()
            ? t("errTxnReferenceRequired")
            : t("errEnterMobileReceivedChange")
        );
        return;
      }
      finalPayments = [row];
    } else if (payments.length === 0 && method === "bank_transfer") {
      const row = buildBankPaymentFromInputs();
      if (!row) {
        setError(
          !reference.trim()
            ? t("errTransferReferenceRequired")
            : t("errEnterBankReceivedChange")
        );
        return;
      }
      finalPayments = [row];
    } else if (payments.length === 0) {
      setError(t("errAddPaymentsMatchTotal"));
      return;
    }

    const paymentsSum = finalPayments.reduce((s, p) => s + p.amount, 0);
    saleTip = resolveSaleTip(total, tipAmount, paymentsSum, tipsEnabled);
    const saleTotal = total + saleTip;

    if (paymentsSum < saleTotal - 0.01) {
      setError(t("errPaymentLessThanDue", { paid: formatCurrency(paymentsSum, currency), due: formatCurrency(saleTotal, currency) }));
      return;
    }
    if (paymentsSum > saleTotal + 0.01) {
      setError(t("errPaymentExceedsDue", { paid: formatCurrency(paymentsSum, currency), due: formatCurrency(saleTotal, currency) }));
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
      if (p.method === "gift_card") {
        return { method: "gift_card", amount: p.amount, reference: p.reference };
      }
      if (p.method === "loyalty") {
        return { method: "loyalty", amount: p.amount, reference: p.reference };
      }
      if (p.method === "mobile_money") {
        return {
          method: "mobile_money",
          amount: p.amount,
          cashTendered: p.cashTendered,
          changeGiven: p.changeGiven,
          provider: p.provider,
          reference: p.reference,
          phone: p.phone,
        };
      }
      return {
        method: "bank_transfer",
        amount: p.amount,
        cashTendered: p.cashTendered,
        changeGiven: p.changeGiven,
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
        setError(t("errCouldNotSaveSale"));
      }
    } finally {
      setLoading(false);
    }
  }

  const panelRef = usePosModal(onClose);

  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-checkout-title"
        className="pos-modal-panel flex max-h-[95vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
      >
        {/* Header */}
        <div className="pos-header flex shrink-0 items-center justify-between px-4 py-3.5 sm:px-6 sm:py-5">
          <div>
            <h2 id="pos-checkout-title" className="pos-heading text-lg font-bold text-white sm:text-xl">
              {t("checkout")}
            </h2>
            {customerName && (
              <p className="text-xs text-white/70">{t("customerLabel", { name: customerName })}</p>
            )}
            {checkoutOffline && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-200">
                <WifiOff className="h-3 w-3" />
                {t("offlineModeBanner")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-xl p-2.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label={t("closeCheckout")}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {/* Order summary */}
          <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setShowOrderSummary((v) => !v)}
              aria-expanded={showOrderSummary}
              className="flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary"
            >
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                <Receipt className="h-3.5 w-3.5" aria-hidden />
                {t("orderItems", { count: lines.length, items: lines.length === 1 ? t("itemSingular") : t("itemPlural") })}
              </span>
              {showOrderSummary ? (
                <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
              )}
            </button>
            {showOrderSummary && (
              <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                <ul className="max-h-36 space-y-1.5 overflow-y-auto">
                  {lines.map((line) => (
                    <li
                      key={`${line.variantId}::${line.uomCode ?? "ea"}`}
                      className="flex justify-between gap-2 text-xs text-slate-700"
                    >
                      <span className="min-w-0 truncate">
                        {line.uomCode
                          ? `${line.quantity} ${line.uomCode} ${line.productName}`
                          : `${line.quantity}× ${line.productName}`}
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
                    <span>{t("subtotal")}</span>
                    <span className="tabular-nums">{formatCurrency(subtotal, currency)}</span>
                  </div>
                  {tax > 0 && (
                    <div className="flex justify-between">
                      <span>{t("tax")}</span>
                      <span className="tabular-nums">{formatCurrency(tax, currency)}</span>
                    </div>
                  )}
                  {orderDiscountTotal > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>{t("discount")}</span>
                      <span className="tabular-nums">−{formatCurrency(orderDiscountTotal, currency)}</span>
                    </div>
                  )}
                  {promoDiscount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>{promoCode ? t("promoWithCode", { code: promoCode }) : t("promo")}</span>
                      <span className="tabular-nums">−{formatCurrency(promoDiscount, currency)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {tipsEnabled &&
            !receivedChangeUi &&
            !["store_credit", "on_account", "gift_card", "loyalty"].includes(method) && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Heart className="h-3.5 w-3.5" aria-hidden />
                  {t("addTip")}
                </span>
                {tipAmount > 0 && (
                  <button
                    type="button"
                    onClick={clearTip}
                    className="cursor-pointer text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                  >
                    {t("clear")}
                  </button>
                )}
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
                {methodSupportsOverpayTip(method)
                  ? t("tipHelpOverpay")
                  : t("tipHelpSimple")}
              </p>
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
                  placeholder={t("customAmount")}
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
              {tipsEnabled && receivedChangeUi ? t("orderTotal") : t("amountDue")}
            </p>
            <p className="pos-heading mt-1 text-3xl font-bold tabular-nums text-pos-primary">
              {formatCurrency(tipsEnabled && receivedChangeUi ? total : displayPayTotal, currency)}
            </p>
            {tipsEnabled && receivedChangeUi && autoTipFromReceived > 0 && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                {t("tipAutoWithTotal", { tip: formatCurrency(autoTipFromReceived, currency), total: formatCurrency(total + autoTipFromReceived, currency) })}
              </p>
            )}
            {tipsEnabled && !receivedChangeUi && displayTip > 0 && (
              <p className="mt-1 text-xs text-slate-600">
                {t("orderPlusTip", { order: formatCurrency(total, currency), tip: formatCurrency(displayTip, currency) })}
              </p>
            )}
            {tipsEnabled &&
              methodSupportsOverpayTip(method) &&
              !receivedChangeUi &&
              tipFromOverpayPreview > tipAmount && (
                <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                  {t("tipFromOverpayment", { amount: formatCurrency(tipFromOverpayPreview, currency) })}
                </p>
              )}
            {remaining > 0.01 && payments.length > 0 && (
              <p className="mt-1 text-xs font-medium text-amber-600">
                {t("remaining", { amount: formatCurrency(remaining, currency) })}
              </p>
            )}
            {(totalChange > 0 || previewChange > 0) && (
              <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                {t("change", { amount: formatCurrency(totalChange || previewChange, currency) })}
              </p>
            )}
            {tipsEnabled && receivedChangeUi && !tenderCoversOrder && (
              <p className="mt-2 text-xs font-medium text-red-600">
                {t("receivedMustCover", { amount: formatCurrency(total, currency) })}
              </p>
            )}
          </div>

          {/* Payment method cards */}
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {t("payment")}
          </p>
          <div className="mb-2 grid grid-cols-3 gap-2">
            {STANDARD_METHODS.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMethod(m.id);
                    setCashTendered("");
                    setChangeGivenInput("");
                    setAmount("");
                    setError(null);
                  }}
                  className={cn(
                    "pos-payment-card flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-slate-200 bg-white p-2 text-center cursor-pointer",
                    method === m.id && "active"
                  )}
                >
                  <Icon className={cn("pos-payment-icon h-6 w-6 text-slate-400", method === m.id && "text-pos-primary")} />
                  <span className="text-[11px] font-bold text-slate-800">{t(m.labelKey)}</span>
                </button>
              );
            })}
          </div>

          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {t("giftCardAndLoyalty")}
          </p>
          <div className="mb-2 grid grid-cols-2 gap-2">
            {ALT_METHODS.map((m) => {
              const Icon = m.icon;
              const giftDisabled = m.id === "gift_card" && checkoutOffline;
              const loyaltyDisabled =
                m.id === "loyalty" &&
                (!loyaltyEnabled || !customerId || customerLoyaltyPoints < loyaltyMinRedeemPoints || checkoutOffline);
              const disabled = giftDisabled || loyaltyDisabled;
              let subtitle: string = t(m.descKey);
              if (m.id === "loyalty" && loyaltyEnabled && customerId) {
                subtitle = t("loyaltyPointsShort", { count: customerLoyaltyPoints });
              } else if (m.id === "loyalty" && !loyaltyEnabled) {
                subtitle = t("notEnabled");
              } else if (m.id === "loyalty" && !customerId) {
                subtitle = t("needsCustomer");
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
                    "pos-payment-card flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-slate-200 bg-white p-2 text-center cursor-pointer",
                    method === m.id && "active",
                    disabled && "cursor-not-allowed opacity-40"
                  )}
                >
                  <Icon className={cn("pos-payment-icon h-6 w-6 text-slate-400", method === m.id && "text-pos-primary")} />
                  <span className="text-[11px] font-bold text-slate-800">{t(m.labelKey)}</span>
                  <span className="text-[10px] text-slate-400">{subtitle}</span>
                </button>
              );
            })}
          </div>

          {customerId ? (
            <>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                {t("customer")}
              </p>
              <div className="mb-2 grid grid-cols-2 gap-2">
                {CUSTOMER_METHODS.map((m) => {
                  const Icon = m.icon;
                  const storeCreditDisabled =
                    m.id === "store_credit" && (customerCreditBalance <= 0 || checkoutOffline);
                  const payLaterDisabled = m.id === "on_account" && checkoutOffline;
                  const payLaterNeedsSetup = m.id === "on_account" && !customerOnAccountEnabled;
                  const disabled = storeCreditDisabled || payLaterDisabled;

                  let subtitle: string = t(m.descKey);
                  if (m.id === "store_credit") {
                    subtitle =
                      customerCreditBalance > 0
                        ? formatCurrency(customerCreditBalance, currency)
                        : t("noBalance");
                  } else if (payLaterNeedsSetup) {
                    subtitle = t("notEnabled");
                  } else if (customerOnAccountEnabled) {
                    subtitle =
                      customerCreditAvailable != null
                        ? t("availableAmount", { amount: formatCurrency(customerCreditAvailable, currency) })
                        : customerReceivableBalance > 0
                          ? t("owesAmount", { amount: formatCurrency(customerReceivableBalance, currency) })
                          : t("chargeToAccount");
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
                      <span className="text-[11px] font-bold text-slate-800">{t(m.labelKey)}</span>
                      <span className={cn("text-[10px]", payLaterNeedsSetup ? "text-amber-700" : "text-slate-400")}>
                        {subtitle}
                      </span>
                    </button>
                  );
                })}
              </div>
              {customerId && !customerOnAccountEnabled && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                  {t("payLaterNotEnabledFor", { name: customerName ?? t("thisCustomer") })}
                </p>
              )}
            </>
          ) : (
            <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
              {t("attachCustomerHint")}
            </p>
          )}

          {/* Payment details — primary path */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            {!receivedChangeUi && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">
                    {tipsEnabled && methodSupportsOverpayTip(method)
                      ? t("amountReceived")
                      : t("amountLabel")}
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs font-semibold"
                    onClick={fillExactDue}
                  >
                    {t("exactDue")}
                  </Button>
                </div>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={String(remaining || payTotal)}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-11"
                  aria-label={
                    tipsEnabled && methodSupportsOverpayTip(method)
                      ? t("amountReceivedFromCustomer")
                      : t("paymentAmount")
                  }
                />
                {tipsEnabled && methodSupportsOverpayTip(method) && (
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    {t("overpayTipHelp", { tipPart: tipAmount > 0 ? t("plusSelectedTip") : "" })}
                  </p>
                )}
              </div>
            )}
            {method === "store_credit" && (
              <p className="text-xs text-slate-600">
                {t("appliesCreditFrom", { name: customerName ?? t("selectedCustomer"), amount: formatCurrency(customerCreditBalance, currency) })}
              </p>
            )}
            {method === "on_account" && (
              <p className="text-xs text-slate-600">
                {t("chargesAccount", { name: customerName ?? t("selectedCustomer") })}
                {customerReceivableBalance > 0 && (
                  <>{t("currentlyOwes", { amount: formatCurrency(customerReceivableBalance, currency) })}</>
                )}
                {customerCreditAvailable != null && (
                  <>{t("creditAvailable", { amount: formatCurrency(customerCreditAvailable, currency) })}</>
                )}
              </p>
            )}
            {method === "gift_card" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("giftCardCode")}</Label>
                <Input
                  placeholder={t("giftCardCodePlaceholder")}
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value.toUpperCase());
                    setGiftCardHint(null);
                  }}
                  onBlur={async () => {
                    if (!reference.trim() || checkoutOffline) return;
                    const lookup = await lookupGiftCard(organizationId, reference);
                    if (lookup.valid && lookup.balance != null) {
                      setGiftCardHint({ ok: true, text: t("giftCardBalance", { amount: formatCurrency(lookup.balance, currency) }) });
                    } else {
                      setGiftCardHint(lookup.message ? { ok: false, text: lookup.message } : null);
                    }
                  }}
                  className="h-10 font-mono uppercase"
                />
                {giftCardHint && (
                  <p className={cn("text-xs", giftCardHint.ok ? "text-emerald-700" : "text-red-600")}>
                    {giftCardHint.text}
                  </p>
                )}
              </div>
            )}
            {method === "loyalty" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("pointsToRedeem")}</Label>
                <Input
                  type="number"
                  min={loyaltyMinRedeemPoints}
                  placeholder={String(loyaltyMinRedeemPoints)}
                  value={loyaltyPointsInput}
                  onChange={(e) => setLoyaltyPointsInput(e.target.value)}
                  className="h-10"
                />
                <p className="text-xs text-slate-600">
                  {t("loyaltyPointsHelp", { points: customerLoyaltyPoints, min: loyaltyMinRedeemPoints, perPoint: formatCurrency(loyaltySpendPerPoint, currency) })}
                  {loyaltyPointsInput && (
                    <> → {formatCurrency(loyaltyValueFromPoints(parseInt(loyaltyPointsInput, 10) || 0, loyaltySpendPerPoint), currency)}</>
                  )}
                </p>
              </div>
            )}
            {receivedChangeUi && (
              <div className="space-y-3 rounded-lg border border-amber-200/80 bg-amber-50/60 p-3">
                <p className="text-xs leading-relaxed text-slate-600">
                  {tipsEnabled ? t("receivedChangeHelp") : t("receivedChangeHelpNoTip")}
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">{t(receivedLabelKey(method))}</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs font-semibold"
                      onClick={fillExactReceived}
                    >
                      {t("exactOrder")}
                    </Button>
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={t("exampleAmount", { amount: "150" })}
                    value={cashTendered}
                    onChange={(e) => setCashTendered(e.target.value)}
                    className="h-10"
                    aria-label={t(receivedLabelKey(method))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("changeGiven")}</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={t("exampleAmount", { amount: "5" })}
                    value={changeGivenInput}
                    onChange={(e) => setChangeGivenInput(e.target.value)}
                    className="h-10"
                    aria-label={t("changeGiven")}
                  />
                </div>
                {Number.isFinite(cashReceivedNum) && Number.isFinite(cashChangeNum) && (
                  <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                    <div className="flex justify-between">
                      <span>{t("keptFromCustomer")}</span>
                      <span className="font-semibold tabular-nums">
                        {formatCurrency(cashReceivedNum - cashChangeNum, currency)}
                      </span>
                    </div>
                    {autoTipFromReceived > 0 && (
                      <div className="mt-1 flex justify-between font-semibold text-emerald-700">
                        <span>{t("tipAuto")}</span>
                        <span className="tabular-nums">{formatCurrency(autoTipFromReceived, currency)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {method === "mobile_money" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("provider")}</Label>
                  <select
                    className="flex h-11 w-full rounded-lg border border-input bg-white px-3 text-sm"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{t(p.labelKey)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("transactionIdRequired")}</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {arifpayEnabled && provider === "telebirr" ? t("phoneRequired") : t("phoneOptional")}
                  </Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" />
                </div>
                {arifpayEnabled && provider === "telebirr" && (
                  <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
                    <p className="text-[11px] leading-relaxed text-emerald-900">
                      {t("telebirrPushHelp")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-full border-emerald-300 bg-white font-semibold text-emerald-900"
                      disabled={arifpayBusy || loading || checkoutOffline}
                      onClick={() => void requestArifpayTelebirr()}
                    >
                      {arifpayBusy ? t("requestingTelebirr") : t("requestTelebirr")}
                    </Button>
                    {arifpayHint && (
                      <p className="text-[11px] leading-relaxed text-emerald-800">{arifpayHint}</p>
                    )}
                  </div>
                )}
              </>
            )}
            {method === "bank_transfer" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("referenceRequired")}</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("bankName")}</Label>
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
              {showSplitPay ? t("hideSplitPayment") : t("splitPayment")}
            </button>
            {showSplitPay && (
              <Button variant="outline" onClick={addPayment} className="h-10 w-full gap-2">
                <Plus className="h-4 w-4" />
                {t("addPaymentLine")}
              </Button>
            )}
            {!showSplitPay &&
              (method === "mobile_money" || method === "bank_transfer") && (
                <Button
                  type="button"
                  className="pos-checkout-btn h-11 w-full font-bold text-white"
                  disabled={loading}
                  onClick={() => void completeSale()}
                >
                  {t("completeSaleWithTotal", { amount: formatCurrency(displayPayTotal, currency) })}
                </Button>
              )}
            {!showSplitPay &&
              method !== "cash" &&
              method !== "mobile_money" &&
              method !== "bank_transfer" && (
                <Button
                  type="button"
                  className="pos-checkout-btn h-11 w-full font-bold text-white"
                  disabled={loading}
                  onClick={addPayment}
                >
                  {t("addPaymentAmount", { amount: formatCurrency(parseFloat(amount) || remaining || payTotal, currency) })}
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
                <span>{t("totalPaid")}</span>
                <span className="tabular-nums">{formatCurrency(paid, currency)}</span>
              </li>
            </ul>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
        </div>

        {/* Footer actions — sticky Complete */}
        <div className="sticky bottom-0 z-10 flex shrink-0 gap-2 border-t border-slate-100 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
          <Button variant="outline" className="h-12 flex-1 cursor-pointer rounded-xl" onClick={onClose}>
            {tCommon("cancel")}
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
              checkoutOffline ? t("savingOffline") : t("processing")
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5" />
                {checkoutOffline ? t("completeSaleOffline") : t("completeSale")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

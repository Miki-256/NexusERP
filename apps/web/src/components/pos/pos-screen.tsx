"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { cn, formatCurrency } from "@/lib/utils";
import { cachePosSession, clearCachedPosSession, getCachedPosSession, decrementCachedPosStock, getCachedPosCatalogMeta, isCatalogStale, cachePosCatalog } from "@/lib/offline/pos-cache";
import { isBrowserOnline } from "@/lib/offline/network";
import { useOfflineOptional } from "@/components/offline/offline-provider";
import { useCartStore, calcCartTotals } from "@/stores/cart-store";
import { usePosCart } from "@/lib/pos/use-pos-cart";
import { canAddToCart, defaultSaleUom, hasMeasuredSaleUoms, rememberPreferredSaleUom } from "@/lib/pos/stock-utils";
import { refreshCatalogStock } from "@/lib/pos/stock-refresh";
import { fetchProductByBarcode } from "@/lib/pos/barcode-server";
import { isValidBarcode, normalizeBarcode } from "@/lib/pos/barcode-scan";
import { perfNow } from "@/lib/perf";
import type { PosStaffSession } from "@/lib/pos-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ReceiptPrint } from "./receipt-print";
import type { PosCatalogItem } from "./product-card";
import { MeasureQtyModal } from "./measure-qty-modal";
import { VirtualizedCatalogGrid } from "./virtualized-catalog-grid";
import { CategoryNav } from "./category-nav";
import { CartPanel } from "./cart-panel";
import { ShiftStatsBar } from "./shift-stats-bar";
import { PosSyncBadge } from "./pos-sync-badge";
import { PosRegisterSwitcher } from "./pos-register-switcher";
import {
  PaymentModal,
  BarcodeScannerModal,
  RefundModal,
  CloseShiftModal,
  CustomerLookupModal,
  ManagerPinModal,
  HeldCartPickerModal,
  PosOfflineQueueModal,
  ShortcutsHelpModal,
  PosToolsMenu,
  type BarcodeScanResult,
  type PosCustomer,
} from "./pos-lazy-modals";
import {
  getRecentVariantIds,
  recordRecentVariants,
  getStoredCatalogDensity,
  resolveCatalogDensity,
  setCatalogDensity,
  getPosAutoReturn,
  type PosCatalogDensity,
} from "@/lib/pos/pos-preferences";
import {
  exceedsCashierDiscountLimit,
  discountPctOfSubtotal,
  exceedsAbsoluteDiscountLimit,
  prepareDiscountApplication,
  type DiscountApplyRequest,
} from "@/lib/pos/discount-policy";
import { validatePromotionCode } from "@/lib/pos/promotions";
import {
  openCustomerDisplayWindow,
  publishCustomerDisplay,
  totalChangeFromPayments,
} from "@/lib/pos/customer-display";
import {
  Search,
  ScanBarcode,
  X,
  LogOut,
  Store,
  CircleDot,
  Printer,
  User,
  DoorClosed,
  RotateCcw,
  Wrench,
  LayoutGrid,
  Rows3,
  ShoppingCart,
} from "lucide-react";
import {
  buildCatalogSearchIndex,
  filterCatalogItems,
  lookupCatalogByBarcode,
} from "@/lib/pos/catalog-search";
import { fetchPosCatalogPage } from "@/lib/pos/catalog-page";
import "./pos.css";

type Session = {
  id: string;
  opening_float: number;
  opened_at: string;
} | null;

const FAVORITES_KEY = (orgId: string) => `pos-favorites-${orgId}`;

/** Persist draft ticket # per register so remounts/idle refresh do not churn IDs. */
const DRAFT_TICKET_KEY = (registerId: string) => `pos-draft-ticket-${registerId}`;

function mintDraftTicketId(): string {
  return String(Math.floor(Math.random() * 9000) + 1000);
}

function readDraftTicketId(registerId: string): string {
  if (typeof window === "undefined") return mintDraftTicketId();
  try {
    const existing = sessionStorage.getItem(DRAFT_TICKET_KEY(registerId));
    if (existing && /^\d{4}$/.test(existing)) return existing;
  } catch {
    /* ignore */
  }
  const minted = mintDraftTicketId();
  try {
    sessionStorage.setItem(DRAFT_TICKET_KEY(registerId), minted);
  } catch {
    /* ignore */
  }
  return minted;
}

function writeDraftTicketId(registerId: string, id: string) {
  try {
    sessionStorage.setItem(DRAFT_TICKET_KEY(registerId), id);
  } catch {
    /* ignore */
  }
}

export function PosScreen({
  registerId,
  registerName,
  storeId,
  storeName,
  organizationId,
  currency,
  taxRate,
  taxInclusive,
  orgName,
  receiptFooter,
  catalog,
  catalogTruncated = false,
  openSession: initialSession,
  posStaffSession,
  onStaffSignOut,
  onShiftClosed,
  userEmail,
  maxCashierDiscountPct = 15,
  tipsEnabled = false,
  tipPresets = [10, 15, 20],
  loyaltyEnabled = false,
  loyaltyPointsPer = 1,
  loyaltySpendPerPoint = 0.1,
  loyaltyMinRedeemPoints = 100,
}: {
  registerId: string;
  registerName: string;
  storeId: string;
  storeName: string;
  organizationId: string;
  currency: string;
  taxRate: number;
  taxInclusive: boolean;
  orgName: string;
  receiptFooter: string | null;
  catalog: PosCatalogItem[];
  catalogTruncated?: boolean;
  openSession: Session;
  posStaffSession?: PosStaffSession;
  onStaffSignOut?: () => void;
  onShiftClosed?: () => void;
  userEmail?: string | null;
  maxCashierDiscountPct?: number;
  tipsEnabled?: boolean;
  tipPresets?: number[];
  loyaltyEnabled?: boolean;
  loyaltyPointsPer?: number;
  loyaltySpendPerPoint?: number;
  loyaltyMinRedeemPoints?: number;
}) {
  const t = useTranslations("pos");
  const [session, setSession] = useState(initialSession);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [viewFavorites, setViewFavorites] = useState(false);
  const [viewRecent, setViewRecent] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [flashVariant, setFlashVariant] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerCreditBalance, setCustomerCreditBalance] = useState(0);
  const [customerReceivableBalance, setCustomerReceivableBalance] = useState(0);
  const [customerOnAccountEnabled, setCustomerOnAccountEnabled] = useState(false);
  const [customerCreditAvailable, setCustomerCreditAvailable] = useState<number | null>(null);
  const [customerLoyaltyPoints, setCustomerLoyaltyPoints] = useState(0);
  const [localCatalog, setLocalCatalog] = useState(catalog);
  const [catalogCachedAt, setCatalogCachedAt] = useState<string | null>(null);
  const [serverSearchItems, setServerSearchItems] = useState<PosCatalogItem[] | null>(null);
  const [serverSearchLoading, setServerSearchLoading] = useState(false);
  const [stockToast, setStockToast] = useState<string | null>(null);
  const [measureItem, setMeasureItem] = useState<PosCatalogItem | null>(null);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showManagerPin, setShowManagerPin] = useState(false);
  const [showHeldCartPicker, setShowHeldCartPicker] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [recentVariantIds, setRecentVariantIds] = useState<string[]>([]);
  const [catalogDensity, setCatalogDensityState] = useState<PosCatalogDensity>("compact");
  const [discountOverride, setDiscountOverride] = useState(false);
  const [managerDiscountPin, setManagerDiscountPin] = useState<string | null>(null);
  const [pendingDiscount, setPendingDiscount] = useState<
    | { type: "line"; variantId: string; amount: number; uomCode?: string }
    | { type: "cart"; amount: number }
    | null
  >(null);
  const [pendingCheckout, setPendingCheckout] = useState(false);
  const [orderSeq, setOrderSeq] = useState("----");

  useEffect(() => {
    const id = readDraftTicketId(registerId);
    setOrderSeq(id);
  }, [registerId]);

  useEffect(() => {
    if (orderSeq === "----") return;
    writeDraftTicketId(registerId, orderSeq);
  }, [registerId, orderSeq]);

  function rotateDraftTicketId() {
    const next = mintDraftTicketId();
    setOrderSeq(next);
    writeDraftTicketId(registerId, next);
  }
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [lastSale, setLastSale] = useState<{
    saleId?: string;
    pollPaymentStatus?: boolean;
    changeDue?: number;
    sale: Parameters<typeof ReceiptPrint>[0]["sale"];
    lines: Parameters<typeof ReceiptPrint>[0]["lines"];
    payments: Parameters<typeof ReceiptPrint>[0]["payments"];
  } | null>(null);
  const [showOfflineQueue, setShowOfflineQueue] = useState(false);
  const [openingFloat, setOpeningFloat] = useState("0");
  const searchRef = useRef<HTMLInputElement>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const customerDisplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offline = useOfflineOptional();

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 120);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setLocalCatalog(catalog);
  }, [catalog]);

  useEffect(() => {
    void getCachedPosCatalogMeta(registerId).then((meta) => {
      if (meta.cachedAt) setCatalogCachedAt(meta.cachedAt);
    });
  }, [registerId, catalog]);

  const catalogStale = useMemo(
    () => !offline?.online || isCatalogStale(catalogCachedAt),
    [offline?.online, catalogCachedAt]
  );

  const catalogByVariant = useMemo(() => {
    const map = new Map<string, PosCatalogItem>();
    for (const item of localCatalog) map.set(item.variantId, item);
    return map;
  }, [localCatalog]);

  const localCatalogRef = useRef(localCatalog);
  localCatalogRef.current = localCatalog;

  /** Targeted stock delta — never reloads full catalog after sale/void. */
  const refreshStock = useCallback(async (variantIds: string[]) => {
    if (!isBrowserOnline() || variantIds.length === 0) return;
    const next = await refreshCatalogStock(
      registerId,
      localCatalogRef.current,
      variantIds
    );
    setLocalCatalog(next);
  }, [registerId]);

  const mergeCatalogItem = useCallback(
    (item: PosCatalogItem) => {
      setLocalCatalog((prev) => {
        const idx = prev.findIndex((c) => c.variantId === item.variantId);
        const next =
          idx >= 0
            ? prev.map((c, i) => (i === idx ? { ...c, ...item } : c))
            : [...prev, item];
        void cachePosCatalog(registerId, next);
        return next;
      });
    },
    [registerId]
  );

  function clearCustomer() {    setCustomerId(null);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerCreditBalance(0);
    setCustomerReceivableBalance(0);
    setCustomerOnAccountEnabled(false);
    setCustomerCreditAvailable(null);
    setCustomerLoyaltyPoints(0);
  }

  function selectCustomer(c: PosCustomer) {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerPhone(c.phone ?? "");
    setCustomerCreditBalance(Number(c.creditBalance) || 0);
    setCustomerReceivableBalance(Number(c.receivableBalance) || 0);
    setCustomerOnAccountEnabled(Boolean(c.onAccountEnabled));
    setCustomerCreditAvailable(
      c.creditAvailable != null ? Number(c.creditAvailable) : null
    );
    setCustomerLoyaltyPoints(Number(c.loyaltyPoints) || 0);
    setShowCustomerLookup(false);
  }

  const modalOpen =
    showPayment ||
    showCustomerLookup ||
    showCloseShift ||
    showRefund ||
    showTools ||
    showScanner ||
    showManagerPin ||
    showHeldCartPicker ||
    showShortcutsHelp ||
    showOfflineQueue ||
    !!lastSale;

  const {
    lines,
    cartDiscount,
    promoCode,
    promoDiscount,
    promotionName,
    heldCarts,
    addLine,
    updateQuantity,
    removeLine,
    setCartDiscount,
    setLineDiscount,
    setLineUom,
    applyPromotion,
    clearPromotion,
    clear,
    hold,
    recall,
    initForRegister,
    cartRestoreFailed,
    acknowledgeCartRestoreFailed,
  } = usePosCart();
  const { toast } = useToast();

  useEffect(() => {
    initForRegister(registerId);
  }, [registerId, initForRegister]);

  useEffect(() => {
    if (!cartRestoreFailed) return;
    toast({
      title: t("cartCleared"),
      description: t("cartClearedHelp"),
      variant: "destructive",
    });
    acknowledgeCartRestoreFailed();
  }, [cartRestoreFailed, acknowledgeCartRestoreFailed, toast, t]);

  // Prefetch PaymentModal chunk once cart has lines (avoids hitch on Pay).
  useEffect(() => {
    if (lines.length === 0) return;
    void import("./payment-modal");
  }, [lines.length]);

  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const { subtotal, tax, total } = calcCartTotals(
    lines,
    cartDiscount,
    taxRate,
    taxInclusive,
    promoDiscount
  );

  const categories = useMemo(
    () =>
      [...new Set(localCatalog.map((p) => p.categoryName).filter(Boolean))] as string[],
    [localCatalog]
  );

  useEffect(() => {
    setRecentVariantIds(getRecentVariantIds(registerId));
  }, [registerId]);

  const catalogDensityExplicitRef = useRef(false);

  useEffect(() => {
    const stored = getStoredCatalogDensity(registerId);
    catalogDensityExplicitRef.current = stored != null;
    const apply = () => {
      setCatalogDensityState(resolveCatalogDensity(registerId, window.innerWidth));
    };
    apply();
    const onResize = () => {
      if (catalogDensityExplicitRef.current) return;
      setCatalogDensityState(resolveCatalogDensity(registerId, window.innerWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [registerId]);

  function toggleCatalogDensity() {
    const next: PosCatalogDensity = catalogDensity === "compact" ? "comfortable" : "compact";
    catalogDensityExplicitRef.current = true;
    setCatalogDensityState(next);
    setCatalogDensity(registerId, next);
  }

  useEffect(() => {
    if (!catalogTruncated || debouncedSearch.trim().length < 2 || !isBrowserOnline()) {
      setServerSearchItems(null);
      setServerSearchLoading(false);
      return;
    }

    let cancelled = false;
    setServerSearchLoading(true);
    void fetchPosCatalogPage(registerId, {
      search: debouncedSearch,
      category,
      limit: 200,
    })
      .then((page) => {
        if (!cancelled) setServerSearchItems(page.items);
      })
      .catch(() => {
        if (!cancelled) setServerSearchItems(null);
      })
      .finally(() => {
        if (!cancelled) setServerSearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [catalogTruncated, debouncedSearch, category, registerId]);

  useEffect(() => {
    if (!session) return;
    if (lastSale) return;
    if (showPayment) return;

    const lineDiscount = lines.reduce((s, l) => s + l.discountAmount, 0);
    const payload = {
      registerId,
      orgName,
      storeName,
      currency,
      phase: "cart" as const,
      lines: lines.map((l) => ({
        name: l.productName,
        qty: l.quantity,
        total: l.unitPrice * l.quantity - l.discountAmount,
      })),
      subtotal,
      tax,
      discount: lineDiscount + cartDiscount,
      promoDiscount,
      tipAmount: 0,
      total,
      updatedAt: Date.now(),
    };

    if (customerDisplayTimerRef.current) {
      clearTimeout(customerDisplayTimerRef.current);
    }
    customerDisplayTimerRef.current = setTimeout(() => {
      publishCustomerDisplay(payload);
    }, 150);

    return () => {
      if (customerDisplayTimerRef.current) {
        clearTimeout(customerDisplayTimerRef.current);
      }
    };
  }, [
    session,
    registerId,
    orgName,
    storeName,
    currency,
    lines,
    subtotal,
    tax,
    cartDiscount,
    promoDiscount,
    total,
    showPayment,
    lastSale,
  ]);

  useEffect(() => {
    if (!session || !lastSale) return;

    const changeDue =
      lastSale.changeDue ?? totalChangeFromPayments(lastSale.payments);
    publishCustomerDisplay({
      registerId,
      orgName,
      storeName,
      currency,
      phase: lastSale.pollPaymentStatus ? "pending_payment" : "paid",
      lines: lastSale.lines.map((l) => ({
        name: l.product_name,
        qty: l.quantity,
        total: l.line_total,
      })),
      subtotal: lastSale.sale.subtotal,
      tax: lastSale.sale.tax_amount,
      discount: lastSale.sale.discount_amount,
      promoDiscount: 0,
      tipAmount: (lastSale.sale as { tip_amount?: number }).tip_amount ?? 0,
      total: lastSale.sale.total,
      changeDue,
      receiptNo: lastSale.sale.receipt_no,
      paymentStatus: lastSale.pollPaymentStatus ? "pending" : "confirmed",
      saleId: lastSale.saleId,
      sessionToken: posStaffSession?.token ?? null,
      updatedAt: Date.now(),
    });
  }, [session, lastSale, registerId, orgName, storeName, currency, posStaffSession?.token]);

  useEffect(() => {
    if (!lastSale || !getPosAutoReturn(registerId)) return;
    const delayMs = lastSale.pollPaymentStatus ? 20_000 : 6_000;
    const id = window.setTimeout(() => setLastSale(null), delayMs);
    return () => clearTimeout(id);
  }, [lastSale, registerId]);

  useEffect(() => {
    if (lines.length === 0) setDiscountOverride(false);
  }, [lines.length]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY(organizationId));
      if (raw) setFavorites(new Set(JSON.parse(raw)));
    } catch {
      /* ignore */
    }
  }, [organizationId]);

  useEffect(() => {
    if (session || initialSession) return;
    void getCachedPosSession(registerId).then((cached) => {
      if (cached) setSession(cached);
    });
  }, [registerId, session, initialSession]);

  const handleRecallHeld = useCallback(() => {
    if (heldCarts.length === 0) return;
    if (heldCarts.length === 1) {
      recall(heldCarts[0].id);
    } else {
      setShowHeldCartPicker(true);
    }
  }, [heldCarts, recall]);

  const toggleFavorite = useCallback(
    (variantId: string) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(variantId)) next.delete(variantId);
        else next.add(variantId);
        localStorage.setItem(FAVORITES_KEY(organizationId), JSON.stringify([...next]));
        return next;
      });
    },
    [organizationId]
  );

  const catalogSearchIndex = useMemo(
    () => buildCatalogSearchIndex(localCatalog),
    [localCatalog]
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim();
    const localFiltered = filterCatalogItems(localCatalog, catalogSearchIndex, {
      search: debouncedSearch,
      category,
      viewFavorites,
      viewRecent,
      favorites,
      recentVariantIds,
    });

    // Prefer non-empty server hits for truncated catalogs; empty array is a miss → fall back local
    if (catalogTruncated && q.length >= 2 && serverSearchItems && serverSearchItems.length > 0) {
      return serverSearchItems;
    }
    return localFiltered;
  }, [
    catalogTruncated,
    serverSearchItems,
    localCatalog,
    catalogSearchIndex,
    debouncedSearch,
    category,
    viewFavorites,
    viewRecent,
    favorites,
    recentVariantIds,
  ]);

  const addProductByVariantId = useCallback(
    (variantId: string) => {
      if (!session) return;
      const item = catalogByVariant.get(variantId);
      if (!item) return;

      // Weight/volume products: enter measurement — do not add as 1 pc.
      if (hasMeasuredSaleUoms(item)) {
        if (item.stock <= 0) {
          setStockToast(t("itemOutOfStock", { name: item.name }));
          setTimeout(() => setStockToast(null), 3500);
          return;
        }
        setMeasureItem(item);
        setSearch("");
        return;
      }

      const currentLines = useCartStore.getState().lines;
      const saleUom = defaultSaleUom(item);
      const factor = Number(saleUom.factor) || 1;
      const check = canAddToCart(item, currentLines, 1, factor);
      if (!check.ok) {
        setStockToast(
          check.values ? t(check.messageKey, check.values) : t(check.messageKey)
        );
        setTimeout(() => setStockToast(null), 3500);
        return;
      }
      rememberPreferredSaleUom(item.variantId, saleUom.code);
      addLine({
        variantId: item.variantId,
        productName: item.name,
        variantName: item.variantName,
        unitPrice: Math.round(item.sellPrice * factor * 100) / 100,
        baseUnitPrice: item.sellPrice,
        uomCode: saleUom.code,
        uomLabel: saleUom.name,
        uomFactor: factor,
        saleUoms: item.saleUoms,
      });
      setFlashVariant(item.variantId);
      setTimeout(() => setFlashVariant(null), 400);
      setSearch("");
      searchRef.current?.focus();
    },
    [session, catalogByVariant, addLine, t]
  );

  const confirmMeasuredQty = useCallback(
    (item: PosCatalogItem, qty: number, uom: { code: string; name: string; factor: number }) => {
      const currentLines = useCartStore.getState().lines;
      const factor = Number(uom.factor) || 1;
      const check = canAddToCart(item, currentLines, qty, factor);
      if (!check.ok) {
        setStockToast(
          check.values ? t(check.messageKey, check.values) : t(check.messageKey)
        );
        setTimeout(() => setStockToast(null), 3500);
        return;
      }
      rememberPreferredSaleUom(item.variantId, uom.code);
      addLine({
        variantId: item.variantId,
        productName: item.name,
        variantName: item.variantName,
        quantity: qty,
        unitPrice: Math.round(item.sellPrice * factor * 100) / 100,
        baseUnitPrice: item.sellPrice,
        uomCode: uom.code,
        uomLabel: uom.name,
        uomFactor: factor,
        saleUoms: item.saleUoms,
      });
      setMeasureItem(null);
      setFlashVariant(item.variantId);
      setTimeout(() => setFlashVariant(null), 400);
      searchRef.current?.focus();
    },
    [addLine, t]
  );

  const isManager = posStaffSession?.role === "manager";
  const discountPct = discountPctOfSubtotal(lines, cartDiscount, promoDiscount);
  const hasInvalidDiscounts = exceedsAbsoluteDiscountLimit(lines, cartDiscount, promoDiscount);
  const needsManagerForDiscount =
    !hasInvalidDiscounts &&
    !isManager &&
    !discountOverride &&
    exceedsCashierDiscountLimit(lines, cartDiscount, maxCashierDiscountPct, promoDiscount);

  function showDiscountToast(message: string) {
    setStockToast(message);
    setTimeout(() => setStockToast(null), 3500);
  }

  function commitDiscount(prep: ReturnType<typeof prepareDiscountApplication>, request: DiscountApplyRequest) {
    if (request.type === "line") {
      const line = prep.lines.find(
        (l) =>
          l.variantId === request.variantId &&
          (l.uomCode || "ea").toLowerCase() === (request.uomCode || "ea").toLowerCase()
      );
      if (line) setLineDiscount(request.variantId, line.discountAmount, request.uomCode);
    } else {
      setCartDiscount(prep.cartDiscount);
    }
  }

  async function handleApplyPromo(code: string) {
    setPromoError(null);
    if (!isBrowserOnline()) {
      setPromoError(t("connectToApplyPromo"));
      return;
    }
    setPromoBusy(true);
    const result = await validatePromotionCode(
      organizationId,
      code,
      lines,
      posStaffSession?.token
    );
    setPromoBusy(false);
    if (!result.ok) {
      setPromoError(result.message);
      return;
    }
    applyPromotion({
      code: result.promotion.code,
      discountAmount: result.promotion.discountAmount,
      promotionId: result.promotion.promotionId,
      name: result.promotion.name,
    });
  }

  function handleClearPromo() {
    clearPromotion();
    setPromoError(null);
  }

  function applyDiscountWithPolicy(next: DiscountApplyRequest) {
    const prep = prepareDiscountApplication(next, lines, cartDiscount, promoDiscount);
    if (prep.blocked) {
      showDiscountToast(t("discountExceeds100"));
      return;
    }

    const testLines = next.type === "line" ? prep.lines : lines;
    const testCartDiscount = next.type === "cart" ? prep.cartDiscount : cartDiscount;

    if (
      !isManager &&
      !discountOverride &&
      exceedsCashierDiscountLimit(
        testLines,
        testCartDiscount,
        maxCashierDiscountPct,
        promoDiscount
      )
    ) {
      setPendingDiscount(next);
      setShowManagerPin(true);
      return;
    }

    commitDiscount(prep, next);
  }

  async function handleBarcodeScan(code: string): Promise<BarcodeScanResult> {
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const item = lookupCatalogByBarcode(catalogSearchIndex, code);
    if (item) {
      addProductByVariantId(item.variantId);
      perfNow("pos.barcode", { path: "local", ms: Math.round(performance.now() - t0) });
      return { ok: true, label: item.name };
    }

    // Server fallback when catalog is truncated or SKU outside bootstrap slice
    if (isBrowserOnline() && (catalogTruncated || isValidBarcode(normalizeBarcode(code)))) {
      try {
        const remote = await fetchProductByBarcode(registerId, code);
        if (remote) {
          mergeCatalogItem(remote);
          addProductByVariantId(remote.variantId);
          perfNow("pos.barcode", { path: "server", ms: Math.round(performance.now() - t0) });
          return { ok: true, label: remote.name };
        }
      } catch {
        /* fall through to miss */
      }
    }

    perfNow("pos.barcode", { path: "miss", ms: Math.round(performance.now() - t0) });
    return { ok: false };
  }

  const stopScannerStream = useCallback(() => {
    scannerStreamRef.current?.getTracks().forEach((t) => t.stop());
    scannerStreamRef.current = null;
  }, []);

  const openCameraScanner = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStockToast(t("cameraNotAvailable"));
      setTimeout(() => setStockToast(null), 3500);
      return;
    }
    try {
      stopScannerStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      scannerStreamRef.current = stream;
      setShowScanner(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("couldNotOpenCamera");
      setStockToast(
        /denied|notallowed|permission/i.test(msg)
          ? t("allowCameraAccess")
          : msg
      );
      setTimeout(() => setStockToast(null), 4500);
    }
  }, [stopScannerStream]);

  const closeCameraScanner = useCallback(() => {
    setShowScanner(false);
    stopScannerStream();
  }, [stopScannerStream]);

  function openCustomerDisplay() {
    setShowTools(false);
    openCustomerDisplayWindow(registerId);
  }

  const updateQtyWithStock = useCallback(
    (variantId: string, quantity: number, uomCode?: string) => {
      const item = catalogByVariant.get(variantId);
      const line = lines.find(
        (l) =>
          l.variantId === variantId &&
          (l.uomCode || "ea").toLowerCase() === (uomCode || "ea").toLowerCase()
      );
      const factor = line?.uomFactor ?? 1;
      if (item && quantity > 0) {
        const others = lines.filter(
          (l) =>
            !(
              l.variantId === variantId &&
              (l.uomCode || "ea").toLowerCase() === (uomCode || "ea").toLowerCase()
            )
        );
        const check = canAddToCart(item, others, quantity, factor);
        if (!check.ok) {
          setStockToast(
            check.values ? t(check.messageKey, check.values) : t(check.messageKey)
          );
          setTimeout(() => setStockToast(null), 3500);
          return;
        }
      }
      updateQuantity(variantId, quantity, uomCode);
    },
    [catalogByVariant, lines, updateQuantity]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Escape") {
        if (showPayment) setShowPayment(false);
        else if (showCustomerLookup) setShowCustomerLookup(false);
        else if (showCloseShift) setShowCloseShift(false);
        else if (showRefund) setShowRefund(false);
        else if (showTools) setShowTools(false);
        else if (showScanner) closeCameraScanner();
        else if (showManagerPin) {
          setShowManagerPin(false);
          setPendingDiscount(null);
          setPendingCheckout(false);
        } else if (showHeldCartPicker) setShowHeldCartPicker(false);
        else if (showShortcutsHelp) setShowShortcutsHelp(false);
        else if (showOfflineQueue) setShowOfflineQueue(false);
        else if (lastSale) setLastSale(null);
        return;
      }

      if (typing || modalOpen) return;

      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F3" && lines.length > 0) {
        e.preventDefault();
        hold();
      } else if (e.key === "F4" && heldCarts.length > 0) {
        e.preventDefault();
        handleRecallHeld();
      } else if (e.key === "F5") {
        e.preventDefault();
        setShowCustomerLookup(true);
      } else if (e.key === "F6") {
        e.preventDefault();
        setShowCloseShift(true);
      } else if (e.key === "F7") {
        e.preventDefault();
        setShowRefund(true);
      } else if (e.key === "F8" && lines.length > 0) {
        e.preventDefault();
        if (hasInvalidDiscounts) {
          showDiscountToast(t("fixDiscountsBeforeCheckout"));
        } else if (needsManagerForDiscount) {
          setPendingCheckout(true);
          setShowManagerPin(true);
        } else {
          setShowPayment(true);
        }
      } else if (e.key === "F9") {
        e.preventDefault();
        void openCameraScanner();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    modalOpen,
    showPayment,
    showCustomerLookup,
    showCloseShift,
    showRefund,
    showTools,
    showScanner,
    showManagerPin,
    showHeldCartPicker,
    showShortcutsHelp,
    showOfflineQueue,
    lastSale,
    lines.length,
    heldCarts,
    hold,
    recall,
    handleRecallHeld,
    openCameraScanner,
    closeCameraScanner,
    needsManagerForDiscount,
    hasInvalidDiscounts,
    cartDiscount,
  ]);

  useEffect(() => {
    if (!search) return;
    const hit = lookupCatalogByBarcode(catalogSearchIndex, search);
    if (hit && search.length >= 4) {
      addProductByVariantId(hit.variantId);
      return;
    }
    // Truncated catalog: barcode-shaped input with no local hit → server exact lookup
    if (
      catalogTruncated &&
      isBrowserOnline() &&
      isValidBarcode(normalizeBarcode(search)) &&
      search.length >= 4
    ) {
      let cancelled = false;
      void fetchProductByBarcode(registerId, search).then((remote) => {
        if (cancelled || !remote) return;
        mergeCatalogItem(remote);
        addProductByVariantId(remote.variantId);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [
    search,
    catalogSearchIndex,
    addProductByVariantId,
    catalogTruncated,
    registerId,
    mergeCatalogItem,
  ]);

  async function openShift() {
    setShiftError(null);

    if (!isBrowserOnline()) {
      setShiftError(t("connectToOpenShift"));
      return;
    }

    const supabase = createClient();
    const float = parseFloat(openingFloat) || 0;

    if (posStaffSession) {
      const { data, error } = await supabase.rpc("open_register_session_staff", {
        p_register_id: registerId,
        p_session_token: posStaffSession.token,
        p_opening_float: float,
      });
      if (error) {
        setShiftError(error.message);
        return;
      }
      if (data) {
        const result = data as { session_id: string };
        const nextSession = {
          id: result.session_id,
          opening_float: float,
          opened_at: new Date().toISOString(),
        };
        setSession(nextSession);
        void cachePosSession(registerId, nextSession);
      }
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase.rpc("open_register_session_manager", {
      p_register_id: registerId,
      p_organization_id: organizationId,
      p_opening_float: float,
      p_staff_id: null,
    });
    if (error) {
      setShiftError(error.message);
      return;
    }
    if (data) {
      const result = data as { session_id: string };
      const nextSession = {
        id: result.session_id,
        opening_float: float,
        opened_at: new Date().toISOString(),
      };
      setSession(nextSession);
      void cachePosSession(registerId, nextSession);
    }
  }

  function paymentsNeedPolling(payments: Parameters<typeof ReceiptPrint>[0]["payments"]) {
    return payments.some(
      (p) =>
        p.method === "mobile_money" &&
        (p.status === "pending" || (!p.webhook_confirmed_at && p.reference))
    );
  }

  async function onCheckoutComplete(result: {
    receipt_no: string;
    total: number;
    sale_id: string;
    pendingSync?: boolean;
    changeDue?: number;
    tipAmount?: number;
    offlinePayments?: {
      method: string;
      amount: number;
      reference: string | null;
      cash_tendered: number | null;
      change_given: number | null;
    }[];
  }) {
    const soldVariantIds = lines.map((l) => l.variantId);
    if (soldVariantIds.length > 0) {
      recordRecentVariants(registerId, soldVariantIds);
      setRecentVariantIds(getRecentVariantIds(registerId));
    }

    if (result.pendingSync) {
      const receiptLines = lines.map((l) => ({
        product_name: l.productName,
        variant_name: l.variantName || null,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        line_total: l.unitPrice * l.quantity - l.discountAmount,
        uom_code: l.uomCode || null,
      }));

      await decrementCachedPosStock(
        registerId,
        lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          uomFactor: l.uomFactor ?? 1,
        }))
      );
      setLocalCatalog((prev) =>
        prev.map((item) => {
          const soldBase = lines
            .filter((l) => l.variantId === item.variantId)
            .reduce((sum, l) => sum + l.quantity * (l.uomFactor ?? 1), 0);
          if (!soldBase) return item;
          return { ...item, stock: Math.max(0, item.stock - soldBase) };
        })
      );

      setLastSale({
        sale: {
          receipt_no: result.receipt_no,
          created_at: new Date().toISOString(),
          subtotal,
          tax_amount: tax,
          discount_amount: cartDiscount + lines.reduce((s, l) => s + l.discountAmount, 0) + promoDiscount,
          tip_amount: result.tipAmount ?? 0,
          total: result.total,
          status: "pending_sync",
        },
        lines: receiptLines,
        payments: result.offlinePayments ?? [],
        changeDue: result.changeDue ?? totalChangeFromPayments(result.offlinePayments ?? []),
      });
      clear();
      clearCustomer();
      setShowPayment(false);
      rotateDraftTicketId();
      return;
    }

    const supabase = createClient();

    if (posStaffSession) {
      const { data } = await supabase.rpc("get_pos_sale_receipt", {
        p_sale_id: result.sale_id,
        p_session_token: posStaffSession.token,
      });
      if (data) {
        const payload = data as {
          sale: Record<string, unknown>;
          lines: Parameters<typeof ReceiptPrint>[0]["lines"];
          payments: Parameters<typeof ReceiptPrint>[0]["payments"];
        };
        const sale = payload.sale;
        setLastSale({
          saleId: result.sale_id,
          sale: {
            receipt_no: sale.receipt_no as string,
            created_at: sale.created_at as string,
            subtotal: sale.subtotal as number,
            tax_amount: sale.tax_amount as number,
            discount_amount: sale.discount_amount as number,
            total: sale.total as number,
            status: sale.status as string,
          },
          lines: payload.lines,
          payments: payload.payments,
          pollPaymentStatus: paymentsNeedPolling(payload.payments),
          changeDue:
            result.changeDue ?? totalChangeFromPayments(payload.payments),
        });
      }
    } else {
      const { data: sale } = await supabase
        .from("sales")
        .select("*, sale_lines(*), payments(*)")
        .eq("id", result.sale_id)
        .single();

      if (sale) {
        setLastSale({
          saleId: result.sale_id,
          sale: {
            receipt_no: sale.receipt_no,
            created_at: sale.created_at,
            subtotal: sale.subtotal,
            tax_amount: sale.tax_amount,
            discount_amount: sale.discount_amount,
            total: sale.total,
            status: sale.status,
          },
          lines: sale.sale_lines as Parameters<typeof ReceiptPrint>[0]["lines"],
          payments: sale.payments as Parameters<typeof ReceiptPrint>[0]["payments"],
          pollPaymentStatus: paymentsNeedPolling(
            sale.payments as Parameters<typeof ReceiptPrint>[0]["payments"]
          ),
          changeDue:
            result.changeDue ??
            totalChangeFromPayments(
              sale.payments as Parameters<typeof ReceiptPrint>[0]["payments"]
            ),
        });
      }
    }

    clear();
    clearCustomer();
    setShowPayment(false);
    rotateDraftTicketId();
    void refreshStock(soldVariantIds);
  }

  async function handleShiftClosed() {
    setShowCloseShift(false);
    setSession(null);
    await clearCachedPosSession(registerId);
    onShiftClosed?.();
  }

  /* ── Shift open screen ── */
  if (!session) {
    return (
      <main className="pos-root pos-shell flex h-full flex-col items-center justify-center p-6">
        <div className="pos-card-elevated w-full max-w-md p-8 animate-[pos-scale-in_0.3s_ease]">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-pos-navy text-2xl font-bold text-white shadow-lg">
              N
            </div>
            <h1 className="pos-heading text-2xl font-bold tracking-tight text-slate-900">{registerName}</h1>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-slate-500">
              <Store className="h-4 w-4" />
              {storeName}
            </p>
          </div>
          <p className="mb-6 text-center text-sm font-medium text-slate-600">
            {t("openShiftToSell")}
          </p>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t("openingFloat")}
          </label>
          <Input
            type="number"
            placeholder="0.00"
            value={openingFloat}
            onChange={(e) => setOpeningFloat(e.target.value)}
            className="mb-5 h-14 rounded-xl border-slate-200 bg-white text-xl font-semibold text-slate-900"
          />
          <Button
            size="lg"
            className="h-14 w-full cursor-pointer rounded-xl bg-pos-primary text-base font-semibold text-white shadow-md hover:bg-pos-primary-dark"
            onClick={openShift}
          >
            {t("openShift")}
          </Button>
          {shiftError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{shiftError}</p>
          )}
          {!isBrowserOnline() && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t("offlineReopenShift")}
            </p>
          )}
          {onStaffSignOut && (
            <Button variant="ghost" className="mt-4 w-full text-slate-500 hover:text-slate-900" onClick={onStaffSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              {t("switchStaff")}
            </Button>
          )}
          <div className="mt-2 flex justify-center">
            <PosRegisterSwitcher registerId={registerId} registerName={registerName} tone="onLight" />
          </div>
        </div>
      </main>
    );
  }

  /* ── Main POS ── */
  return (
    <div className="pos-root pos-shell flex h-full flex-col overflow-hidden">
      {/* Top bar */}
      <header className="pos-header flex h-12 shrink-0 items-center justify-between px-3 sm:h-14 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-white ring-1 ring-white/20 sm:h-9 sm:w-9 sm:rounded-xl sm:text-sm">
            N
          </div>
          <div className="min-w-0">
            <p className="pos-heading truncate text-sm font-semibold text-white">{registerName}</p>
            <p className="flex flex-wrap items-center gap-1 text-[10px] text-white/70 sm:gap-1.5 sm:text-xs">
              <Store className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="truncate">{storeName}</span>
              <span className="text-white/30">·</span>
              <CircleDot className="h-3 w-3 text-emerald-400" />
              <span className="hidden sm:inline">{t("shiftOpen")}</span>
              <PosSyncBadge onOpenQueue={() => setShowOfflineQueue(true)} />
              {!offline?.online && (
                <span className="ml-1 rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                  {t("offline")}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-3 text-sm text-white/80 md:flex">
          {posStaffSession ? (
            <span className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 font-medium text-white">
              <User className="h-4 w-4" />
              {posStaffSession.displayName}
            </span>
          ) : (
            userEmail && <span>{userEmail}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer border-white/20 bg-white/10 px-2.5 text-white hover:bg-white/20 hover:text-white"
            onClick={() => setShowTools(true)}
            title={t("posTools")}
            aria-label={t("openPosTools")}
          >
            <Wrench className="h-4 w-4" aria-hidden />
          </Button>
          {/* Secondary shift actions live in Tools on narrow viewports */}
          <div className="hidden items-center gap-2 sm:flex">
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer border-white/20 bg-white/10 px-2.5 text-white hover:bg-white/20 hover:text-white sm:px-3"
              onClick={() => setShowRefund(true)}
              title={t("voidRefundTitle")}
              aria-label={t("voidRefundAria")}
            >
              <RotateCcw className="h-4 w-4 sm:mr-1.5" aria-hidden />
              <span className="hidden md:inline">{t("refunds")}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer border-white/20 bg-white/10 px-2.5 text-white hover:bg-white/20 hover:text-white sm:px-3"
              onClick={() => setShowCloseShift(true)}
              title={t("closeShiftTitle")}
              aria-label={t("closeShiftAria")}
            >
              <DoorClosed className="h-4 w-4 sm:mr-1.5" aria-hidden />
              <span className="hidden md:inline">{t("closeShift")}</span>
            </Button>
            <PosRegisterSwitcher registerId={registerId} registerName={registerName} />
          </div>
          {onStaffSignOut && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer border-white/20 bg-white/10 px-2.5 text-white hover:bg-white/20 hover:text-white sm:px-3"
              onClick={onStaffSignOut}
              aria-label={t("switchStaffAria")}
            >
              <LogOut className="h-4 w-4 sm:mr-1.5" aria-hidden />
              <span className="hidden sm:inline">{t("switchStaff")}</span>
            </Button>
          )}
        </div>
      </header>

      {session && (
        <ShiftStatsBar
          sessionId={session.id}
          sessionToken={posStaffSession?.token}
          currency={currency}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Products — ~70% */}
        <div className="flex min-h-0 flex-[1.1] flex-col pb-16 lg:min-h-0 lg:flex-1 lg:pb-0">
          <div className="shrink-0 space-y-2 border-b border-slate-200/80 bg-white px-3 py-2 sm:px-4 sm:py-2.5">
            <label className="pos-search-wrap flex h-11 items-center gap-2 px-2.5 sm:h-12">
              <span className="sr-only">{t("searchProducts")}</span>
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <Input
                ref={searchRef}
                id="pos-product-search"
                placeholder={t("searchProducts")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 flex-1 border-0 bg-transparent pl-0 pr-0 text-sm shadow-none focus-visible:ring-0 sm:text-[15px]"
                autoFocus
                aria-describedby="pos-search-hint"
              />
              <span id="pos-search-hint" className="sr-only">
                {t("searchHint")}
              </span>
              <button
                type="button"
                onClick={() => void openCameraScanner()}
                className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-600 hover:border-pos-primary/40 hover:bg-pos-primary-soft-8 hover:text-pos-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary"
                title={t("scanCameraTitle")}
                aria-label={t("scanCameraAria")}
              >
                <ScanBarcode className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{t("camera")}</span>
              </button>
            </label>
            <CategoryNav
              categories={categories}
              active={category}
              onChange={(c) => {
                setCategory(c);
                setViewFavorites(false);
                setViewRecent(false);
              }}
              showFavorites={favorites.size > 0}
              showRecent={recentVariantIds.length > 0}
              favoritesActive={viewFavorites}
              recentActive={viewRecent}
              onFavorites={() => {
                setViewFavorites(true);
                setViewRecent(false);
              }}
              onRecent={() => {
                setViewRecent(true);
                setViewFavorites(false);
              }}
            />
          </div>

          {stockToast && (
            <div
              role="status"
              aria-live="polite"
              className="mx-5 mb-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900"
            >
              {stockToast}
            </div>
          )}

          {catalogStale && (
            <div className="mx-5 mb-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
              {t("catalogStale", { cached: catalogCachedAt ? t("catalogCached", { datetime: new Date(catalogCachedAt).toLocaleString() }) : "" })}
              {!offline?.online ? t("catalogStaleOffline") : t("catalogStaleOnline")}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="pos-heading min-w-0 truncate text-[13px] font-semibold text-slate-700" id="pos-catalog-heading">
                {viewFavorites ? t("favorites") : viewRecent ? t("recent") : category === "all" ? t("allProducts") : category}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <div
                  className="flex overflow-hidden rounded-md border border-slate-200 bg-white p-0.5"
                  role="group"
                  aria-label={t("productCardSize")}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (catalogDensity !== "compact") toggleCatalogDensity();
                    }}
                    className={cn(
                      "flex h-7 cursor-pointer items-center justify-center gap-1 rounded px-2 text-[11px] font-semibold transition-colors",
                      catalogDensity === "compact"
                        ? "bg-pos-primary text-white"
                        : "text-slate-500 hover:text-slate-700"
                    )}
                    title={t("compactTitle")}
                    aria-label={t("compactAria")}
                    aria-pressed={catalogDensity === "compact"}
                  >
                    <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (catalogDensity !== "comfortable") toggleCatalogDensity();
                    }}
                    className={cn(
                      "flex h-7 cursor-pointer items-center justify-center gap-1 rounded px-2 text-[11px] font-semibold transition-colors",
                      catalogDensity === "comfortable"
                        ? "bg-pos-primary text-white"
                        : "text-slate-500 hover:text-slate-700"
                    )}
                    title={t("largeTitle")}
                    aria-label={t("largeAria")}
                    aria-pressed={catalogDensity === "comfortable"}
                  >
                    <Rows3 className="h-3.5 w-3.5 shrink-0" />
                  </button>
                </div>
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                  {filtered.length}
                </span>
              </div>
            </div>
            {filtered.length === 0 ? (
              <div
                id="pos-catalog-panel"
                role="tabpanel"
                aria-labelledby="pos-catalog-heading"
                className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/60 text-slate-400"
              >
                <Search className="mb-2 h-8 w-8 opacity-30" aria-hidden />
                <p className="pos-heading text-sm font-semibold text-slate-500" role="status">
                  {serverSearchLoading ? t("searching") : t("noProductsFound")}
                </p>
                {!serverSearchLoading && (
                  <p className="mt-0.5 text-xs">{t("tryDifferentSearch")}</p>
                )}
              </div>
            ) : (
              <div
                id="pos-catalog-panel"
                role="tabpanel"
                aria-labelledby="pos-catalog-heading"
                className="min-h-0 flex-1"
              >
                <VirtualizedCatalogGrid
                  items={filtered}
                  currency={currency}
                  density={catalogDensity}
                  favorites={favorites}
                  recentVariantIds={recentVariantIds}
                  flashVariant={flashVariant}
                  onAdd={addProductByVariantId}
                  onToggleFavorite={toggleFavorite}
                />
              </div>
            )}
          </div>
        </div>

        {/* Cart — drawer on mobile, sidebar on desktop */}
        {showMobileCart && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            aria-label={t("closeCartOverlay")}
            onClick={() => setShowMobileCart(false)}
          />
        )}

        {!showMobileCart && lines.length > 0 && (
        <button
          type="button"
          className="fixed inset-x-3 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-30 flex h-12 items-center justify-between gap-3 rounded-xl bg-pos-navy px-3 text-white shadow-lg lg:hidden"
          onClick={() => setShowMobileCart(true)}
          aria-label={t("openCartAria", { count: lines.reduce((s, l) => s + l.quantity, 0), total: formatCurrency(total, currency) })}
        >
            <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
              <ShoppingCart className="h-4 w-4 shrink-0" />
              <span className="truncate">{t("cartWithCount", { count: lines.reduce((s, l) => s + l.quantity, 0) })}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-bold tabular-nums text-sm">{formatCurrency(total, currency)}</span>
              <span className="rounded-md bg-pos-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide">
                {t("pay")}
              </span>
            </span>
          </button>
        )}

        <div
          className={cn(
            "flex min-h-0 flex-col",
            showMobileCart
              ? "fixed inset-x-0 bottom-0 top-12 z-40 flex max-h-[calc(100dvh-3rem)] bg-white shadow-2xl sm:top-14 sm:max-h-[calc(100dvh-3.5rem)]"
              : "hidden",
            "lg:relative lg:inset-auto lg:top-auto lg:flex lg:max-h-none lg:shadow-none"
          )}
          role={showMobileCart ? "dialog" : undefined}
          aria-modal={showMobileCart ? true : undefined}
          aria-label={showMobileCart ? t("shoppingCart") : undefined}
        >
        <CartPanel
          lines={lines}
          currency={currency}
          subtotal={subtotal}
          tax={tax}
          taxRate={taxRate}
          cartDiscount={cartDiscount}
          promoDiscount={promoDiscount}
          promoCode={promoCode}
          promotionName={promotionName}
          promoBusy={promoBusy}
          promoError={promoError}
          onApplyPromo={(code) => void handleApplyPromo(code)}
          onClearPromo={handleClearPromo}
          total={total}
          heldCount={heldCarts.length}
          customerName={customerName}
          customerPhone={customerPhone}
          customerCreditBalance={customerCreditBalance}
          customerReceivableBalance={customerReceivableBalance}
          customerOnAccountEnabled={customerOnAccountEnabled}
          customerCreditAvailable={customerCreditAvailable}
          catalogByVariant={catalogByVariant}
          onCustomerLookup={() => setShowCustomerLookup(true)}
          onClearCustomer={clearCustomer}
          onCustomerName={setCustomerName}
          onCustomerPhone={setCustomerPhone}
          onUpdateQty={updateQtyWithStock}
          onRemove={removeLine}
          maxCashierDiscountPct={maxCashierDiscountPct}
          discountPct={discountPct}
          needsManagerOverride={needsManagerForDiscount}
          onDiscount={(variantId, amount, uomCode) =>
            applyDiscountWithPolicy({ type: "line", variantId, amount, uomCode })
          }
          onSetUom={(variantId, fromUom, toUom) => {
            rememberPreferredSaleUom(variantId, toUom);
            setLineUom(variantId, fromUom, toUom);
          }}
          onCartDiscount={(amount) => applyDiscountWithPolicy({ type: "cart", amount })}
          onHold={hold}
          onRecallHeld={handleRecallHeld}
          onCheckout={() => {
            if (hasInvalidDiscounts) {
              showDiscountToast(t("fixDiscountsBeforeCheckout"));
              return;
            }
            if (needsManagerForDiscount) {
              setPendingCheckout(true);
              setShowManagerPin(true);
              return;
            }
            setShowMobileCart(false);
            setShowPayment(true);
          }}
          onCloseMobile={() => setShowMobileCart(false)}
          orderNumber={orderSeq}
        />
        </div>
      </div>

      {showPayment && (
        <PaymentModal
          total={total}
          subtotal={subtotal}
          tax={tax}
          promoDiscount={promoDiscount}
          currency={currency}
          lines={lines}
          cartDiscount={cartDiscount}
          promoCode={promoCode}
          registerId={registerId}
          storeId={storeId}
          sessionId={session.id}
          organizationId={organizationId}
          orgName={orgName}
          storeName={storeName}
          customerName={customerName || null}
          customerPhone={customerPhone || null}
          customerId={customerId}
          customerCreditBalance={customerCreditBalance}
          customerOnAccountEnabled={customerOnAccountEnabled}
          customerCreditAvailable={customerCreditAvailable}
          customerReceivableBalance={customerReceivableBalance}
          tipsEnabled={tipsEnabled}
          tipPresets={tipPresets}
          loyaltyEnabled={loyaltyEnabled}
          customerLoyaltyPoints={customerLoyaltyPoints}
          loyaltySpendPerPoint={loyaltySpendPerPoint}
          loyaltyMinRedeemPoints={loyaltyMinRedeemPoints}
          onClose={() => setShowPayment(false)}
          onComplete={onCheckoutComplete}
          posSessionToken={posStaffSession?.token}
          posStaffId={posStaffSession?.staffId}
          managerDiscountPin={managerDiscountPin}
        />
      )}

      {showCustomerLookup && (
        <CustomerLookupModal
          registerId={registerId}
          currency={currency}
          sessionToken={posStaffSession?.token}
          onSelect={selectCustomer}
          onClose={() => setShowCustomerLookup(false)}
        />
      )}

      {showCloseShift && session && (
        <CloseShiftModal
          sessionId={session.id}
          registerName={registerName}
          storeName={storeName}
          orgName={orgName}
          currency={currency}
          sessionToken={posStaffSession?.token}
          onClosed={() => void handleShiftClosed()}
          onClose={() => setShowCloseShift(false)}
        />
      )}

      {showRefund && session && (
        <RefundModal
          sessionId={session.id}
          currency={currency}
          sessionToken={posStaffSession?.token}
          staffRole={posStaffSession?.role}
          canVoidAsManager={!posStaffSession}
          onClose={() => setShowRefund(false)}
          onVoided={() => {
            // Refresh stock for currently cached catalog (lighter than full catalog RPC)
            void refreshStock(localCatalog.map((c) => c.variantId));
          }}
        />
      )}

      {showTools && (
        <PosToolsMenu
          registerId={registerId}
          registerName={registerName}
          sessionId={session.id}
          sessionToken={posStaffSession?.token}
          onOpenCustomerDisplay={openCustomerDisplay}
          onOpenScanner={() => {
            setShowTools(false);
            void openCameraScanner();
          }}
          onOpenRefund={() => {
            setShowTools(false);
            setShowRefund(true);
          }}
          onOpenCloseShift={() => {
            setShowTools(false);
            setShowCloseShift(true);
          }}
          onOpenShortcuts={() => {
            setShowTools(false);
            setShowShortcutsHelp(true);
          }}
          onOpenOfflineQueue={() => {
            setShowTools(false);
            setShowOfflineQueue(true);
          }}
          onClose={() => setShowTools(false)}
        />
      )}

      {showOfflineQueue && (
        <PosOfflineQueueModal currency={currency} onClose={() => setShowOfflineQueue(false)} />
      )}

      {showHeldCartPicker && (
        <HeldCartPickerModal
          heldCarts={heldCarts}
          currency={currency}
          taxRate={taxRate}
          taxInclusive={taxInclusive}
          onRecall={recall}
          onClose={() => setShowHeldCartPicker(false)}
        />
      )}

      {measureItem && (
        <MeasureQtyModal
          item={measureItem}
          currency={currency}
          onClose={() => setMeasureItem(null)}
          onConfirm={({ qty, uom }) => confirmMeasuredQty(measureItem, qty, uom)}
        />
      )}

      {showShortcutsHelp && (
        <ShortcutsHelpModal onClose={() => setShowShortcutsHelp(false)} />
      )}

      {showScanner && (
        <BarcodeScannerModal
          initialStream={scannerStreamRef.current}
          onScan={handleBarcodeScan}
          onClose={closeCameraScanner}
        />
      )}

      {showManagerPin && (
        <ManagerPinModal
          registerId={registerId}
          title={t("managerApproval")}
          description={t("managerDiscountDesc", { limit: maxCashierDiscountPct, pct: discountPct.toFixed(1) })}
          onApproved={(pin) => {
            setDiscountOverride(true);
            setManagerDiscountPin(pin);
            setShowManagerPin(false);
            if (pendingDiscount) {
              const prep = prepareDiscountApplication(
                pendingDiscount,
                lines,
                cartDiscount,
                promoDiscount
              );
              if (prep.blocked) {
                showDiscountToast(t("discountExceeds100"));
                setPendingDiscount(null);
              } else {
                commitDiscount(prep, pendingDiscount);
                setPendingDiscount(null);
              }
            }
            if (pendingCheckout) {
              if (hasInvalidDiscounts) {
                showDiscountToast(t("fixDiscountsBeforeCheckout"));
                setPendingCheckout(false);
                return;
              }
              setPendingCheckout(false);
              setShowPayment(true);
            }
          }}
          onClose={() => {
            setShowManagerPin(false);
            setPendingDiscount(null);
            setPendingCheckout(false);
          }}
        />
      )}

      {lastSale && (
        <div className="pos-modal-backdrop pos-modal-panel fixed bottom-4 right-4 z-40 max-h-[85vh] w-full max-w-sm overflow-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <span className="pos-heading flex items-center gap-2 text-sm font-bold text-slate-900">
              <Printer className="h-4 w-4" />
              {t("receiptPreview")}
            </span>
            <button
              type="button"
              onClick={() => setLastSale(null)}
              className="cursor-pointer rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary"
              aria-label={t("closeReceiptPreview")}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <ReceiptPrint
            sale={lastSale.sale}
            lines={lastSale.lines}
            payments={lastSale.payments}
            saleId={lastSale.saleId}
            sessionToken={posStaffSession?.token}
            pollPaymentStatus={lastSale.pollPaymentStatus}
            autoPrint
            registerId={registerId}
            onPaymentsUpdate={(payments) => {
              const stillPending = paymentsNeedPolling(payments);
              setLastSale((prev) =>
                prev
                  ? {
                      ...prev,
                      payments,
                      pollPaymentStatus: stillPending,
                    }
                  : null
              );
            }}
            orgName={orgName}
            storeName={storeName}
            currency={currency}
            footer={receiptFooter}
          />
        </div>
      )}
    </div>
  );
}

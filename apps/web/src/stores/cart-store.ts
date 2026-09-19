import { create } from "zustand";
import {
  clampCartDiscount,
  clampLineDiscount,
  normalizeCartDiscounts,
} from "@/lib/pos/discount-policy";

export interface CartLine {
  variantId: string;
  productName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  uomCode?: string;
  uomLabel?: string;
  uomFactor?: number;
  /** Base-unit sell price (catalog), used when switching UOM */
  baseUnitPrice?: number;
  saleUoms?: { code: string; name: string; factor: number; isBase?: boolean }[];
}

function lineKey(variantId: string, uomCode?: string) {
  return `${variantId}::${(uomCode || "ea").toLowerCase()}`;
}

export type HeldCart = {
  id: string;
  lines: CartLine[];
  discount: number;
  promoCode: string | null;
  promoDiscount: number;
  promotionId: string | null;
  promotionName: string | null;
  heldAt: number;
};

type ActiveCartSnapshot = {
  lines: CartLine[];
  cartDiscount: number;
  promoCode: string | null;
  promoDiscount: number;
  promotionId: string | null;
  promotionName: string | null;
};

const HELD_CARTS_KEY = (registerId: string) => `pos-held-carts-${registerId}`;
const ACTIVE_CART_KEY = (registerId: string) => `pos-active-cart-${registerId}`;

function loadHeldCarts(registerId: string): HeldCart[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HELD_CARTS_KEY(registerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HeldCart[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHeldCarts(registerId: string, heldCarts: HeldCart[]) {
  if (typeof window === "undefined" || !registerId) return;
  try {
    localStorage.setItem(HELD_CARTS_KEY(registerId), JSON.stringify(heldCarts));
  } catch {
    /* quota */
  }
}

function loadActiveCart(registerId: string): ActiveCartSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_CART_KEY(registerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveCartSnapshot;
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveActiveCart(registerId: string | null, snapshot: ActiveCartSnapshot) {
  if (typeof window === "undefined" || !registerId) return;
  try {
    if (snapshot.lines.length === 0) {
      localStorage.removeItem(ACTIVE_CART_KEY(registerId));
      return;
    }
    localStorage.setItem(ACTIVE_CART_KEY(registerId), JSON.stringify(snapshot));
  } catch {
    /* quota */
  }
}

function clearActiveCartStorage(registerId: string | null) {
  if (typeof window === "undefined" || !registerId) return;
  try {
    localStorage.removeItem(ACTIVE_CART_KEY(registerId));
  } catch {
    /* ignore */
  }
}

function persistActiveFromState(state: {
  activeRegisterId: string | null;
  lines: CartLine[];
  cartDiscount: number;
  promoCode: string | null;
  promoDiscount: number;
  promotionId: string | null;
  promotionName: string | null;
}) {
  saveActiveCart(state.activeRegisterId, {
    lines: state.lines,
    cartDiscount: state.cartDiscount,
    promoCode: state.promoCode,
    promoDiscount: state.promoDiscount,
    promotionId: state.promotionId,
    promotionName: state.promotionName,
  });
}

interface CartState {
  activeRegisterId: string | null;
  lines: CartLine[];
  cartDiscount: number;
  promoCode: string | null;
  promoDiscount: number;
  promotionId: string | null;
  promotionName: string | null;
  heldCarts: HeldCart[];
  /** Set when active cart could not be restored from storage (corrupt/missing). */
  cartRestoreFailed: boolean;
  initForRegister: (registerId: string) => void;
  acknowledgeCartRestoreFailed: () => void;
  addLine: (line: Omit<CartLine, "quantity" | "discountAmount"> & { quantity?: number }) => void;
  updateQuantity: (variantId: string, quantity: number, uomCode?: string) => void;
  removeLine: (variantId: string, uomCode?: string) => void;
  setCartDiscount: (amount: number) => void;
  setLineDiscount: (variantId: string, amount: number, uomCode?: string) => void;
  setLineUom: (variantId: string, fromUom: string | undefined, toUomCode: string) => void;
  applyPromotion: (promo: {
    code: string;
    discountAmount: number;
    promotionId: string;
    name: string;
  }) => void;
  clearPromotion: () => void;
  clear: () => void;
  hold: () => void;
  recall: (id: string) => void;
}

export const useCartStore = create<CartState>((set, get) => ({
  activeRegisterId: null,
  lines: [],
  cartDiscount: 0,
  promoCode: null,
  promoDiscount: 0,
  promotionId: null,
  promotionName: null,
  heldCarts: [],
  cartRestoreFailed: false,

  initForRegister: (registerId) => {
    const current = get().activeRegisterId;
    if (current === registerId) return;

    const restored = loadActiveCart(registerId);
    let lines: CartLine[] = [];
    let cartDiscount = 0;
    let promoCode: string | null = null;
    let promoDiscount = 0;
    let promotionId: string | null = null;
    let promotionName: string | null = null;
    let cartRestoreFailed = false;

    if (restored) {
      try {
        const normalized = normalizeCartDiscounts(
          restored.lines,
          restored.cartDiscount ?? 0,
          restored.promoDiscount ?? 0
        );
        lines = normalized.lines;
        cartDiscount = normalized.cartDiscount;
        promoCode = restored.promoCode;
        promoDiscount = restored.promoDiscount;
        promotionId = restored.promotionId;
        promotionName = restored.promotionName;
      } catch {
        cartRestoreFailed = true;
        clearActiveCartStorage(registerId);
      }
    }

    set({
      activeRegisterId: registerId,
      lines,
      cartDiscount,
      promoCode,
      promoDiscount,
      promotionId,
      promotionName,
      heldCarts: loadHeldCarts(registerId),
      cartRestoreFailed,
    });
  },

  acknowledgeCartRestoreFailed: () => set({ cartRestoreFailed: false }),

  addLine: (line) => {
    const qty = line.quantity ?? 1;
    const uomCode = (line.uomCode || "ea").toLowerCase();
    const factor = line.uomFactor ?? 1;
    const basePrice = line.baseUnitPrice ?? line.unitPrice / (factor || 1);
    const unitPrice = line.unitPrice ?? basePrice * factor;
    set((state) => {
      const existing = state.lines.find(
        (l) => lineKey(l.variantId, l.uomCode) === lineKey(line.variantId, uomCode)
      );
      let next: CartState;
      if (existing) {
        next = {
          ...state,
          lines: state.lines.map((l) =>
            lineKey(l.variantId, l.uomCode) === lineKey(line.variantId, uomCode)
              ? { ...l, quantity: l.quantity + qty }
              : l
          ),
        };
      } else {
        next = {
          ...state,
          lines: [
            ...state.lines,
            {
              variantId: line.variantId,
              productName: line.productName,
              variantName: line.variantName ?? null,
              quantity: qty,
              unitPrice,
              discountAmount: 0,
              uomCode,
              uomLabel: line.uomLabel ?? uomCode,
              uomFactor: factor,
              baseUnitPrice: basePrice,
              saleUoms: line.saleUoms,
            },
          ],
        };
      }
      persistActiveFromState(next);
      return next;
    });
  },

  updateQuantity: (variantId, quantity, uomCode) => {
    // Never remove via qty=0 — cashiers clear the field while typing; use removeLine (trash).
    if (!(quantity > 0) || !Number.isFinite(quantity)) {
      return;
    }
    set((state) => {
      const lines = state.lines.map((l) => {
        if (lineKey(l.variantId, l.uomCode) !== lineKey(variantId, uomCode)) return l;
        const updated = { ...l, quantity };
        return { ...updated, discountAmount: clampLineDiscount(updated, l.discountAmount) };
      });
      const cartDiscount = clampCartDiscount(lines, state.cartDiscount, state.promoDiscount);
      const next = { ...state, lines, cartDiscount };
      persistActiveFromState(next);
      return { lines, cartDiscount };
    });
  },

  removeLine: (variantId, uomCode) => {
    set((state) => {
      const lines = state.lines.filter(
        (l) => lineKey(l.variantId, l.uomCode) !== lineKey(variantId, uomCode)
      );
      const next = { ...state, lines };
      persistActiveFromState(next);
      return { lines };
    });
  },

  setCartDiscount: (amount) =>
    set((state) => {
      const cartDiscount = clampCartDiscount(state.lines, amount, state.promoDiscount);
      const next = { ...state, cartDiscount };
      persistActiveFromState(next);
      return { cartDiscount };
    }),

  setLineDiscount: (variantId, amount, uomCode) => {
    set((state) => {
      const lines = state.lines.map((l) =>
        lineKey(l.variantId, l.uomCode) === lineKey(variantId, uomCode)
          ? { ...l, discountAmount: clampLineDiscount(l, amount) }
          : l
      );
      const cartDiscount = clampCartDiscount(lines, state.cartDiscount, state.promoDiscount);
      const next = { ...state, lines, cartDiscount };
      persistActiveFromState(next);
      return { lines, cartDiscount };
    });
  },

  setLineUom: (variantId, fromUom, toUomCode) => {
    set((state) => {
      const lines = state.lines.map((l) => {
        if (lineKey(l.variantId, l.uomCode) !== lineKey(variantId, fromUom)) return l;
        const uoms = l.saleUoms ?? [];
        const nextUom = uoms.find((u) => u.code.toLowerCase() === toUomCode.toLowerCase());
        const factor = nextUom?.factor ?? 1;
        const base = l.baseUnitPrice ?? l.unitPrice / (l.uomFactor || 1);
        const updated = {
          ...l,
          uomCode: toUomCode.toLowerCase(),
          uomLabel: nextUom?.name ?? toUomCode,
          uomFactor: factor,
          baseUnitPrice: base,
          unitPrice: Math.round(base * factor * 100) / 100,
        };
        return { ...updated, discountAmount: clampLineDiscount(updated, l.discountAmount) };
      });
      // Merge if target UOM line already exists
      const merged = new Map<string, CartLine>();
      for (const l of lines) {
        const key = lineKey(l.variantId, l.uomCode);
        const prev = merged.get(key);
        if (prev) {
          merged.set(key, {
            ...prev,
            quantity: prev.quantity + l.quantity,
            discountAmount: prev.discountAmount + l.discountAmount,
          });
        } else {
          merged.set(key, l);
        }
      }
      const nextLines = Array.from(merged.values());
      const cartDiscount = clampCartDiscount(nextLines, state.cartDiscount, state.promoDiscount);
      const next = { ...state, lines: nextLines, cartDiscount };
      persistActiveFromState(next);
      return {
        lines: nextLines,
        cartDiscount,
      };
    });
  },

  applyPromotion: (promo) =>
    set((state) => {
      const promoDiscount = Math.max(0, promo.discountAmount);
      const next = {
        ...state,
        promoCode: promo.code,
        promoDiscount,
        promotionId: promo.promotionId,
        promotionName: promo.name,
        cartDiscount: clampCartDiscount(state.lines, state.cartDiscount, promoDiscount),
      };
      persistActiveFromState(next);
      return {
        promoCode: next.promoCode,
        promoDiscount: next.promoDiscount,
        promotionId: next.promotionId,
        promotionName: next.promotionName,
        cartDiscount: next.cartDiscount,
      };
    }),

  clearPromotion: () =>
    set((state) => {
      const next = {
        ...state,
        promoCode: null,
        promoDiscount: 0,
        promotionId: null,
        promotionName: null,
      };
      persistActiveFromState(next);
      return {
        promoCode: null,
        promoDiscount: 0,
        promotionId: null,
        promotionName: null,
      };
    }),

  clear: () => {
    const { activeRegisterId } = get();
    clearActiveCartStorage(activeRegisterId);
    set({
      lines: [],
      cartDiscount: 0,
      promoCode: null,
      promoDiscount: 0,
      promotionId: null,
      promotionName: null,
    });
  },

  hold: () => {
    const {
      lines,
      cartDiscount,
      promoCode,
      promoDiscount,
      promotionId,
      promotionName,
      heldCarts,
      activeRegisterId,
    } = get();
    if (lines.length === 0) return;
    const nextHeld: HeldCart[] = [
      ...heldCarts,
      {
        id: crypto.randomUUID(),
        lines: [...lines],
        discount: cartDiscount,
        promoCode,
        promoDiscount,
        promotionId,
        promotionName,
        heldAt: Date.now(),
      },
    ];
    if (activeRegisterId) saveHeldCarts(activeRegisterId, nextHeld);
    clearActiveCartStorage(activeRegisterId);
    set({
      heldCarts: nextHeld,
      lines: [],
      cartDiscount: 0,
      promoCode: null,
      promoDiscount: 0,
      promotionId: null,
      promotionName: null,
    });
  },

  recall: (id) => {
    const { heldCarts, activeRegisterId } = get();
    const held = heldCarts.find((h) => h.id === id);
    if (!held) return;
    const normalized = normalizeCartDiscounts(
      held.lines,
      held.discount,
      held.promoDiscount
    );
    const nextHeld = heldCarts.filter((h) => h.id !== id);
    if (activeRegisterId) saveHeldCarts(activeRegisterId, nextHeld);
    const next = {
      activeRegisterId,
      lines: normalized.lines,
      cartDiscount: normalized.cartDiscount,
      promoCode: held.promoCode,
      promoDiscount: held.promoDiscount,
      promotionId: held.promotionId,
      promotionName: held.promotionName,
    };
    persistActiveFromState(next);
    set({
      lines: normalized.lines,
      cartDiscount: normalized.cartDiscount,
      promoCode: held.promoCode,
      promoDiscount: held.promoDiscount,
      promotionId: held.promotionId,
      promotionName: held.promotionName,
      heldCarts: nextHeld,
    });
  },
}));

export function calcCartTotals(
  lines: CartLine[],
  cartDiscount: number,
  taxRate: number,
  taxInclusive: boolean,
  promoDiscount = 0
) {
  let subtotal = 0;
  let tax = 0;

  for (const line of lines) {
    const lineSub =
      line.unitPrice * line.quantity - (line.discountAmount ?? 0);
    subtotal += lineSub;
    if (taxInclusive) {
      tax += lineSub - lineSub / (1 + taxRate / 100);
    } else {
      tax += lineSub * (taxRate / 100);
    }
  }

  const total = subtotal + (taxInclusive ? 0 : tax) - cartDiscount - promoDiscount;
  return { subtotal, tax, total: Math.max(0, total) };
}

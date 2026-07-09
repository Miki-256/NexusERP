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

const HELD_CARTS_KEY = (registerId: string) => `pos-held-carts-${registerId}`;

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

interface CartState {
  activeRegisterId: string | null;
  lines: CartLine[];
  cartDiscount: number;
  promoCode: string | null;
  promoDiscount: number;
  promotionId: string | null;
  promotionName: string | null;
  heldCarts: HeldCart[];
  initForRegister: (registerId: string) => void;
  addLine: (line: Omit<CartLine, "quantity" | "discountAmount"> & { quantity?: number }) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  removeLine: (variantId: string) => void;
  setCartDiscount: (amount: number) => void;
  setLineDiscount: (variantId: string, amount: number) => void;
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

  initForRegister: (registerId) => {
    const current = get().activeRegisterId;
    if (current === registerId) return;
    set({
      activeRegisterId: registerId,
      lines: [],
      cartDiscount: 0,
      promoCode: null,
      promoDiscount: 0,
      promotionId: null,
      promotionName: null,
      heldCarts: loadHeldCarts(registerId),
    });
  },

  addLine: (line) => {
    const qty = line.quantity ?? 1;
    set((state) => {
      const existing = state.lines.find((l) => l.variantId === line.variantId);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.variantId === line.variantId
              ? { ...l, quantity: l.quantity + qty }
              : l
          ),
        };
      }
      return {
        lines: [
          ...state.lines,
          {
            variantId: line.variantId,
            productName: line.productName,
            variantName: line.variantName ?? null,
            quantity: qty,
            unitPrice: line.unitPrice,
            discountAmount: 0,
          },
        ],
      };
    });
  },

  updateQuantity: (variantId, quantity) => {
    if (quantity <= 0) {
      get().removeLine(variantId);
      return;
    }
    set((state) => {
      const lines = state.lines.map((l) => {
        if (l.variantId !== variantId) return l;
        const updated = { ...l, quantity };
        return { ...updated, discountAmount: clampLineDiscount(updated, l.discountAmount) };
      });
      const cartDiscount = clampCartDiscount(lines, state.cartDiscount, state.promoDiscount);
      return { lines, cartDiscount };
    });
  },

  removeLine: (variantId) => {
    set((state) => ({
      lines: state.lines.filter((l) => l.variantId !== variantId),
    }));
  },

  setCartDiscount: (amount) =>
    set((state) => ({
      cartDiscount: clampCartDiscount(state.lines, amount, state.promoDiscount),
    })),

  setLineDiscount: (variantId, amount) => {
    set((state) => {
      const lines = state.lines.map((l) =>
        l.variantId === variantId
          ? { ...l, discountAmount: clampLineDiscount(l, amount) }
          : l
      );
      const cartDiscount = clampCartDiscount(lines, state.cartDiscount, state.promoDiscount);
      return { lines, cartDiscount };
    });
  },

  applyPromotion: (promo) =>
    set((state) => {
      const promoDiscount = Math.max(0, promo.discountAmount);
      return {
        promoCode: promo.code,
        promoDiscount,
        promotionId: promo.promotionId,
        promotionName: promo.name,
        cartDiscount: clampCartDiscount(state.lines, state.cartDiscount, promoDiscount),
      };
    }),

  clearPromotion: () =>
    set({
      promoCode: null,
      promoDiscount: 0,
      promotionId: null,
      promotionName: null,
    }),

  clear: () =>
    set({
      lines: [],
      cartDiscount: 0,
      promoCode: null,
      promoDiscount: 0,
      promotionId: null,
      promotionName: null,
    }),

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

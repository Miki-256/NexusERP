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

interface CartState {
  lines: CartLine[];
  cartDiscount: number;
  promoCode: string | null;
  promoDiscount: number;
  promotionId: string | null;
  promotionName: string | null;
  heldCarts: {
    id: string;
    lines: CartLine[];
    discount: number;
    promoCode: string | null;
    promoDiscount: number;
    promotionId: string | null;
    promotionName: string | null;
    heldAt: number;
  }[];
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
  lines: [],
  cartDiscount: 0,
  promoCode: null,
  promoDiscount: 0,
  promotionId: null,
  promotionName: null,
  heldCarts: [],

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
    } = get();
    if (lines.length === 0) return;
    set({
      heldCarts: [
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
      ],
      lines: [],
      cartDiscount: 0,
      promoCode: null,
      promoDiscount: 0,
      promotionId: null,
      promotionName: null,
    });
  },

  recall: (id) => {
    const held = get().heldCarts.find((h) => h.id === id);
    if (!held) return;
    const normalized = normalizeCartDiscounts(
      held.lines,
      held.discount,
      held.promoDiscount
    );
    set({
      lines: normalized.lines,
      cartDiscount: normalized.cartDiscount,
      promoCode: held.promoCode,
      promoDiscount: held.promoDiscount,
      promotionId: held.promotionId,
      promotionName: held.promotionName,
      heldCarts: get().heldCarts.filter((h) => h.id !== id),
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

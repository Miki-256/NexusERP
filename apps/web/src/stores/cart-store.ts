import { create } from "zustand";

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
  heldCarts: { id: string; lines: CartLine[]; discount: number }[];
  addLine: (line: Omit<CartLine, "quantity" | "discountAmount"> & { quantity?: number }) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  removeLine: (variantId: string) => void;
  setCartDiscount: (amount: number) => void;
  clear: () => void;
  hold: () => void;
  recall: (id: string) => void;
}

export const useCartStore = create<CartState>((set, get) => ({
  lines: [],
  cartDiscount: 0,
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
    set((state) => ({
      lines: state.lines.map((l) =>
        l.variantId === variantId ? { ...l, quantity } : l
      ),
    }));
  },

  removeLine: (variantId) => {
    set((state) => ({
      lines: state.lines.filter((l) => l.variantId !== variantId),
    }));
  },

  setCartDiscount: (amount) => set({ cartDiscount: amount }),

  clear: () => set({ lines: [], cartDiscount: 0 }),

  hold: () => {
    const { lines, cartDiscount, heldCarts } = get();
    if (lines.length === 0) return;
    set({
      heldCarts: [
        ...heldCarts,
        { id: crypto.randomUUID(), lines: [...lines], discount: cartDiscount },
      ],
      lines: [],
      cartDiscount: 0,
    });
  },

  recall: (id) => {
    const held = get().heldCarts.find((h) => h.id === id);
    if (!held) return;
    set({
      lines: held.lines,
      cartDiscount: held.discount,
      heldCarts: get().heldCarts.filter((h) => h.id !== id),
    });
  },
}));

export function calcCartTotals(
  lines: CartLine[],
  cartDiscount: number,
  taxRate: number,
  taxInclusive: boolean
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

  const total = subtotal + (taxInclusive ? 0 : tax) - cartDiscount;
  return { subtotal, tax, total: Math.max(0, total) };
}

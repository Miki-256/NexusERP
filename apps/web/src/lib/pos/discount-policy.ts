import type { CartLine } from "@/stores/cart-store";

export const MAX_DISCOUNT_PCT = 100;

export function lineGross(line: CartLine): number {
  return line.unitPrice * line.quantity;
}

export function grossMerchandise(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineGross(line), 0);
}

export function merchandiseSubtotal(lines: CartLine[]): number {
  return lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity - line.discountAmount,
    0
  );
}

export function totalDiscountAmount(
  lines: CartLine[],
  cartDiscount: number,
  promoDiscount = 0
): number {
  const lineDiscounts = lines.reduce((s, l) => s + l.discountAmount, 0);
  return lineDiscounts + cartDiscount + promoDiscount;
}

export function discountPctOfSubtotal(
  lines: CartLine[],
  cartDiscount: number,
  promoDiscount = 0
): number {
  const subtotal = grossMerchandise(lines);
  if (subtotal <= 0) return 0;
  return (totalDiscountAmount(lines, cartDiscount, promoDiscount) / subtotal) * 100;
}

export function clampLineDiscount(line: CartLine, amount: number): number {
  const max = lineGross(line);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(Math.min(amount, max) * 100) / 100;
}

export function clampCartDiscount(
  lines: CartLine[],
  amount: number,
  promoDiscount = 0
): number {
  const maxOrder = Math.max(0, merchandiseSubtotal(lines) - promoDiscount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(Math.min(amount, maxOrder) * 100) / 100;
}

export function exceedsAbsoluteDiscountLimit(
  lines: CartLine[],
  cartDiscount: number,
  promoDiscount = 0
): boolean {
  const gross = grossMerchandise(lines);
  if (gross <= 0) return false;
  return totalDiscountAmount(lines, cartDiscount, promoDiscount) > gross + 0.001;
}

export function exceedsCashierDiscountLimit(
  lines: CartLine[],
  cartDiscount: number,
  maxPct: number,
  promoDiscount = 0
): boolean {
  return discountPctOfSubtotal(lines, cartDiscount, promoDiscount) > maxPct + 0.001;
}

export type DiscountApplyRequest =
  | { type: "line"; variantId: string; amount: number }
  | { type: "cart"; amount: number };

export function prepareDiscountApplication(
  request: DiscountApplyRequest,
  lines: CartLine[],
  cartDiscount: number,
  promoDiscount = 0
): {
  lines: CartLine[];
  cartDiscount: number;
  blocked: boolean;
} {
  if (request.type === "line") {
    const line = lines.find((l) => l.variantId === request.variantId);
    if (!line) {
      return { lines, cartDiscount, blocked: false };
    }
    const amount = clampLineDiscount(line, request.amount);
    const nextLines = lines.map((l) =>
      l.variantId === request.variantId ? { ...l, discountAmount: amount } : l
    );
    return {
      lines: nextLines,
      cartDiscount,
      blocked: exceedsAbsoluteDiscountLimit(nextLines, cartDiscount, promoDiscount),
    };
  }

  const nextCart = clampCartDiscount(lines, request.amount, promoDiscount);
  return {
    lines,
    cartDiscount: nextCart,
    blocked: exceedsAbsoluteDiscountLimit(lines, nextCart, promoDiscount),
  };
}

export function normalizeCartDiscounts(
  lines: CartLine[],
  cartDiscount: number,
  promoDiscount = 0
): { lines: CartLine[]; cartDiscount: number } {
  const normalizedLines = lines.map((l) => ({
    ...l,
    discountAmount: clampLineDiscount(l, l.discountAmount),
  }));
  let normalizedCart = clampCartDiscount(normalizedLines, cartDiscount, promoDiscount);
  if (exceedsAbsoluteDiscountLimit(normalizedLines, normalizedCart, promoDiscount)) {
    const gross = grossMerchandise(normalizedLines);
    const lineAndPromo = totalDiscountAmount(normalizedLines, 0, promoDiscount);
    normalizedCart = Math.max(0, Math.round((gross - lineAndPromo) * 100) / 100);
  }
  return { lines: normalizedLines, cartDiscount: normalizedCart };
}

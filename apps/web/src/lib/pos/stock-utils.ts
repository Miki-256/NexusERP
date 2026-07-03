import type { PosCatalogItem } from "@/components/pos/product-card";
import type { CartLine } from "@/stores/cart-store";

export function cartQtyForVariant(lines: CartLine[], variantId: string): number {
  return lines.find((l) => l.variantId === variantId)?.quantity ?? 0;
}

export function canAddToCart(
  item: PosCatalogItem,
  lines: CartLine[],
  addQty = 1
): { ok: true } | { ok: false; message: string } {
  if (item.stock <= 0) {
    return { ok: false, message: `${item.name} is out of stock` };
  }
  const inCart = cartQtyForVariant(lines, item.variantId);
  if (inCart + addQty > item.stock) {
    return {
      ok: false,
      message: `Only ${item.stock} in stock (${inCart} already in cart)`,
    };
  }
  return { ok: true };
}

export function stockWarningForLine(
  item: PosCatalogItem | undefined,
  lineQty: number
): string | null {
  if (!item) return null;
  if (item.stock <= 0) return "Out of stock";
  if (lineQty > item.stock) return `Exceeds stock (${item.stock} available)`;
  if (lineQty === item.stock) return "Last units in stock";
  return null;
}

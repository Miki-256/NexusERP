import type { PosCatalogItem } from "@/components/pos/product-card";
import type { CartLine } from "@/stores/cart-store";

/** Total base units already in cart for a variant (across all UOMs). */
export function cartBaseQtyForVariant(lines: CartLine[], variantId: string): number {
  return lines
    .filter((l) => l.variantId === variantId)
    .reduce((sum, l) => sum + l.quantity * (l.uomFactor ?? 1), 0);
}

const MEASURED_CODES = new Set([
  "kg",
  "g",
  "l",
  "lt",
  "ml",
  "litre",
  "liter",
  "oz",
  "lb",
]);

/** Weight/volume UOMs — sold by measure, not by piece. */
export function isMeasuredUomCode(uomCode?: string | null): boolean {
  const code = (uomCode || "").toLowerCase().trim();
  return MEASURED_CODES.has(code);
}

export function hasMeasuredSaleUoms(
  item: PosCatalogItem | { saleUoms?: { code: string }[] }
): boolean {
  const uoms = item.saleUoms ?? [];
  return uoms.some((u) => isMeasuredUomCode(u.code));
}

export function isMeasuredCartLine(line: Pick<CartLine, "uomCode" | "uomFactor">): boolean {
  if (isMeasuredUomCode(line.uomCode)) return true;
  const f = Number(line.uomFactor);
  return Number.isFinite(f) && f > 0 && f !== 1 && !Number.isInteger(f);
}

export type StockMessage =
  | { messageKey: "itemOutOfStock"; values: { name: string } }
  | { messageKey: "onlyBaseUnitsInStock"; values: { stock: number; inCart: number } }
  | { messageKey: "outOfStock"; values?: undefined }
  | { messageKey: "exceedsStock"; values: { stock: number } }
  | { messageKey: "lastUnitsInStock"; values?: undefined };

export function canAddToCart(
  item: PosCatalogItem,
  lines: CartLine[],
  addQty = 1,
  uomFactor = 1
): { ok: true } | ({ ok: false } & StockMessage) {
  if (item.stock <= 0) {
    return { ok: false, messageKey: "itemOutOfStock", values: { name: item.name } };
  }
  const inCartBase = cartBaseQtyForVariant(lines, item.variantId);
  const addBase = addQty * uomFactor;
  if (inCartBase + addBase > item.stock + 1e-9) {
    return {
      ok: false,
      messageKey: "onlyBaseUnitsInStock",
      values: { stock: item.stock, inCart: inCartBase },
    };
  }
  return { ok: true };
}

export function stockWarningForLine(
  item: PosCatalogItem | undefined,
  line: CartLine
): StockMessage | null {
  if (!item) return null;
  const lineBase = line.quantity * (line.uomFactor ?? 1);
  if (item.stock <= 0) return { messageKey: "outOfStock" };
  if (lineBase > item.stock + 1e-9) {
    return { messageKey: "exceedsStock", values: { stock: item.stock } };
  }
  if (Math.abs(lineBase - item.stock) < 1e-9) return { messageKey: "lastUnitsInStock" };
  return null;
}

export function defaultSaleUom(item: PosCatalogItem) {
  const cleaned = (item.saleUoms ?? []).filter(
    (u) => u?.code && String(u.code).trim() && String(u.code).toLowerCase() !== "null"
  );
  const uoms = cleaned.length
    ? cleaned
    : [{ code: "ea", name: "Each", factor: 1, isBase: true }];

  try {
    const preferred =
      typeof window !== "undefined"
        ? window.localStorage.getItem(`pos-preferred-uom:${item.variantId}`)
        : null;
    if (preferred) {
      const match = uoms.find((u) => u.code.toLowerCase() === preferred.toLowerCase());
      if (match) return match;
    }
  } catch {
    /* ignore */
  }

  // Measured goods: prefer a non-base sale UOM (kg/L) when present so cashiers enter weight/volume.
  const measuredNonBase = uoms.find(
    (u) => !u.isBase && isMeasuredUomCode(u.code) && Number(u.factor) > 0
  );
  if (measuredNonBase) return measuredNonBase;

  const measuredBase = uoms.find((u) => u.isBase && isMeasuredUomCode(u.code));
  if (measuredBase) return measuredBase;

  const nonBase = uoms.find((u) => !u.isBase && Number(u.factor) > 0);
  if (nonBase) return nonBase;
  return uoms.find((u) => u.isBase) ?? uoms[0];
}

export function rememberPreferredSaleUom(variantId: string, uomCode: string) {
  try {
    window.localStorage.setItem(`pos-preferred-uom:${variantId}`, uomCode);
  } catch {
    /* ignore */
  }
}

/** Qty step for POS number input based on UOM. */
export function qtyStepForUom(uomCode?: string, uomFactor?: number): number {
  const code = (uomCode || "").toLowerCase();
  if (code === "kg" || code === "l" || code === "lt" || code === "litre" || code === "liter") {
    return 0.001;
  }
  if (code === "g" || code === "ml") return 1;
  if (uomFactor != null && uomFactor < 1) return 0.001;
  if (isMeasuredUomCode(code)) return 0.01;
  return 1;
}

/** Larger +/- button step for measured UOMs (still type exact values in the input). */
export function qtyButtonStepForUom(uomCode?: string, uomFactor?: number): number {
  const code = (uomCode || "").toLowerCase();
  if (code === "kg" || code === "l" || code === "lt" || code === "litre" || code === "liter") {
    return 0.1;
  }
  if (code === "g" || code === "ml") return 10;
  if (isMeasuredUomCode(code)) return 0.1;
  return qtyStepForUom(uomCode, uomFactor);
}

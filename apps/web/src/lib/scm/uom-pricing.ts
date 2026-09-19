/** Shared fixed-conversion UOM pricing helpers (catalog prices always per base unit). */

export type UomPresetKind = "each" | "weight" | "volume" | "pack";

export type UomPresetSpec = {
  code: string;
  name: string;
  factor: number;
  isBase: boolean;
  isSale: boolean;
  isPurchase: boolean;
};

export type UomPricingContext = {
  kind: UomPresetKind;
  baseCode: string;
  purchaseCode: string;
  saleCode: string;
  /** Base units per 1 purchase UOM */
  purchaseFactor: number;
  /** Base units per 1 sale UOM */
  saleFactor: number;
  packSize?: number;
  specs: UomPresetSpec[];
};

/** Convert a price entered in a given UOM → catalog (per base). */
export function toBasePrice(priceInUom: number, conversionFactor: number): number {
  const factor = Number(conversionFactor);
  if (!(factor > 0) || !Number.isFinite(priceInUom)) return 0;
  return Math.round((priceInUom / factor) * 1e8) / 1e8;
}

/** Convert catalog (per base) → price in a given UOM. */
export function fromBasePrice(basePrice: number, conversionFactor: number): number {
  const factor = Number(conversionFactor);
  if (!(factor > 0) || !Number.isFinite(basePrice)) return 0;
  return Math.round(basePrice * factor * 1e6) / 1e6;
}

export function buildUomPreset(kind: UomPresetKind, packSize = 24): UomPricingContext {
  if (kind === "weight") {
    const specs: UomPresetSpec[] = [
      { code: "g", name: "Gram", factor: 1, isBase: true, isSale: true, isPurchase: true },
      { code: "kg", name: "Kilogram", factor: 1000, isBase: false, isSale: true, isPurchase: true },
    ];
    return {
      kind,
      baseCode: "g",
      purchaseCode: "kg",
      saleCode: "g",
      purchaseFactor: 1000,
      saleFactor: 1,
      specs,
    };
  }
  if (kind === "volume") {
    const specs: UomPresetSpec[] = [
      { code: "ml", name: "Millilitre", factor: 1, isBase: true, isSale: true, isPurchase: true },
      { code: "l", name: "Litre", factor: 1000, isBase: false, isSale: true, isPurchase: true },
    ];
    return {
      kind,
      baseCode: "ml",
      purchaseCode: "l",
      saleCode: "ml",
      purchaseFactor: 1000,
      saleFactor: 1,
      specs,
    };
  }
  if (kind === "pack") {
    const size = packSize > 0 ? packSize : 24;
    const specs: UomPresetSpec[] = [
      { code: "ea", name: "Each", factor: 1, isBase: true, isSale: true, isPurchase: true },
      { code: "cs", name: "Case", factor: size, isBase: false, isSale: true, isPurchase: true },
    ];
    return {
      kind,
      baseCode: "ea",
      purchaseCode: "cs",
      saleCode: "ea",
      purchaseFactor: size,
      saleFactor: 1,
      packSize: size,
      specs,
    };
  }
  const specs: UomPresetSpec[] = [
    { code: "ea", name: "Each", factor: 1, isBase: true, isSale: true, isPurchase: true },
  ];
  return {
    kind: "each",
    baseCode: "ea",
    purchaseCode: "ea",
    saleCode: "ea",
    purchaseFactor: 1,
    saleFactor: 1,
    specs,
  };
}

/** Round money for display inputs (4 dp is enough for base unit costs). */
export function formatPriceInput(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 1e6) / 1e6;
  return String(rounded);
}

const RECENT_KEY = (registerId: string) => `pos-recent-${registerId}`;
const DEFAULT_PAYMENT_KEY = (registerId: string) => `pos-default-payment-${registerId}`;
const CATALOG_DENSITY_KEY = (registerId: string) => `pos-catalog-density-${registerId}`;
const AUTO_PRINT_KEY = (registerId: string) => `pos-auto-print-${registerId}`;
const AUTO_RETURN_KEY = (registerId: string) => `pos-auto-return-${registerId}`;

export type PosCatalogDensity = "comfortable" | "compact";

export const RECENT_VARIANT_LIMIT = 24;

export type PosPaymentMethodPreference =
  | "cash"
  | "mobile_money"
  | "bank_transfer"
  | "store_credit"
  | "on_account";

export function getRecentVariantIds(registerId: string): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY(registerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentVariants(registerId: string, variantIds: string[]) {
  if (variantIds.length === 0) return;
  const existing = getRecentVariantIds(registerId);
  const merged = [
    ...variantIds,
    ...existing.filter((id) => !variantIds.includes(id)),
  ].slice(0, RECENT_VARIANT_LIMIT);
  localStorage.setItem(RECENT_KEY(registerId), JSON.stringify(merged));
}

export function getDefaultPaymentMethod(
  registerId: string
): PosPaymentMethodPreference | null {
  try {
    const raw = localStorage.getItem(DEFAULT_PAYMENT_KEY(registerId));
    if (!raw) return null;
    const allowed: PosPaymentMethodPreference[] = [
      "cash",
      "mobile_money",
      "bank_transfer",
      "store_credit",
      "on_account",
    ];
    return allowed.includes(raw as PosPaymentMethodPreference)
      ? (raw as PosPaymentMethodPreference)
      : null;
  } catch {
    return null;
  }
}

export function setDefaultPaymentMethod(
  registerId: string,
  method: PosPaymentMethodPreference
) {
  localStorage.setItem(DEFAULT_PAYMENT_KEY(registerId), method);
}

export function getCatalogDensity(registerId: string): PosCatalogDensity {
  try {
    const raw = localStorage.getItem(CATALOG_DENSITY_KEY(registerId));
    return raw === "comfortable" ? "comfortable" : "compact";
  } catch {
    return "compact";
  }
}

export function setCatalogDensity(registerId: string, density: PosCatalogDensity) {
  localStorage.setItem(CATALOG_DENSITY_KEY(registerId), density);
}

export function getPosAutoPrint(registerId: string): boolean {
  try {
    return localStorage.getItem(AUTO_PRINT_KEY(registerId)) !== "0";
  } catch {
    return true;
  }
}

export function setPosAutoPrint(registerId: string, enabled: boolean) {
  localStorage.setItem(AUTO_PRINT_KEY(registerId), enabled ? "1" : "0");
}

export function getPosAutoReturn(registerId: string): boolean {
  try {
    return localStorage.getItem(AUTO_RETURN_KEY(registerId)) !== "0";
  } catch {
    return true;
  }
}

export function setPosAutoReturn(registerId: string, enabled: boolean) {
  localStorage.setItem(AUTO_RETURN_KEY(registerId), enabled ? "1" : "0");
}

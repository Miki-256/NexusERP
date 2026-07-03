import { idbDelete, idbGet, idbPut, STORES } from "./idb";
import type { PosCatalogCache, PosContextCache, PosSessionCache } from "./types";
import type { PosCatalogItem } from "@/components/pos/product-card";

export const CATALOG_STALE_MS = 30 * 60_000;

export async function cachePosCatalog(registerId: string, catalog: unknown[]): Promise<void> {
  const entry: PosCatalogCache = {
    registerId,
    catalog,
    cachedAt: new Date().toISOString(),
  };
  await idbPut(STORES.posCatalog, entry);
}

export async function getCachedPosCatalog(registerId: string): Promise<unknown[] | null> {
  const entry = await idbGet<PosCatalogCache>(STORES.posCatalog, registerId);
  return entry?.catalog ?? null;
}

export async function getCachedPosCatalogMeta(
  registerId: string
): Promise<{ catalog: PosCatalogItem[]; cachedAt: string | null }> {
  const entry = await idbGet<PosCatalogCache>(STORES.posCatalog, registerId);
  return {
    catalog: ((entry?.catalog ?? []) as PosCatalogItem[]).filter((c) => c.variantId),
    cachedAt: entry?.cachedAt ?? null,
  };
}

export function isCatalogStale(cachedAt: string | null, maxAgeMs = CATALOG_STALE_MS): boolean {
  if (!cachedAt) return true;
  return Date.now() - new Date(cachedAt).getTime() > maxAgeMs;
}

export async function decrementCachedPosStock(
  registerId: string,
  lines: { variantId: string; quantity: number }[]
): Promise<void> {
  const entry = await idbGet<PosCatalogCache>(STORES.posCatalog, registerId);
  if (!entry?.catalog) return;

  const byVariant = new Map(
    lines.map((l) => [l.variantId, l.quantity] as const)
  );

  const nextCatalog = (entry.catalog as PosCatalogItem[]).map((item) => {
    const sold = byVariant.get(item.variantId);
    if (!sold) return item;
    return { ...item, stock: Math.max(0, item.stock - sold) };
  });

  await idbPut(STORES.posCatalog, {
    ...entry,
    catalog: nextCatalog,
  });
}

export async function cachePosContext(registerId: string, context: unknown): Promise<void> {
  const entry: PosContextCache = {
    registerId,
    context,
    cachedAt: new Date().toISOString(),
  };
  await idbPut(STORES.posContext, entry);
}

export async function getCachedPosContext(registerId: string): Promise<unknown | null> {
  const entry = await idbGet<PosContextCache>(STORES.posContext, registerId);
  return entry?.context ?? null;
}

export async function cachePosSession(
  registerId: string,
  session: PosSessionCache["session"]
): Promise<void> {
  const entry: PosSessionCache = {
    registerId,
    session,
    cachedAt: new Date().toISOString(),
  };
  await idbPut(STORES.posSession, entry);
}

export async function getCachedPosSession(
  registerId: string
): Promise<PosSessionCache["session"] | null> {
  const entry = await idbGet<PosSessionCache>(STORES.posSession, registerId);
  return entry?.session ?? null;
}

export async function clearCachedPosSession(registerId: string): Promise<void> {
  await idbDelete(STORES.posSession, registerId);
}
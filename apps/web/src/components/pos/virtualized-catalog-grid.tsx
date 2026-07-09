"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { ProductCard, type PosCatalogItem } from "./product-card";
import type { PosCatalogDensity } from "@/lib/pos/pos-preferences";

function columnsForWidth(width: number, compact: boolean): number {
  if (compact) {
    if (width >= 1920) return 7;
    if (width >= 1536) return 6;
    if (width >= 1280) return 5;
    if (width >= 1024) return 4;
    if (width >= 768) return 4;
    if (width >= 640) return 3;
    if (width >= 360) return 2;
    return 1;
  }
  if (width >= 1536) return 5;
  if (width >= 1280) return 4;
  if (width >= 1024) return 3;
  if (width >= 768) return 3;
  if (width >= 480) return 2;
  return 1;
}

/** Must match rendered ProductCard height or content (price, name) gets clipped. */
function rowHeightFor(density: PosCatalogDensity, width: number, columnCount: number): number {
  const isMobile = width < 768;
  if (isMobile) {
    if (density === "compact") {
      return columnCount === 1 ? 200 : 180;
    }
    return columnCount === 1 ? 320 : 300;
  }
  return density === "compact" ? 180 : 320;
}

const CatalogProductCard = memo(function CatalogProductCard({
  item,
  currency,
  density,
  isMobileViewport,
  isFavorite,
  recentlySold,
  addedFlash,
  onAdd,
  onToggleFavorite,
}: {
  item: PosCatalogItem;
  currency: string;
  density: PosCatalogDensity;
  isMobileViewport: boolean;
  isFavorite: boolean;
  recentlySold: boolean;
  addedFlash: boolean;
  onAdd: (variantId: string) => void;
  onToggleFavorite: (variantId: string) => void;
}) {
  const handleAdd = useCallback(() => onAdd(item.variantId), [onAdd, item.variantId]);
  const handleFavorite = useCallback(
    () => onToggleFavorite(item.variantId),
    [onToggleFavorite, item.variantId]
  );

  return (
    <ProductCard
      item={item}
      currency={currency}
      compact={density === "compact"}
      mobile={isMobileViewport}
      onAdd={handleAdd}
      isFavorite={isFavorite}
      onToggleFavorite={handleFavorite}
      recentlySold={recentlySold}
      addedFlash={addedFlash}
    />
  );
});

export const VirtualizedCatalogGrid = memo(function VirtualizedCatalogGrid({
  items,
  currency,
  density,
  favorites,
  recentVariantIds,
  flashVariant,
  onAdd,
  onToggleFavorite,
}: {
  items: PosCatalogItem[];
  currency: string;
  density: PosCatalogDensity;
  favorites: Set<string>;
  recentVariantIds: string[];
  flashVariant: string | null;
  onAdd: (variantId: string) => void;
  onToggleFavorite: (variantId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1024);
  const onAddRef = useRef(onAdd);
  const onToggleRef = useRef(onToggleFavorite);
  onAddRef.current = onAdd;
  onToggleRef.current = onToggleFavorite;

  const stableOnAdd = useCallback((variantId: string) => {
    onAddRef.current(variantId);
  }, []);

  const stableOnToggleFavorite = useCallback((variantId: string) => {
    onToggleRef.current(variantId);
  }, []);

  const recentSet = useMemo(() => new Set(recentVariantIds), [recentVariantIds]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth || 1024);
    return () => ro.disconnect();
  }, []);

  const isMobileViewport = containerWidth < 768;
  const columnCount = useMemo(
    () => Math.max(1, columnsForWidth(containerWidth, density === "compact")),
    [containerWidth, density]
  );
  const rowHeight = rowHeightFor(density, containerWidth, columnCount);
  const rowCount = Math.ceil(items.length / columnCount);
  const gap = density === "compact" && !isMobileViewport ? 8 : 12;

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight + gap,
    overscan: isMobileViewport ? 3 : 4,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [density, columnCount, rowHeight, rowVirtualizer]);

  return (
    <div ref={parentRef} className="pos-modal-scroll h-full min-h-0 overflow-y-auto">
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const start = virtualRow.index * columnCount;
          const rowItems = items.slice(start, start + columnCount);

          return (
            <div
              key={virtualRow.key}
              className={cn(
                "absolute left-0 top-0 grid w-full",
                gap === 8 ? "gap-2" : "gap-3"
              )}
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              }}
            >
              {rowItems.map((item) => (
                <CatalogProductCard
                  key={item.variantId}
                  item={item}
                  currency={currency}
                  density={density}
                  isMobileViewport={isMobileViewport}
                  isFavorite={favorites.has(item.variantId)}
                  recentlySold={recentSet.has(item.variantId)}
                  addedFlash={flashVariant === item.variantId}
                  onAdd={stableOnAdd}
                  onToggleFavorite={stableOnToggleFavorite}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
});

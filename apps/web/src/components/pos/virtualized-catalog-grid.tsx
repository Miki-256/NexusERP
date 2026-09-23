"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { ProductCard, type PosCatalogItem } from "./product-card";
import type { PosCatalogDensity } from "@/lib/pos/pos-preferences";

function columnsForWidth(width: number, compact: boolean): number {
  // Dense POS grid — more products visible, less scrolling
  if (compact) {
    if (width >= 1920) return 8;
    if (width >= 1536) return 7;
    if (width >= 1280) return 6;
    if (width >= 1024) return 5;
    if (width >= 768) return 4;
    if (width >= 480) return 3;
    if (width >= 340) return 2;
    return 2;
  }
  if (width >= 1536) return 6;
  if (width >= 1280) return 5;
  if (width >= 1024) return 4;
  if (width >= 768) return 3;
  if (width >= 480) return 3;
  return 2;
}

/** Must match rendered ProductCard height or content gets clipped. */
function rowHeightFor(density: PosCatalogDensity, width: number, columnCount: number): number {
  const hasRoom = width >= 768;
  // Compact tiles: name + price + stock row (± optional small image)
  if (density === "compact") {
    if (!hasRoom) return columnCount >= 3 ? 108 : 118;
    return 124;
  }
  // Comfortable still denser than old e-commerce cards
  if (!hasRoom) return 140;
  return 156;
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
  const gap = density === "compact" ? 6 : 8;

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
                gap === 6 ? "gap-1.5" : "gap-2"
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

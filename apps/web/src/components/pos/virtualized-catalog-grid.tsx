"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    return 2;
  }
  if (width >= 1536) return 5;
  if (width >= 1280) return 4;
  if (width >= 1024) return 3;
  if (width >= 640) return 3;
  return 2;
}

function rowHeightFor(density: PosCatalogDensity): number {
  return density === "compact" ? 108 : 152;
}

export function VirtualizedCatalogGrid({
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

  const columnCount = useMemo(
    () => Math.max(1, columnsForWidth(containerWidth, density === "compact")),
    [containerWidth, density]
  );
  const rowHeight = rowHeightFor(density);
  const rowCount = Math.ceil(items.length / columnCount);
  const gap = density === "compact" ? 8 : 12;

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight + gap,
    overscan: 4,
  });

  return (
    <div ref={parentRef} className="h-full min-h-0 overflow-y-auto">
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
                density === "compact"
                  ? "gap-2"
                  : "gap-3"
              )}
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              }}
            >
              {rowItems.map((item) => (
                <ProductCard
                  key={item.variantId}
                  item={item}
                  currency={currency}
                  compact={density === "compact"}
                  onAdd={() => onAdd(item.variantId)}
                  isFavorite={favorites.has(item.variantId)}
                  onToggleFavorite={() => onToggleFavorite(item.variantId)}
                  recentlySold={recentVariantIds.includes(item.variantId)}
                  addedFlash={flashVariant === item.variantId}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

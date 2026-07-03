"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { Plus, Star, Package } from "lucide-react";

export type PosCatalogItem = {
  productId: string;
  variantId: string;
  name: string;
  variantName: string;
  sellPrice: number;
  barcode: string | null;
  sku: string | null;
  stock: number;
  categoryId: string | null;
  categoryName: string | null;
  imageUrl?: string | null;
};

export const ProductCard = memo(function ProductCard({
  item,
  currency,
  onAdd,
  isFavorite,
  onToggleFavorite,
  recentlySold,
  addedFlash,
  compact = false,
}: {
  item: PosCatalogItem;
  currency: string;
  onAdd: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  recentlySold?: boolean;
  addedFlash?: boolean;
  compact?: boolean;
}) {
  const outOfStock = item.stock <= 0;
  const initial = item.name.charAt(0).toUpperCase();

  return (
    <div
      className={cn(
        "pos-product-card pos-card group relative flex flex-col overflow-hidden",
        compact && "pos-product-card-compact",
        addedFlash && "pos-added",
        outOfStock && "opacity-60"
      )}
    >
      {recentlySold && (
        <span
          className={cn(
            "absolute left-2 top-2 z-10 rounded-md bg-amber-500 font-bold uppercase tracking-wide text-white shadow-sm",
            compact ? "px-1.5 py-0.5 text-[9px]" : "left-2.5 top-2.5 rounded-lg px-2 py-0.5 text-[10px]"
          )}
        >
          Recent
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite?.();
        }}
        className={cn(
          "absolute right-2 top-2 z-10 flex cursor-pointer items-center justify-center rounded-lg bg-white/90 shadow-sm transition-colors",
          compact ? "h-7 w-7" : "right-2.5 top-2.5 h-9 w-9 rounded-xl",
          isFavorite ? "text-amber-500" : "text-slate-300 hover:text-amber-400"
        )}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        <Star className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", isFavorite && "fill-current")} />
      </button>

      <button
        type="button"
        disabled={outOfStock}
        onClick={onAdd}
        className={cn(
          "flex flex-1 cursor-pointer flex-col text-left disabled:cursor-not-allowed",
          compact ? "p-2.5" : "p-4"
        )}
      >
        <div
          className={cn(
            "pos-product-image flex w-full items-center justify-center overflow-hidden",
            compact ? "mb-2 h-14 rounded-lg" : "mb-3 aspect-[4/3]"
          )}
        >
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span
              className={cn(
                "pos-heading font-bold text-slate-300",
                compact ? "text-lg" : "text-3xl"
              )}
            >
              {initial}
            </span>
          )}
        </div>
        <p
          className={cn(
            "font-bold leading-snug text-slate-900",
            compact ? "line-clamp-1 text-xs" : "line-clamp-2 text-sm"
          )}
        >
          {item.name}
        </p>
        {!compact && item.variantName !== "Default" && (
          <p className="mt-1 text-xs font-medium text-slate-500">{item.variantName}</p>
        )}
        {!compact && item.sku && (
          <p className="mt-1 font-mono text-[10px] text-slate-400">{item.sku}</p>
        )}
        <div className={cn("mt-auto flex items-end justify-between", compact ? "pt-2" : "pt-4")}>
          <div className="min-w-0 flex-1 pr-2">
            <p
              className={cn(
                "pos-heading truncate font-bold tabular-nums text-pos-primary",
                compact ? "text-sm" : "text-xl"
              )}
            >
              {formatCurrency(item.sellPrice, currency)}
            </p>
            <p
              className={cn(
                "mt-0.5 flex items-center gap-1 font-semibold",
                compact ? "text-[10px]" : "mt-1 text-xs",
                outOfStock ? "text-red-500" : item.stock <= 5 ? "text-amber-600" : "text-emerald-600"
              )}
            >
              <Package className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
              {outOfStock ? "Out" : compact ? item.stock : `${item.stock} in stock`}
            </p>
          </div>
          <span
            className={cn(
              "pos-add-btn flex shrink-0 items-center justify-center rounded-lg shadow-md",
              compact ? "h-8 w-8" : "h-11 w-11 rounded-xl",
              outOfStock && "pos-add-btn-disabled cursor-not-allowed bg-slate-100 text-slate-300 shadow-none"
            )}
          >
            <Plus className={cn(compact ? "h-4 w-4" : "h-5 w-5")} />
          </span>
        </div>
      </button>
    </div>
  );
});

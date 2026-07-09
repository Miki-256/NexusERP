"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { Plus, Star, Package } from "lucide-react";
import { PosProductImage } from "./pos-product-image";

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
  mobile = false,
}: {
  item: PosCatalogItem;
  currency: string;
  onAdd: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  recentlySold?: boolean;
  addedFlash?: boolean;
  compact?: boolean;
  mobile?: boolean;
}) {
  const outOfStock = item.stock <= 0;
  const lowStock = !outOfStock && item.stock <= 5;
  const initial = item.name.charAt(0).toUpperCase();
  const isLarge = !compact;
  const isMobileCompact = mobile && compact;

  const stockLabel = outOfStock
    ? isMobileCompact ? "Out" : "Out of stock"
    : isLarge
      ? `${item.stock} in stock`
      : isMobileCompact
        ? String(item.stock)
        : String(item.stock);

  const displayName =
    item.variantName !== "Default" ? `${item.name}, ${item.variantName}` : item.name;
  const addLabel = outOfStock
    ? `${displayName} is out of stock`
    : `Add ${displayName} to cart`;
  const imageAlt = item.imageUrl
    ? `${displayName}${outOfStock ? ", out of stock" : ""}`
    : undefined;

  return (
    <div
      className={cn(
        "pos-product-card pos-card group relative flex flex-col overflow-hidden",
        compact && !mobile && "pos-product-card-compact",
        isMobileCompact && "pos-product-card-mobile-compact",
        mobile && isLarge && "pos-product-card-mobile",
        addedFlash && "pos-added",
        outOfStock && "opacity-70"
      )}
    >
      {recentlySold && (
        <span
          className={cn(
            "absolute left-2 top-2 z-10 rounded-md bg-amber-500 font-bold uppercase tracking-wide text-white shadow-sm",
            isLarge ? "left-2.5 top-2.5 rounded-lg px-2 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-[9px]"
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
          "touch-target absolute right-2 top-2 z-10 flex cursor-pointer items-center justify-center rounded-lg bg-white/90 shadow-sm transition-colors",
          isLarge ? "right-2.5 top-2.5 h-10 w-10 rounded-xl" : isMobileCompact ? "h-8 w-8" : "h-7 w-7",
          isFavorite ? "text-amber-500" : "text-slate-300 hover:text-amber-400"
        )}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        <Star className={cn(isLarge ? "h-4 w-4" : "h-3.5 w-3.5", isFavorite && "fill-current")} />
      </button>

      <button
        type="button"
        disabled={outOfStock}
        onClick={onAdd}
        aria-label={addLabel}
        aria-disabled={outOfStock}
        className={cn(
          "flex flex-1 cursor-pointer flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed",
          isLarge ? "p-3.5 sm:p-4" : isMobileCompact ? "p-2.5" : "p-2.5"
        )}
      >
        <div
          className={cn(
            "pos-product-image flex w-full items-center justify-center overflow-hidden",
            isLarge
              ? "mb-3 aspect-[4/3] max-h-32 sm:max-h-36"
              : isMobileCompact
                ? "mb-2 h-16 rounded-lg"
                : "mb-2 h-14 rounded-lg"
          )}
        >
          {item.imageUrl ? (
            <PosProductImage
              imageUrl={item.imageUrl}
              alt={imageAlt ?? displayName}
              compact={!isLarge}
            />
          ) : (
            <span
              className={cn(
                "pos-heading font-bold text-slate-300",
                isLarge ? "text-3xl" : isMobileCompact ? "text-xl" : "text-lg"
              )}
            >
              {initial}
            </span>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5">
          {isLarge ? (
            <>
              <p
                className={cn(
                  "font-bold leading-snug text-slate-900",
                  mobile
                    ? "line-clamp-2 text-sm"
                    : "line-clamp-2 text-sm sm:text-base"
                )}
              >
                {item.name}
              </p>
              {item.variantName !== "Default" && (
                <p className="line-clamp-1 text-xs font-medium text-slate-500">{item.variantName}</p>
              )}
              {item.sku && (
                <p className="truncate font-mono text-[10px] text-slate-400">SKU {item.sku}</p>
              )}
            </>
          ) : (
            <div className="flex items-start justify-between gap-1.5">
              <p
                className={cn(
                  "min-w-0 flex-1 font-bold leading-snug text-slate-900",
                  isMobileCompact ? "line-clamp-2 text-xs" : "line-clamp-2 text-xs"
                )}
              >
                {item.name}
              </p>
              <p
                className={cn(
                  "pos-heading shrink-0 font-bold tabular-nums text-pos-primary",
                  isMobileCompact ? "text-xs" : "text-sm"
                )}
              >
                {formatCurrency(item.sellPrice, currency)}
              </p>
            </div>
          )}

          <span
            className={cn(
              "mt-1 inline-flex w-fit max-w-full items-center gap-1 rounded-full px-2 py-0.5 font-bold uppercase tracking-wide",
              isMobileCompact ? "text-[9px]" : "text-[10px]",
              outOfStock
                ? "bg-red-100 text-red-700"
                : lowStock
                  ? "bg-amber-100 text-amber-800"
                  : "bg-emerald-100 text-emerald-800"
            )}
          >
            <Package className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{stockLabel}</span>
          </span>
        </div>

        {isLarge ? (
          <div className={cn("mt-auto flex items-end justify-between gap-2", "pt-3")}>
            <p
              className={cn(
                "pos-heading min-w-0 flex-1 truncate font-bold tabular-nums text-pos-primary",
                mobile ? "text-lg" : "text-lg sm:text-xl"
              )}
            >
              {formatCurrency(item.sellPrice, currency)}
            </p>
            <span
              className={cn(
                "pos-add-btn touch-target flex shrink-0 items-center justify-center rounded-xl shadow-md",
                mobile ? "h-10 w-10" : "h-11 w-11",
                outOfStock && "pos-add-btn-disabled cursor-not-allowed bg-slate-100 text-slate-300 shadow-none"
              )}
              aria-hidden
            >
              <Plus className={cn(mobile ? "h-4 w-4" : "h-5 w-5")} />
            </span>
          </div>
        ) : (
          <div className={cn("mt-auto flex justify-end pt-1.5")}>
            <span
              className={cn(
                "pos-add-btn touch-target flex shrink-0 items-center justify-center rounded-lg shadow-md",
                isMobileCompact ? "h-10 w-10" : "h-8 w-8",
                outOfStock && "pos-add-btn-disabled cursor-not-allowed bg-slate-100 text-slate-300 shadow-none"
              )}
              aria-hidden
            >
              <Plus className="h-4 w-4" />
            </span>
          </div>
        )}
      </button>
    </div>
  );
});

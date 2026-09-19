"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { cn, formatCurrency } from "@/lib/utils";
import { Plus, Star } from "lucide-react";
import { PosProductImage } from "./pos-product-image";
import { defaultSaleUom, hasMeasuredSaleUoms } from "@/lib/pos/stock-utils";

export type PosSaleUom = {
  code: string;
  name: string;
  factor: number;
  isBase?: boolean;
};

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
  saleUoms?: PosSaleUom[];
};

/** Compact POS product tile — name, price, stock, add. No giant image placeholders. */
export const ProductCard = memo(function ProductCard({
  item,
  currency,
  onAdd,
  isFavorite,
  onToggleFavorite,
  recentlySold,
  addedFlash,
  compact = true,
}: {
  item: PosCatalogItem;
  currency: string;
  onAdd: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  recentlySold?: boolean;
  addedFlash?: boolean;
  compact?: boolean;
  /** @deprecated Kept for call-site compat; density is always compact-first. */
  mobile?: boolean;
}) {
  const t = useTranslations("pos");
  const outOfStock = item.stock <= 0;
  const lowStock = !outOfStock && item.stock <= 5;
  const hasImage = Boolean(item.imageUrl);

  const measured = hasMeasuredSaleUoms(item);
  const saleUom = measured ? defaultSaleUom(item) : null;
  const displayPrice = saleUom
    ? Math.round(item.sellPrice * (Number(saleUom.factor) || 1) * 100) / 100
    : item.sellPrice;
  const priceSuffix = saleUom ? ` / ${saleUom.code}` : "";

  const displayName =
    item.variantName !== "Default" ? `${item.name}, ${item.variantName}` : item.name;
  const addLabel = outOfStock
    ? t("itemOutOfStockAria", { name: displayName })
    : measured
      ? t("addMeasuredToCart", { name: displayName })
      : t("addToCart", { name: displayName });

  const stockText = outOfStock
    ? t("outOfStock")
    : lowStock
      ? t("lowStockCount", { count: item.stock })
      : t("stockShort", { count: item.stock });

  return (
    <div
      className={cn(
        "pos-product-card pos-card group relative flex flex-col overflow-hidden",
        compact ? "pos-product-card-compact" : "pos-product-card-comfort",
        addedFlash && "pos-added",
        outOfStock && "opacity-60"
      )}
    >
      {recentlySold && (
        <span className="absolute left-1.5 top-1.5 z-10 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white bg-amber-500">
          {t("recent")}
        </span>
      )}

      {onToggleFavorite && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={cn(
            "absolute right-1 top-1 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded text-slate-300 transition-colors hover:text-amber-400",
            isFavorite && "text-amber-500"
          )}
          aria-label={isFavorite ? t("removeFromFavorites") : t("addToFavorites")}
        >
          <Star className={cn("h-3.5 w-3.5", isFavorite && "fill-current")} />
        </button>
      )}

      <button
        type="button"
        disabled={outOfStock}
        onClick={onAdd}
        aria-label={addLabel}
        aria-disabled={outOfStock}
        className="flex flex-1 cursor-pointer flex-col gap-1 p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary focus-visible:ring-offset-1 disabled:cursor-not-allowed"
      >
        {hasImage && (
          <div className="pos-product-image mb-0.5 flex h-10 w-full items-center justify-center overflow-hidden rounded">
            <PosProductImage
              imageUrl={item.imageUrl!}
              alt={displayName}
              compact
            />
          </div>
        )}

        <div className={cn("min-w-0 pr-5", recentlySold && "pt-3")}>
          <p className="line-clamp-2 text-[12px] font-semibold leading-snug text-slate-900">
            {item.name}
          </p>
          {item.variantName !== "Default" && (
            <p className="line-clamp-1 text-[10px] text-slate-500">{item.variantName}</p>
          )}
        </div>

        <p className="pos-heading text-[13px] font-bold tabular-nums leading-tight text-pos-primary sm:text-sm">
          {formatCurrency(displayPrice, currency)}
          {priceSuffix ? (
            <span className="ml-0.5 text-[10px] font-semibold text-slate-500">{priceSuffix}</span>
          ) : null}
        </p>

        <div className="mt-auto flex items-center justify-between gap-1 pt-0.5">
          <span
            className={cn(
              "min-w-0 truncate text-[10px] font-medium",
              outOfStock
                ? "text-red-600"
                : lowStock
                  ? "text-amber-700"
                  : "text-slate-500"
            )}
            title={stockText}
          >
            {stockText}
          </span>
          <span
            className={cn(
              "pos-add-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              outOfStock && "pos-add-btn-disabled cursor-not-allowed bg-slate-100 text-slate-300"
            )}
            aria-hidden
          >
            <Plus className="h-4 w-4" />
          </span>
        </div>
      </button>
    </div>
  );
});

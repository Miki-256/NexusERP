"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  Coffee,
  ShoppingBasket,
  Home,
  Milk,
  Star,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { HorizontalScrollStrip } from "./horizontal-scroll-strip";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  beverages: Coffee,
  groceries: ShoppingBasket,
  household: Home,
  "dairy & proteins": Milk,
};

function iconForCategory(name: string): LucideIcon {
  return CATEGORY_ICONS[name.toLowerCase()] ?? LayoutGrid;
}

function activeCategoryId(
  active: string,
  favoritesActive?: boolean,
  recentActive?: boolean
): string {
  if (favoritesActive) return "cat-favorites";
  if (recentActive) return "cat-recent";
  if (active === "all") return "cat-all";
  return `cat-${active.replace(/\s+/g, "-").toLowerCase()}`;
}

export const CategoryNav = memo(function CategoryNav({
  categories,
  active,
  onChange,
  showFavorites,
  showRecent,
  favoritesActive,
  recentActive,
  onFavorites,
  onRecent,
}: {
  categories: string[];
  active: string;
  onChange: (cat: string) => void;
  showFavorites?: boolean;
  showRecent?: boolean;
  favoritesActive?: boolean;
  recentActive?: boolean;
  onFavorites?: () => void;
  onRecent?: () => void;
}) {
  const t = useTranslations("pos");
  const activeSelector = `[data-category-id="${activeCategoryId(active, favoritesActive, recentActive)}"]`;

  const pillBase =
    "pos-category-pill flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[12px] font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary focus-visible:ring-offset-1";

  return (
    <HorizontalScrollStrip
      ariaLabel={t("productCategories")}
      activeItemSelector={activeSelector}
      className="flex gap-1.5 pb-0.5"
    >
      <div role="tablist" aria-label={t("filterByCategory")} className="flex gap-1.5">
        <button
          type="button"
          role="tab"
          id="cat-all"
          data-category-id="cat-all"
          aria-selected={active === "all" && !favoritesActive && !recentActive}
          aria-controls="pos-catalog-panel"
          onClick={() => onChange("all")}
          className={cn(pillBase, active === "all" && !favoritesActive && !recentActive && "active")}
        >
          <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("all")}
        </button>
        {showRecent && (
          <button
            type="button"
            role="tab"
            id="cat-recent"
            data-category-id="cat-recent"
            aria-selected={!!recentActive}
            aria-controls="pos-catalog-panel"
            onClick={onRecent}
            className={cn(pillBase, recentActive && "active")}
          >
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("recent")}
          </button>
        )}
        {showFavorites && (
          <button
            type="button"
            role="tab"
            id="cat-favorites"
            data-category-id="cat-favorites"
            aria-selected={!!favoritesActive}
            aria-controls="pos-catalog-panel"
            onClick={onFavorites}
            className={cn(pillBase, favoritesActive && "active")}
          >
            <Star className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("favorites")}
          </button>
        )}
        {categories.map((cat) => {
          const Icon = iconForCategory(cat);
          const id = `cat-${cat.replace(/\s+/g, "-").toLowerCase()}`;
          const isActive = active === cat && !favoritesActive && !recentActive;
          return (
            <button
              key={cat}
              type="button"
              role="tab"
              id={id}
              data-category-id={id}
              aria-selected={isActive}
              aria-controls="pos-catalog-panel"
              aria-label={t("categoryAria", { name: cat })}
              onClick={() => onChange(cat)}
              className={cn(pillBase, isActive && "active")}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {cat}
            </button>
          );
        })}
      </div>
    </HorizontalScrollStrip>
  );
});

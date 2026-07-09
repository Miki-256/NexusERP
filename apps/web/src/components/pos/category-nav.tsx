"use client";

import { memo } from "react";
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
  const activeSelector = `[data-category-id="${activeCategoryId(active, favoritesActive, recentActive)}"]`;

  const pillBase =
    "pos-category-pill flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pos-primary focus-visible:ring-offset-2";

  return (
    <HorizontalScrollStrip
      ariaLabel="Product categories"
      activeItemSelector={activeSelector}
      className="flex gap-2 pb-1"
    >
      <div role="tablist" aria-label="Filter products by category" className="flex gap-2">
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
          <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
          All products
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
            <Clock className="h-4 w-4 shrink-0" aria-hidden />
            Recent
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
            <Star className="h-4 w-4 shrink-0" aria-hidden />
            Favorites
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
              aria-label={`${cat} category`}
              onClick={() => onChange(cat)}
              className={cn(pillBase, isActive && "active")}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {cat}
            </button>
          );
        })}
      </div>
    </HorizontalScrollStrip>
  );
});

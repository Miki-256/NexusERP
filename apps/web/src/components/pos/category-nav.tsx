"use client";

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

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  beverages: Coffee,
  groceries: ShoppingBasket,
  household: Home,
  "dairy & proteins": Milk,
};

function iconForCategory(name: string): LucideIcon {
  return CATEGORY_ICONS[name.toLowerCase()] ?? LayoutGrid;
}

export function CategoryNav({
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
  const pillBase =
    "pos-category-pill flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600";

  return (
    <div className="flex gap-2 overflow-x-auto pos-scroll-hide pb-1">
      <button
        type="button"
        onClick={() => onChange("all")}
        className={cn(pillBase, active === "all" && !favoritesActive && !recentActive && "active")}
      >
        <LayoutGrid className="h-4 w-4" />
        All
      </button>
      {showRecent && (
        <button
          type="button"
          onClick={onRecent}
          className={cn(pillBase, recentActive && "active")}
        >
          <Clock className="h-4 w-4" />
          Recent
        </button>
      )}
      {showFavorites && (
        <button
          type="button"
          onClick={onFavorites}
          className={cn(pillBase, favoritesActive && "active")}
        >
          <Star className="h-4 w-4" />
          Favorites
        </button>
      )}
      {categories.map((cat) => {
        const Icon = iconForCategory(cat);
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onChange(cat)}
            className={cn(
              pillBase,
              active === cat && !favoritesActive && !recentActive && "active"
            )}
          >
            <Icon className="h-4 w-4" />
            {cat}
          </button>
        );
      })}
    </div>
  );
}

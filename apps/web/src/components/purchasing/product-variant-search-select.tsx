"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, relationName } from "@/lib/utils";

export type ProductVariantSearchOption = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  cost_price: number | null;
  products: { name: string } | { name: string }[] | null;
};

function variantLabel(v: ProductVariantSearchOption) {
  return `${relationName(v.products)}${v.name && v.name !== "Default" ? ` (${v.name})` : ""}`;
}

export function ProductVariantSearchSelect({
  variants,
  value,
  onChange,
  placeholder = "Search product…",
  className,
}: {
  variants: ProductVariantSearchOption[];
  value: string;
  onChange: (variantId: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = variants.find((v) => v.id === value);
  const selectedLabel = selected ? variantLabel(selected) : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return variants.slice(0, 80);
    return variants
      .filter((v) => {
        const label = variantLabel(v).toLowerCase();
        const sku = (v.sku ?? "").toLowerCase();
        const barcode = (v.barcode ?? "").toLowerCase();
        return label.includes(q) || sku.includes(q) || barcode.includes(q);
      })
      .slice(0, 80);
  }, [variants, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-10 w-full justify-between border-input bg-background px-3 font-normal text-foreground hover:bg-accent",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate text-left">{selected ? selectedLabel : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search by name, SKU…"
            className="pl-8"
          />
        </div>
        <div className="max-h-56 overflow-y-auto overscroll-contain">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No products found.</p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((v) => {
                const label = variantLabel(v);
                const meta = [v.sku, v.barcode].filter(Boolean).join(" · ");
                const isSelected = v.id === value;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        "hover:bg-accent hover:text-accent-foreground",
                        isSelected && "bg-accent text-accent-foreground"
                      )}
                      onClick={() => {
                        onChange(v.id);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <span className="truncate font-medium">{label}</span>
                      {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

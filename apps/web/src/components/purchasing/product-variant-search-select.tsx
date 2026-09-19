"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { cn, relationName } from "@/lib/utils";

export type ProductVariantSearchOption = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  cost_price: number | null;
  product_id?: string;
  products: { name: string } | { name: string }[] | null;
};

export function ProductVariantSearchSelect({
  variants,
  value,
  onChange,
  placeholder,
  className,
  onCreateProduct,
  organizationId,
  onRemoteResults,
}: {
  variants: ProductVariantSearchOption[];
  value: string;
  onChange: (variantId: string) => void;
  placeholder?: string;
  className?: string;
  onCreateProduct?: (suggestedName: string) => void;
  organizationId?: string;
  onRemoteResults?: (items: ProductVariantSearchOption[]) => void;
}) {
  const t = useTranslations("purchasing.po");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<ProductVariantSearchOption[]>([]);
  const [searching, setSearching] = useState(false);

  function variantLabel(v: ProductVariantSearchOption) {
    const defaultName = t("defaultVariant");
    return `${relationName(v.products)}${v.name && v.name !== "Default" && v.name !== defaultName ? ` (${v.name})` : ""}`;
  }

  const pool = useMemo(() => {
    const map = new Map<string, ProductVariantSearchOption>();
    for (const v of variants) map.set(v.id, v);
    for (const v of remote) map.set(v.id, v);
    return [...map.values()];
  }, [variants, remote]);

  const selected = pool.find((v) => v.id === value);
  const selectedLabel = selected ? variantLabel(selected) : "";
  const triggerPlaceholder = placeholder ?? t("searchProduct");

  useEffect(() => {
    if (!organizationId || !open) return;
    const q = query.trim();
    if (q.length < 2) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const supabase = createClient();
        // Use catalog RPC so product name / product SKU / variant SKU / barcode all match
        // (variant.name is often "Default" — PostgREST on variants alone returns []).
        const { data, error } = await supabase.rpc("list_products_page", {
          p_org_id: organizationId,
          p_limit: 40,
          p_offset: 0,
          p_search: q,
          p_category_id: null,
          p_active_only: true,
        });
        if (cancelled) return;
        if (error) {
          console.error("[po-product-search]", error.message);
          setRemote([]);
          return;
        }
        const payload = data as {
          rows?: {
            id: string;
            name: string;
            sku?: string | null;
            barcode?: string | null;
            cost_price?: number | null;
            product_variants?: {
              id: string;
              name: string;
              sku?: string | null;
              barcode?: string | null;
              sell_price?: number | null;
            }[];
          }[];
        } | null;
        const items: ProductVariantSearchOption[] = [];
        for (const product of payload?.rows ?? []) {
          const variants = product.product_variants ?? [];
          if (variants.length === 0) continue;
          for (const pv of variants) {
            items.push({
              id: pv.id,
              name: pv.name,
              sku: pv.sku ?? product.sku ?? null,
              barcode: pv.barcode ?? product.barcode ?? null,
              cost_price: product.cost_price ?? null,
              product_id: product.id,
              products: { name: product.name },
            });
          }
        }
        setRemote(items.slice(0, 40));
        onRemoteResults?.(items.slice(0, 40));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [organizationId, open, query, onRemoteResults]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = organizationId ? pool : variants;
    if (!q) return source.slice(0, 80);
    return source
      .filter((v) => {
        const label = variantLabel(v).toLowerCase();
        const sku = (v.sku ?? "").toLowerCase();
        const barcode = (v.barcode ?? "").toLowerCase();
        return label.includes(q) || sku.includes(q) || barcode.includes(q);
      })
      .slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- variantLabel uses stable t
  }, [variants, pool, query, t, organizationId]);

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
            "h-9 w-full justify-between font-normal",
            !selectedLabel && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{selectedLabel || triggerPlaceholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchProduct")}
            className="h-8 pl-8"
          />
          {searching && (
            <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="max-h-56 overflow-y-auto overscroll-contain">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {organizationId && query.trim().length < 2
                ? t("searchHint")
                : searching
                  ? t("searchProduct")
                  : t("noProductsFound")}
            </p>
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
                        onRemoteResults?.([v]);
                        queueMicrotask(() => {
                          onChange(v.id);
                          setOpen(false);
                          setQuery("");
                        });
                      }}
                    >
                      <span className="truncate font-medium">{label}</span>
                      {meta ? (
                        <span className="truncate text-xs text-muted-foreground">{meta}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {onCreateProduct ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start text-xs"
            onClick={() => {
              onCreateProduct(query.trim());
              setOpen(false);
            }}
          >
            + {t("createNewProduct")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
